import Anthropic from "@anthropic-ai/sdk";
import { clientIp, isRateLimited } from "@/lib/rate-limit";

// AI desk analyst: streams Claude commentary on the caller's current desk
// state. The client sends its chat history plus a compact JSON snapshot of
// what the desk is showing (spot, positions, P&L, alerts, forecast); the
// snapshot rides only on the latest turn so history stays lean. Env-gated on
// ANTHROPIC_API_KEY — without it the route answers 503 and the UI explains.
//
// This route pays real API cost per request and has no login wall (by
// design — the analyst is usable without an account), so it's rate-limited
// instead: a tight per-IP window plus a loose global window that bounds
// worst-case spend even under a distributed script. Both are in-memory
// (see src/lib/rate-limit.ts) — good enough to stop casual abuse, not a
// substitute for an authenticated quota if this gets hammered for real.

export const maxDuration = 60; // allow long streamed answers on Vercel
export const runtime = "nodejs";

const MODEL = "claude-opus-4-8";
const MAX_TURNS = 24;
const MAX_CONTENT_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 24_000;

const IP_LIMIT = 8;
const IP_WINDOW_MS = 10 * 60 * 1000; // 8 requests / 10 min / IP
const GLOBAL_LIMIT = 300;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000; // 300 requests / hour, all callers combined

const SYSTEM = `You are the desk analyst on "Meridian Desk", a wholesale electricity trading desk covering Australia's NEM (QLD/NSW/VIC/SA/TAS) and WEM (WA). You sit next to the trader and provide sharp, quantitative commentary on what the desk is showing.

Each user message may include a <desk_state> JSON block — the live state of their screen: 5-minute spot prices, their retail book (flat-rate customer load), open paper hedges (swaps, caps, floors, collars, load-following swaps, PPAs), coverage, margin, stress test, active signals, a 7-day backtest, and a 48-hour statistical price forecast for the selected region.

How to respond:
- Ground every claim in the numbers from <desk_state>. Quote figures ($/MWh, MW, $/h) rather than speaking vaguely. If asked about something not in the snapshot, say what data is missing rather than inventing it.
- Think like an energy trader: reconcile prices against demand/interchange, connect coverage gaps to spot risk, read the diurnal shape (overnight trough, solar dip, evening peak, AEST market time), and flag what deserves attention first.
- Be direct and concise — a couple of short paragraphs or a tight list. This is chat on a trading floor, not a report.
- Honest about limitations: this is a PAPER desk (no ASX Energy or AEMO settlement connectivity); the forecast is the desk's own statistical model, not a traded curve; prior-quarter shape is history, not prediction. Never present commentary as personalised financial advice.`;

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

function bad(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return bad(
      503,
      "AI analyst not configured — set ANTHROPIC_API_KEY in the deployment environment.",
    );
  }

  if (isRateLimited(`global`, GLOBAL_LIMIT, GLOBAL_WINDOW_MS)) {
    return bad(429, "analyst is busy — try again shortly");
  }
  const ip = clientIp(request);
  if (isRateLimited(`ip:${ip}`, IP_LIMIT, IP_WINDOW_MS)) {
    return bad(429, "too many requests from this connection — slow down and try again in a few minutes");
  }

  let body: { messages?: ChatTurn[]; context?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad(400, "invalid JSON body");
  }

  const turns = Array.isArray(body.messages) ? body.messages.slice(-MAX_TURNS) : [];
  if (
    turns.length === 0 ||
    turns[turns.length - 1].role !== "user" ||
    turns.some(
      (t) =>
        (t.role !== "user" && t.role !== "assistant") ||
        typeof t.content !== "string" ||
        t.content.length === 0 ||
        t.content.length > MAX_CONTENT_CHARS,
    )
  ) {
    return bad(400, "messages must be non-empty user/assistant turns ending with a user turn");
  }

  let contextJson = "";
  try {
    contextJson = JSON.stringify(body.context ?? {});
  } catch {
    contextJson = "{}";
  }
  if (contextJson.length > MAX_CONTEXT_CHARS) {
    return bad(400, "desk snapshot too large");
  }

  // Snapshot rides only on the newest user turn; earlier turns stay plain so
  // the conversation doesn't accumulate stale desk states.
  const messages: Anthropic.MessageParam[] = turns.map((t, i) =>
    i === turns.length - 1
      ? {
          role: "user" as const,
          content: `<desk_state>\n${contextJson}\n</desk_state>\n\n${t.content}`,
        }
      : { role: t.role, content: t.content },
  );

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1500,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: SYSTEM,
    messages,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        const note =
          err instanceof Anthropic.RateLimitError
            ? "rate limited — try again shortly"
            : err instanceof Anthropic.APIError
              ? `API error ${err.status}`
              : "connection error";
        controller.enqueue(encoder.encode(`\n\n[analyst unavailable: ${note}]`));
      }
      controller.close();
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
