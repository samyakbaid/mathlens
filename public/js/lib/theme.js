// Light / dark theme.
//
// The colours live in css/styles.css as custom properties (--plot-bg, --c-blue, ...),
// so there is one source of truth. This module reads them into COLORS, which canvas
// code uses while drawing, and tells listeners (plots, AI frames) when the theme changes.
//
//   import { COLORS, alpha, onThemeChange } from './theme.js';
//   ctx.strokeStyle = COLORS.blue;
//   ctx.fillStyle = alpha(COLORS.blue, 0.2);    // same colour, 20% opacity

const STORAGE_KEY = 'mathlens-theme';

// Which CSS variable feeds each COLORS entry.
const CSS_VARIABLES = {
  background: '--plot-bg',
  grid: '--plot-grid',
  gridMinor: '--plot-grid-minor',
  axis: '--plot-axis',
  label: '--plot-label',
  text: '--plot-text',
  muted: '--plot-muted',
  blue: '--c-blue',
  orange: '--c-orange',
  green: '--c-green',
  red: '--c-red',
  purple: '--c-purple',
  yellow: '--c-yellow',
  cyan: '--c-cyan',
  pink: '--c-pink',
};

// Used only if the stylesheet hasn't loaded yet (keeps canvas drawing from breaking).
const FALLBACK = {
  background: '#fffdf8', grid: '#e3ddd0', gridMinor: '#f0ebe0', axis: '#6d675b', label: '#7a7366',
  text: '#1c1a16', muted: '#6d675b', blue: '#2747c9', orange: '#d46a0c', green: '#1d8a4b',
  red: '#cf3a2c', purple: '#7a3fb8', yellow: '#b07d0a', cyan: '#0d8a9c', pink: '#c03d7c',
};

/** Live colour table. Read it while drawing (not once at import) so theme switches apply. */
export const COLORS = { ...FALLBACK };

/** The colour names that make good series colours, in a pleasant order. */
export const SERIES = ['blue', 'red', 'green', 'purple', 'orange', 'cyan', 'pink', 'yellow'];

const listeners = new Set();
let current = 'light';

export function getTheme() {
  return current;
}

export function setTheme(name) {
  current = name === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = current;
  try {
    localStorage.setItem(STORAGE_KEY, current);
  } catch {
    // storage blocked (private mode etc.): the theme just won't be remembered
  }
  readColors();
  listeners.forEach((listener) => listener(current));
}

export function toggleTheme() {
  setTheme(current === 'dark' ? 'light' : 'dark');
}

/** Call `listener(themeName)` after every theme change. Returns an unsubscribe function. */
export function onThemeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** '#2d70f6' or 'rgb(...)' + 0.3 → 'rgba(45, 112, 246, 0.3)' */
export function alpha(color, opacity) {
  const hex = String(color).trim().replace('#', '');
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const [r, g, b] = [...hex].map((ch) => parseInt(ch + ch, 16));
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  const rgb = String(color).match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((part) => part.trim());
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return color;
}

/**
 * CSS that gives an AI-built visualization (in its sandboxed iframe) the site's current colours
 * as custom properties: --bg, --panel, --text, --muted, --grid, --border, --blue, --red, ...
 */
export function themeCss() {
  const style = getComputedStyle(document.documentElement);
  const v = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const lines = [
    `color-scheme: ${current};`,
    `--bg: ${COLORS.background};`,
    `--panel: ${v('--surface-2', '#f3f5f8')};`,
    `--border: ${v('--border', '#e3e6ec')};`,
    `--text: ${COLORS.text};`,
    `--muted: ${COLORS.muted};`,
    `--grid: ${COLORS.grid};`,
    `--axis: ${COLORS.axis};`,
    ...['blue', 'orange', 'green', 'red', 'purple', 'yellow', 'cyan', 'pink'].map((name) => `--${name}: ${COLORS[name]};`),
  ];
  return `:root { ${lines.join(' ')} } html, body { background: var(--bg); color: var(--text); }`;
}

function readColors() {
  const style = getComputedStyle(document.documentElement);
  for (const [key, variable] of Object.entries(CSS_VARIABLES)) {
    COLORS[key] = style.getPropertyValue(variable).trim() || COLORS[key] || FALLBACK[key];
  }
}

// ---- Start-up --------------------------------------------------------------
let saved = null;
try {
  saved = localStorage.getItem(STORAGE_KEY);
} catch {
  // ignore
}
current = saved === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = current;
readColors();
// If the stylesheet finished loading after this module ran, read the colours again.
window.addEventListener('load', () => {
  readColors();
  listeners.forEach((listener) => listener(current));
});
