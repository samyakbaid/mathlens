// Helpers that add labelled controls (sliders, dropdowns, buttons, readouts) to a panel.
// Each function appends to `panel` and returns something you can read or update later.

import { el } from './dom.js';
import { renderMath, renderMarkdown, renderMarkdownInline } from './markdown.js';
import { parse, formulaToTex } from './expression.js';
import { icon } from './icons.js';

export function addHeading(panel, text) {
  panel.append(el('h3', 'control-heading', text));
}

export function addNote(panel, text) {
  const note = el('p', 'control-note', text);
  panel.append(note);
  return note;
}

/** Read a typed number. Accepts plain numbers and constant formulas like "pi/2" or "-3/4". */
export function readNumber(text) {
  const trimmed = String(text).trim();
  if (trimmed === '') return NaN;
  const plain = Number(trimmed);
  if (Number.isFinite(plain)) return plain;
  try {
    const parsed = parse(trimmed);
    if (parsed.variables.size > 0) return NaN;
    return parsed.evaluate({ vars: {}, fns: {} });
  } catch {
    return NaN;
  }
}

/**
 * A slider with a typeable value, like Desmos: click the number to type an exact value
 * (formulas such as pi/2 work), use ↑/↓ to nudge it. Typing a value outside the range extends it.
 *   const s = addSlider(panel, { label: 'n', min: 1, max: 50, value: 5, onInput: (v) => {...} });
 *   s.value        // read
 *   s.value = 3    // set (does not call onInput)
 */
export function addSlider(panel, { label, min, max, step = 1, value, format = (v) => String(v), onInput }) {
  const row = el('div', 'control');
  const top = el('div', 'control-top');
  const number = el('input', 'control-number');
  Object.assign(number, { type: 'text', inputMode: 'decimal', spellcheck: false, autocomplete: 'off' });
  number.setAttribute('aria-label', `${label} value`);
  const range = el('input');
  Object.assign(range, { type: 'range', min, max, step, value }); // order matters: range before value
  range.setAttribute('aria-label', label);

  top.append(el('label', 'control-label', label), number);
  row.append(top, range);
  panel.append(row);

  const show = () => {
    if (document.activeElement !== number) number.value = format(Number(range.value));
    const fraction = (Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min) || 1);
    range.style.setProperty('--fill', `${Math.max(0, Math.min(1, fraction)) * 100}%`);
  };
  const extendRangeTo = (v) => {
    if (v < Number(range.min)) range.min = v;
    if (v > Number(range.max)) range.max = v;
  };
  const commit = (v) => {
    extendRangeTo(v);
    range.value = v;
    show();
    onInput?.(v);
  };

  show();
  range.addEventListener('input', () => {
    number.value = format(Number(range.value));
    show();
    onInput?.(Number(range.value));
  });
  number.addEventListener('focus', () => number.select());
  number.addEventListener('change', () => {
    const v = readNumber(number.value);
    if (Number.isFinite(v)) {
      commit(v);
      number.classList.remove('invalid');
    } else {
      number.classList.add('invalid');
    }
    number.value = format(Number(range.value));
    setTimeout(() => number.classList.remove('invalid'), 900);
  });
  number.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') number.blur();
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const delta = Number(step) * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
      const v = Number((Number(range.value) + delta).toFixed(10));
      commit(v);
      number.value = format(v);
    }
  });

  return {
    get value() {
      return Number(range.value);
    },
    set value(newValue) {
      extendRangeTo(newValue);
      range.value = newValue;
      show();
    },
    element: row,
  };
}

/**
 * A dropdown. options: [{ value: 'sin', label: 'sin(x)' }, ...]. Returns the <select>.
 */
export function addSelect(panel, { label, options, value, onChange }) {
  const row = el('div', 'control');
  const select = el('select');
  for (const option of options) {
    const node = el('option', '', option.label);
    node.value = option.value;
    select.append(node);
  }
  if (value !== undefined) select.value = value;
  select.addEventListener('change', () => onChange?.(select.value));

  if (label) row.append(el('span', 'control-label', label));
  row.append(select);
  panel.append(row);
  return select;
}

/**
 * A text box for formulas. It updates live as you type (and on Enter).
 * If onChange throws, the error message is shown under the box once you pause.
 * With `preview: true` the formula is also shown typeset, like Desmos.
 */
export function addTextInput(panel, { label, value = '', placeholder = '', onChange, preview = false }) {
  const row = el('div', 'control');
  const input = el('input', 'formula-input');
  Object.assign(input, { type: 'text', value, placeholder, spellcheck: false, autocomplete: 'off' });
  const typeset = el('div', 'formula-preview');
  const error = el('div', 'control-error');

  row.append(el('span', 'control-label', label), input);
  if (preview) row.append(typeset);
  row.append(error);
  panel.append(row);

  let errorTimer = null;
  const showPreview = () => {
    if (!preview) return;
    const tex = formulaToTex(input.value);
    typeset.innerHTML = tex ? renderMath(tex) : '';
  };
  const run = ({ showErrorNow }) => {
    clearTimeout(errorTimer);
    try {
      onChange(input.value);
      error.textContent = '';
      input.classList.remove('invalid');
      showPreview();
    } catch (err) {
      const show = () => {
        error.textContent = err.message;
        input.classList.add('invalid');
      };
      if (showErrorNow) show();
      else errorTimer = setTimeout(show, 700); // don't nag while the user is mid-formula
    }
  };

  input.addEventListener('input', () => run({ showErrorNow: false }));
  input.addEventListener('change', () => run({ showErrorNow: true }));
  showPreview();
  return input;
}

/** A labelled on/off switch. Returns the checkbox <input>. */
export function addCheckbox(panel, { label, checked = false, onChange }) {
  const row = el('label', 'control-checkbox');
  const input = el('input');
  Object.assign(input, { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange?.(input.checked));
  row.append(input, el('span', 'switch'), el('span', '', label));
  panel.append(row);
  return input;
}

/**
 * A row of buttons. buttons: [{ label: 'Play', icon: 'play', primary: true, onClick: () => {...} }, ...]
 * Returns the <button> elements; change one later with setButtonLabel(button, 'Pause', 'pause').
 */
export function addButtons(panel, buttons) {
  const row = el('div', 'button-row');
  const elements = buttons.map(({ label, icon: iconName, onClick, primary }) => {
    const button = el('button', primary ? 'btn small primary' : 'btn small');
    button.type = 'button';
    setButtonLabel(button, label, iconName);
    button.addEventListener('click', onClick);
    row.append(button);
    return button;
  });
  panel.append(row);
  return elements;
}

/** Set a button's text, with an optional icon in front. */
export function setButtonLabel(button, label, iconName) {
  button.innerHTML = iconName ? icon(iconName) : '';
  button.append(document.createTextNode(label));
}

/**
 * A label/value line for live numbers. Set `wide: true` for long formulas.
 *   const det = addReadout(panel, 'det(A)');  det.text('2.5');  det.math('\\lambda = 2');
 */
export function addReadout(panel, label, { wide = false } = {}) {
  const row = el('div', wide ? 'readout wide' : 'readout');
  const value = el('span', 'readout-value');
  row.append(el('span', 'readout-label', label), value);
  panel.append(row);
  let last = null; // skip re-rendering identical content (KaTeX is not free)
  return {
    text(content) {
      if (last === `t:${content}`) return;
      last = `t:${content}`;
      value.textContent = content;
    },
    math(tex) {
      if (last === `m:${tex}`) return;
      last = `m:${tex}`;
      value.innerHTML = renderMath(tex);
    },
  };
}

/**
 * A 2×2 matrix you can type into. Column 1 is green (where î lands), column 2 is red (where ĵ lands).
 *   const m = addMatrixInput(panel, { label: 'A', value: { a: 1, b: 0, c: 0, d: 1 }, onInput: (M) => {...} });
 *   m.set({ a, b, c, d });   // update the boxes (does not call onInput)
 */
export function addMatrixInput(panel, { label, value, onInput, digits = 2 }) {
  const row = el('div', 'control');
  if (label) row.append(el('span', 'control-label', label));
  const grid = el('div', 'matrix-input');
  const inputs = {};
  const current = { ...value };
  const formatEntry = (v) => String(Number(v.toFixed(digits)));

  for (const key of ['a', 'b', 'c', 'd']) {
    const input = el('input', key === 'a' || key === 'c' ? 'col-i' : 'col-j');
    Object.assign(input, { type: 'text', inputMode: 'decimal', spellcheck: false, autocomplete: 'off', value: formatEntry(current[key]) });
    input.setAttribute('aria-label', `${label ?? 'matrix'} entry ${key}`);
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => {
      const v = readNumber(input.value);
      input.classList.toggle('invalid', !Number.isFinite(v) && input.value.trim() !== '' && input.value.trim() !== '-');
      if (Number.isFinite(v)) {
        current[key] = v;
        onInput?.({ ...current });
      }
    });
    input.addEventListener('change', () => {
      input.value = formatEntry(current[key]);
      input.classList.remove('invalid');
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        current[key] = Number((current[key] + (event.key === 'ArrowUp' ? 0.1 : -0.1) * (event.shiftKey ? 10 : 1)).toFixed(6));
        input.value = formatEntry(current[key]);
        onInput?.({ ...current });
      }
      if (event.key === 'Enter') input.blur();
    });
    inputs[key] = input;
  }
  grid.append(inputs.a, inputs.b, inputs.c, inputs.d);
  row.append(grid);
  panel.append(row);

  return {
    set(M) {
      for (const key of ['a', 'b', 'c', 'd']) {
        current[key] = M[key];
        if (document.activeElement !== inputs[key]) inputs[key].value = formatEntry(M[key]);
      }
    },
    get() {
      return { ...current };
    },
    element: row,
  };
}

/**
 * A lesson in steps: a numbered timeline you can jump around, the current step's narration,
 * an optional "Look for" line that points at the visual, and Back / Next. ← and → keys work too.
 * Each step's enter() sets up the scene (e.g. animates to a matrix), so the picture and the
 * text always change together.
 *   const lesson = addSteps(container, [
 *     { title: 'Start here', text: 'Markdown with $math$', focus: 'Watch the green arrow.', enter: () => {...} },
 *     ...
 *   ], { onChange: (index) => {...} });
 *   lesson.go(0);
 */
export function addSteps(container, steps, { onChange } = {}) {
  const rail = el('section', 'rail');
  rail.setAttribute('aria-label', 'Lesson steps');

  const track = el('ol', 'rail-track');
  const nodes = steps.map((step, i) => {
    const item = el('li');
    const node = el('button', 'rail-node');
    node.type = 'button';
    node.title = step.title;
    node.setAttribute('aria-label', `Step ${i + 1}: ${step.title}`);
    node.append(el('span', 'rail-num', String(i + 1)), el('span', 'rail-label', step.title));
    node.addEventListener('click', () => go(i));
    item.append(node);
    track.append(item);
    return node;
  });

  const card = el('div', 'rail-card');
  const meta = el('div', 'rail-meta');
  const title = el('h3', 'rail-title');
  const body = el('div', 'rail-body');
  const bodyText = el('div', 'rail-text');
  const bodyMore = el('button', 'scroll-more', 'Scroll to read more');
  bodyMore.type = 'button';
  bodyMore.hidden = true;
  bodyMore.insertAdjacentHTML('beforeend', icon('down', 14));
  bodyMore.addEventListener('click', () => body.scrollBy({ top: body.clientHeight * 0.7, behavior: 'smooth' }));
  body.append(bodyText, bodyMore);
  body.tabIndex = 0; // the keyboard can scroll it too
  const focus = el('p', 'rail-focus');
  const nav = el('div', 'rail-nav');
  const back = el('button', 'btn');
  const next = el('button', 'btn primary');
  back.type = next.type = 'button';
  setButtonLabel(back, 'Back', 'left');
  nav.append(back, next);
  card.append(meta, title, body, focus, nav);
  rail.append(track, card);
  container.append(rail);

  let index = 0;
  let started = false;
  function go(i) {
    index = Math.max(0, Math.min(steps.length - 1, i));
    const byReader = started; // the first go() is the page setting up, not the reader
    started = true;
    const step = steps[index];
    meta.textContent = `Step ${index + 1} of ${steps.length}`;
    title.textContent = step.title;
    bodyText.innerHTML = renderMarkdown(step.text);
    body.scrollTop = 0;
    requestAnimationFrame(markOverflow);
    focus.replaceChildren();
    if (step.focus) {
      focus.innerHTML = icon('eye');
      const words = el('span');
      words.innerHTML = renderMarkdownInline(step.focus);
      words.prepend(el('strong', '', 'Look for '));
      focus.append(words);
    }
    back.disabled = index === 0;
    const last = index === steps.length - 1;
    next.innerHTML = '';
    next.append(document.createTextNode(last ? 'Start over' : 'Next'));
    next.insertAdjacentHTML('beforeend', icon(last ? 'restart' : 'right'));
    nodes.forEach((node, k) => {
      node.classList.toggle('active', k === index);
      node.classList.toggle('done', k < index);
      node.setAttribute('aria-current', k === index ? 'step' : 'false');
    });
    // keep the current step visible in the timeline without scrolling the page
    const node = nodes[index];
    track.scrollLeft = node.offsetLeft - track.clientWidth / 2 + node.clientWidth / 2;
    step.enter?.();
    onChange?.(index);
    rail.dispatchEvent(new CustomEvent('lessonstep', { bubbles: true, detail: { index, byReader } }));
  }
  back.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index === steps.length - 1 ? 0 : index + 1));

  // Long step text scrolls inside its box. Say so plainly, until the reader reaches the end.
  function markOverflow() {
    const scrollable = getComputedStyle(body).overflowY !== 'visible';
    const overflowing = scrollable && bodyText.scrollHeight > body.clientHeight + 4;
    body.classList.toggle('overflowing', overflowing);
    bodyMore.hidden = !overflowing || body.scrollTop + body.clientHeight >= body.scrollHeight - 6;
  }
  body.addEventListener('scroll', markOverflow, { passive: true });
  const watcher = new ResizeObserver(markOverflow);
  watcher.observe(body);
  watcher.observe(bodyText);

  // ← / → move through the steps (unless you're typing somewhere). Removes itself with the page.
  const onKey = (event) => {
    if (!rail.isConnected) return document.removeEventListener('keydown', onKey);
    if (event.metaKey || event.ctrlKey || event.altKey || document.querySelector('dialog[open]')) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'ArrowRight' && index < steps.length - 1) go(index + 1);
    if (event.key === 'ArrowLeft' && index > 0) go(index - 1);
  };
  document.addEventListener('keydown', onKey);

  return {
    go,
    get index() {
      return index;
    },
    element: rail,
  };
}
