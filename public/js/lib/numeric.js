// Small numerical helpers shared by the topics.

/** Approximate f'(x) with a central difference. */
export function derivative(f, x, h = 1e-4) {
  return (f(x + h) - f(x - h)) / (2 * h);
}

/** Approximate ∫ f from a to b with Simpson's rule (accurate for smooth functions). */
export function integrate(f, a, b, n = 2000) {
  const h = (b - a) / n;
  let sum = f(a) + f(b);
  for (let i = 1; i < n; i++) {
    sum += f(a + i * h) * (i % 2 === 0 ? 2 : 4);
  }
  return (sum * h) / 3;
}

/** A random number from the standard normal distribution (Box–Muller). */
export function randomNormal() {
  const u = 1 - Math.random(); // in (0, 1], so log(u) is finite
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Format a number for display: rounds, trims trailing zeros, uses e-notation for extremes. */
export function format(value, digits = 4) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return value.toExponential(2);
  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
