// Small line icons (inline SVG), so buttons never depend on emoji or font glyphs.
//   button.innerHTML = icon('play') + 'Play';

const PATHS = {
  play: '<path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M5 3.5v9M11 3.5v9" stroke-width="2.2"/>',
  left: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
  right: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  down: '<path d="M3.5 6 8 10.5 12.5 6"/>',
  restart: '<path d="M3 8a5 5 0 1 0 1.5-3.6"/><path d="M3 3v3h3"/>',
  swap: '<path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  spark: '<path d="M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/>',
  graph: '<path d="M2.5 13.5h11M2.5 13.5v-11"/><path d="M4 11c2-6 4-6 5.5-3s2.5 1 3.5-3"/>',
  book: '<path d="M2.5 3.5h4a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 0-1.5-1.5h-4zM13.5 3.5h-4A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5h4z"/>',
  ask: '<path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  paperclip: '<path d="M10.5 4.5 5.8 9.2a1.5 1.5 0 0 0 2.1 2.1l5-5a3 3 0 0 0-4.2-4.2l-5.2 5.2a4.5 4.5 0 0 0 6.4 6.4l4-4"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  cube: '<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z"/><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6"/>',
};

/** SVG markup for a named icon (16×16, uses the current text colour). */
export function icon(name, size = 16) {
  const body = PATHS[name] ?? '';
  return `<svg class="icon" viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
