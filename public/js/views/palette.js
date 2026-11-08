// The search palette: type to find a lesson, or send the text to the AI tutor.
// Opens with / or Ctrl/Cmd+K, or the search button in the top bar.

import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { topics, pathOf } from '../topics.js';
import { listLessons } from '../lib/notebook.js';

export function openPalette() {
  if (document.querySelector('dialog.palette[open]')) return;

  const dialog = el('dialog', 'palette');
  dialog.setAttribute('aria-label', 'Search lessons or ask a question');
  const field = el('div', 'palette-field');
  field.innerHTML = icon('search', 18);
  const input = el('input');
  Object.assign(input, { type: 'text', placeholder: 'Find a lesson, or type a question for the tutor', autocomplete: 'off', spellcheck: false });
  input.setAttribute('aria-label', 'Search');
  const hint = el('kbd', '', 'esc');
  field.append(input, hint);
  const list = el('ul', 'palette-list');
  list.setAttribute('role', 'listbox');
  dialog.append(field, list);
  document.body.append(dialog);

  let items = [];
  let selected = 0;
  let saved = [];
  listLessons()
    .then((lessons) => {
      saved = lessons;
      render();
    })
    .catch(() => {});

  function render() {
    const query = input.value.trim();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = topics.filter((topic) => {
      const haystack = `${topic.title} ${topic.category} ${topic.summary} ${pathOf(topic.id)?.path.title ?? ''}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });

    items = matches.map((topic) => ({
      kind: 'Lesson',
      title: topic.title,
      detail: `${pathOf(topic.id)?.path.title ?? topic.category} · ${topic.level}`,
      icon: 'book',
      go: () => (location.hash = `#/topic/${topic.id}`),
    }));
    const savedMatches = saved.filter((lesson) => {
      const haystack = `${lesson.title} ${lesson.question} ${lesson.sourceName ?? ''}`.toLowerCase();
      return words.length && words.every((word) => haystack.includes(word));
    });
    for (const lesson of savedMatches.slice(0, 4)) {
      items.push({ kind: 'Saved', title: lesson.title, detail: 'In your notebook, free to open', icon: 'book', go: () => (location.hash = `#/notebook/${lesson.id}`) });
    }
    if (query) {
      items.push({
        kind: 'Ask',
        title: `Teach me: ${query}`,
        detail: 'A step-by-step lesson from the tutor',
        icon: 'ask',
        go: () => (location.hash = `#/ask?q=${encodeURIComponent(query)}&go=1`),
      });
    }
    if (!query || /graph|plot|calculator|desmos/i.test(query)) {
      items.push({ kind: 'Tool', title: 'Graph Lab', detail: 'Type equations, get sliders', icon: 'graph', go: () => (location.hash = '#/graph') });
    }
    // With a query that matches no lesson, asking the AI is the obvious choice
    selected = Math.min(selected, items.length - 1);
    if (query && !matches.length && !savedMatches.length) selected = 0;

    list.replaceChildren();
    items.forEach((item, i) => {
      const row = el('li', i === selected ? 'palette-item selected' : 'palette-item');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === selected));
      const badge = el('span', 'palette-icon');
      badge.innerHTML = icon(item.icon, 16);
      const text = el('span', 'palette-text');
      text.append(el('strong', '', item.title), el('small', '', item.detail));
      row.append(badge, text, el('span', 'palette-kind', item.kind));
      row.addEventListener('mousemove', () => {
        if (selected !== i) {
          selected = i;
          render();
        }
      });
      row.addEventListener('click', () => choose(i));
      list.append(row);
    });
  }

  function choose(i) {
    const item = items[i];
    if (!item) return;
    dialog.close();
    item.go();
  }

  input.addEventListener('input', () => {
    selected = 0;
    render();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selected = (selected + 1) % items.length;
      render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selected = (selected - 1 + items.length) % items.length;
      render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(selected);
    }
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());

  render();
  dialog.showModal();
  input.focus();
}
