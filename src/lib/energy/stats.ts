// Small statistics toolkit for the LAB: correlation, dispersion, OLS.
// Pure functions over aligned numeric arrays; NaNs are pairwise-dropped.

export function cleanPairs(x: number[], y: number[]): [number[], number[]] {
  const xs: number[] = [];
  const ys: number[] = [];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      xs.push(x[i]);
      ys.push(y[i]);
    }
  }
  return [xs, ys];
}

export function mean(a: number[]): number {
  if (a.length === 0) return NaN;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

export function stdDev(a: number[]): number {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

/** Pearson correlation coefficient. */
export function pearson(x: number[], y: number[]): number {
  const [xs, ys] = cleanPairs(x, y);
  if (xs.length < 3) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const d = Math.sqrt(sxx * syy);
  return d > 0 ? sxy / d : NaN;
}

export interface Fit {
  slope: number;
  intercept: number;
  r2: number;
  /** Std dev of residuals — the honest uncertainty band. */
  sigma: number;
  n: number;
}

/** Simple least-squares y = a + b·x with residual sigma. */
export function ols(x: number[], y: number[]): Fit {
  const [xs, ys] = cleanPairs(x, y);
  const n = xs.length;
  if (n < 3) return { slope: 0, intercept: mean(ys) || 0, r2: 0, sigma: stdDev(ys) || 0, n };
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (ys[i] - (intercept + slope * xs[i])) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  return {
    slope,
    intercept,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    sigma: Math.sqrt(ssRes / Math.max(n - 2, 1)),
    n,
  };
}

/** Two-predictor least squares y = a + b1·x1 + b2·x2 (normal equations). */
export function ols2(x1: number[], x2: number[], y: number[]): { a: number; b1: number; b2: number; r2: number; sigma: number; n: number } {
  const rows: Array<[number, number, number]> = [];
  const n0 = Math.min(x1.length, x2.length, y.length);
  for (let i = 0; i < n0; i++) {
    if (Number.isFinite(x1[i]) && Number.isFinite(x2[i]) && Number.isFinite(y[i])) {
      rows.push([x1[i], x2[i], y[i]]);
    }
  }
  const n = rows.length;
  const my = mean(rows.map((r) => r[2]));
  if (n < 4) return { a: my || 0, b1: 0, b2: 0, r2: 0, sigma: 0, n };
  // Build X'X (3x3) and X'y for [1, x1, x2].
  let s1 = 0, s2 = 0, s11 = 0, s22 = 0, s12 = 0, sy = 0, s1y = 0, s2y = 0;
  for (const [a, b, c] of rows) {
    s1 += a; s2 += b; s11 += a * a; s22 += b * b; s12 += a * b;
    sy += c; s1y += a * c; s2y += b * c;
  }
  // Solve the 3x3 system via Cramer's rule.
  const M = [
    [n, s1, s2],
    [s1, s11, s12],
    [s2, s12, s22],
  ];
  const v = [sy, s1y, s2y];
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (Math.abs(D) < 1e-9) return { a: my, b1: 0, b2: 0, r2: 0, sigma: 0, n };
  const col = (k: number) => M.map((row, i) => row.map((cell, j) => (j === k ? v[i] : cell)));
  const a = det(col(0)) / D;
  const b1 = det(col(1)) / D;
  const b2 = det(col(2)) / D;
  let ssRes = 0;
  let ssTot = 0;
  for (const [p, q, c] of rows) {
    ssRes += (c - (a + b1 * p + b2 * q)) ** 2;
    ssTot += (c - my) ** 2;
  }
  return {
    a,
    b1,
    b2,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    sigma: Math.sqrt(ssRes / Math.max(n - 3, 1)),
    n,
  };
}

/** Error metrics between a forecast and what actually happened. */
export function errorStats(forecast: number[], actual: number[]) {
  const [f, a] = cleanPairs(forecast, actual);
  if (f.length === 0) return { mae: NaN, rmse: NaN, bias: NaN, n: 0 };
  let sae = 0;
  let sse = 0;
  let sb = 0;
  for (let i = 0; i < f.length; i++) {
    const e = f[i] - a[i];
    sae += Math.abs(e);
    sse += e * e;
    sb += e;
  }
  return { mae: sae / f.length, rmse: Math.sqrt(sse / f.length), bias: sb / f.length, n: f.length };
}
