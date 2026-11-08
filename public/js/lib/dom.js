// Tiny helper for creating HTML elements without repeating boilerplate.

/**
 * el('div', 'card', 'Hello') → <div class="card">Hello</div>
 * Text is set with textContent, so it is always safe (never parsed as HTML).
 */
export function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
