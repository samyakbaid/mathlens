// 2×2 linear algebra + drawing helpers shared by the linear-algebra topics.
//
// A matrix is { a, b, c, d } meaning [[a, b], [c, d]].
// Its first column (a, c) is where î = (1, 0) lands; its second column (b, d) is where ĵ = (0, 1) lands.

import { COLORS, alpha } from './plot.js';
import { format } from './numeric.js';

export const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1 });
const EPSILON = 1e-9;

export function apply({ a, b, c, d }, [x, y]) {
  return [a * x + b * y, c * x + d * y];
}

/** A·B: first apply B, then A. */
export function multiply(A, B) {
  return {
    a: A.a * B.a + A.b * B.c,
    b: A.a * B.b + A.b * B.d,
    c: A.c * B.a + A.d * B.c,
    d: A.c * B.b + A.d * B.d,
  };
}

export function det({ a, b, c, d }) {
  return a * d - b * c;
}

export function inverse(M) {
  const D = det(M);
  if (Math.abs(D) < 1e-12) return null;
  return { a: M.d / D, b: -M.b / D, c: -M.c / D, d: M.a / D };
}

/** Straight-line blend between two matrices: (1 − t)·A + t·B. */
export function lerpMatrix(A, B, t) {
  return {
    a: A.a + (B.a - A.a) * t,
    b: A.b + (B.b - A.b) * t,
    c: A.c + (B.c - A.c) * t,
    d: A.d + (B.d - A.d) * t,
  };
}

export function rotation(radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: -sin, c: sin, d: cos };
}

export function matricesEqual(A, B, tolerance = 1e-9) {
  return ['a', 'b', 'c', 'd'].every((k) => Math.abs(A[k] - B[k]) < tolerance);
}

export function dot([x1, y1], [x2, y2]) {
  return x1 * x2 + y1 * y2;
}

export function normalize([x, y]) {
  const length = Math.hypot(x, y);
  return length > EPSILON ? [x / length, y / length] : [0, 0];
}

/**
 * Eigenvalues/eigenvectors of a 2×2 matrix from the characteristic polynomial λ² − tr·λ + det = 0.
 * Returns { complex: true, re, im } or { complex: false, pairs: [{ value, vector }], everyVector, defective }.
 */
export function eigen(m) {
  const trace = m.a + m.d;
  const D = det(m);
  const discriminant = trace * trace - 4 * D;

  if (discriminant < -EPSILON) {
    return { complex: true, re: trace / 2, im: Math.sqrt(-discriminant) / 2 };
  }

  const root = Math.sqrt(Math.max(0, discriminant));
  const values = [(trace + root) / 2, (trace - root) / 2];
  const pairs = values.map((value) => ({ value, vector: eigenvectorFor(m, value) }));
  const everyVector = pairs[0].vector === null; // A = λI
  const defective = !everyVector && root < 1e-6;
  return { complex: false, pairs: defective || everyVector ? [pairs[0]] : pairs, everyVector, defective };
}

/** Solve (A − λI)v = 0 using whichever row of A − λI is non-zero. */
function eigenvectorFor({ a, b, c, d }, lambda) {
  if (Math.abs(a - lambda) > EPSILON || Math.abs(b) > EPSILON) return normalize([b, lambda - a]);
  if (Math.abs(c) > EPSILON || Math.abs(d - lambda) > EPSILON) return normalize([lambda - d, c]);
  return null; // A − λI is the zero matrix
}

/** LaTeX for a matrix, with the columns coloured like î (green) and ĵ (red). */
export function matrixTex({ a, b, c, d }, { digits = 2, colored = true } = {}) {
  const f = (v) => format(v, digits);
  const col1 = (v) => (colored ? String.raw`\htmlClass{c-green}{${f(v)}}` : f(v));
  const col2 = (v) => (colored ? String.raw`\htmlClass{c-red}{${f(v)}}` : f(v));
  return String.raw`\begin{bmatrix} ${col1(a)} & ${col2(b)} \\ ${col1(c)} & ${col2(d)} \end{bmatrix}`;
}

export function vectorTex([x, y], { digits = 2, cls = '' } = {}) {
  const body = String.raw`\begin{bmatrix} ${format(x, digits)} \\ ${format(y, digits)} \end{bmatrix}`;
  return cls ? String.raw`\htmlClass{${cls}}{${body}}` : body;
}

// ---- Drawing ------------------------------------------------------------------

/**
 * Draw the image of the square grid under M: the lines x = k and y = k, transformed.
 * Covers whatever is visible, at any zoom level.
 */
export function drawTransformedGrid(plot, M, { color = COLORS.blue, opacity = 0.45 } = {}) {
  const { xMin, xMax, yMin, yMax } = plot.bounds;
  const inv = inverse(M);
  let reach = Math.max(Math.abs(xMin), Math.abs(xMax), Math.abs(yMin), Math.abs(yMax));
  if (inv) {
    // Which grid lines (in the original coordinates) can land on screen?
    const corners = [[xMin, yMin], [xMin, yMax], [xMax, yMin], [xMax, yMax]].map((p) => apply(inv, p));
    reach = Math.max(...corners.flat().map(Math.abs));
  }
  const spacing = gridSpacing(plot, M);
  const N = Math.min(80, Math.ceil(reach / spacing) + 1) * spacing;
  const far = N * 1.5;

  for (let k = -N; k <= N + 1e-9; k += spacing) {
    const isAxis = Math.abs(k) < 1e-9;
    const style = { color: alpha(color, isAxis ? Math.min(1, opacity * 2) : opacity), width: isAxis ? 2 : 1.2 };
    plot.line(...apply(M, [k, -far]), ...apply(M, [k, far]), style);
    plot.line(...apply(M, [-far, k]), ...apply(M, [far, k]), style);
  }
}

/** Grid line spacing (1, 2, 5, 10...) so transformed lines stay at least ~18px apart. */
function gridSpacing(plot, M) {
  const pixelsPerUnit = 1 / plot.unitsPerPixel;
  const shortest = Math.min(Math.hypot(M.a, M.c), Math.hypot(M.b, M.d)) || 1;
  let spacing = 1;
  while (spacing * shortest * pixelsPerUnit < 18 && spacing < 1e6) {
    spacing *= spacing.toString().startsWith('2') ? 2.5 : 2;
  }
  return spacing;
}

/** î and ĵ after the transformation, as green and red arrows with labels. */
export function drawBasisVectors(plot, M, { labels = true, width = 3.5 } = {}) {
  const i = apply(M, [1, 0]);
  const j = apply(M, [0, 1]);
  plot.arrow(0, 0, ...i, { color: COLORS.green, width, headSize: 13 });
  plot.arrow(0, 0, ...j, { color: COLORS.red, width, headSize: 13 });
  if (labels) {
    plot.text('î', ...i, { color: COLORS.green, font: '700 16px "IBM Plex Sans", system-ui, sans-serif' });
    plot.text('ĵ', ...j, { color: COLORS.red, font: '700 16px "IBM Plex Sans", system-ui, sans-serif' });
  }
  return { i, j };
}

/** The unit square [0,1]² after M: a parallelogram whose signed area is det(M). */
export function drawUnitSquare(plot, M, { label = true } = {}) {
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map((p) => apply(M, p));
  const D = det(M);
  const color = D >= 0 ? COLORS.yellow : COLORS.pink;
  plot.path(corners, { color: alpha(color, 0.9), width: 1.5, fill: alpha(color, 0.22), closed: true });
  if (label && Math.abs(D) > 0.05) {
    const [cx, cy] = apply(M, [0.5, 0.5]);
    plot.text(`area ${format(D, 2)}`, cx, cy, { color, align: 'center', baseline: 'middle', offset: [0, 0], font: '700 13px "IBM Plex Sans", system-ui, sans-serif' });
  }
}

// The letter "F": not symmetric in any direction, so rotations, flips and shears are easy to see.
const LETTER_F = [
  [0.0, 0.0], [0.32, 0.0], [0.32, 0.62], [0.78, 0.62], [0.78, 0.92], [0.32, 0.92],
  [0.32, 1.2], [0.98, 1.2], [0.98, 1.5], [0.0, 1.5],
].map(([x, y]) => [x - 1.7, y + 0.25]);

export function drawLetterF(plot, M, { color = COLORS.purple, ghost = false } = {}) {
  const points = LETTER_F.map((p) => apply(M, p));
  if (ghost) plot.path(points, { color: alpha(color, 0.45), width: 1.5, dash: [5, 4], closed: true });
  else plot.path(points, { color, width: 2, fill: alpha(color, 0.25), closed: true });
}
