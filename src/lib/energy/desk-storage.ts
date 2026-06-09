import { DEFAULT_BOOK, type Book, type Trade } from "./desk";

// Desk persistence shared by the desk panel and the build/scenario panel.

export const DESK_STORAGE_KEY = "au-energy-desk-v1";

export interface DeskState {
  book: Book;
  trades: Trade[];
}

export function loadDeskState(): DeskState {
  if (typeof window === "undefined") return { book: DEFAULT_BOOK, trades: [] };
  try {
    const raw = window.localStorage.getItem(DESK_STORAGE_KEY);
    if (!raw) return { book: DEFAULT_BOOK, trades: [] };
    const parsed = JSON.parse(raw) as Partial<DeskState>;
    return {
      book: {
        ...DEFAULT_BOOK,
        ...parsed.book,
        loadsMW: { ...DEFAULT_BOOK.loadsMW, ...parsed.book?.loadsMW },
      },
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
    };
  } catch {
    return { book: DEFAULT_BOOK, trades: [] };
  }
}
