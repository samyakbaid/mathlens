// Notebook: every lesson you've asked the tutor for, saved. Opening one costs nothing.
//   #/notebook        the list, with search
//   #/notebook/<id>   one saved lesson

import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { listLessons, getLesson, deleteLesson, friendlyDate } from '../lib/notebook.js';
import { showLesson } from './lesson-player.js';
import { lessonCard } from './ask-view.js';

// What the server asks when someone attaches a paper without typing a question
const DEFAULT_PAPER_QUESTION = 'Explain the main idea of this document.';

export function showNotebook(view, { id } = {}) {
  return id ? showSavedLesson(view, id) : showList(view);
}

function showList(view) {
  view.innerHTML = `
    <div class="page notebook-page">
      <header class="notebook-head">
        <p class="kicker">Your notebook</p>
        <h1>Everything you've asked, <em>kept for you.</em></h1>
        <p class="lede">Every lesson the tutor makes for you lands here. Open any of them again whenever you like. It doesn't use up an answer.</p>
        <input class="notebook-search" type="search" placeholder="Search your lessons" aria-label="Search your lessons" />
      </header>
      <div class="notebook-list"><p class="muted">Loading your lessons…</p></div>
    </div>
  `;
  const list = view.querySelector('.notebook-list');
  const search = view.querySelector('.notebook-search');
  let lessons = [];

  const render = () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = lessons.filter((l) => words.every((w) => `${l.title} ${l.question} ${l.sourceName ?? ''}`.toLowerCase().includes(w)));
    list.replaceChildren();
    if (!lessons.length) {
      const empty = el('div', 'notebook-empty');
      empty.append(el('h2', '', 'Nothing here yet'), el('p', 'muted', 'Ask the tutor a question and the lesson will be saved here automatically.'));
      const go = el('a', 'btn primary', 'Ask a question');
      go.href = '#/ask';
      empty.append(go);
      list.append(empty);
      return;
    }
    if (!matches.length) {
      list.append(el('p', 'muted', 'No saved lesson matches that search.'));
      return;
    }
    const grid = el('div', 'lesson-grid');
    for (const lesson of matches) grid.append(lessonCard(lesson));
    list.append(grid);
  };

  listLessons()
    .then((items) => {
      lessons = items;
      render();
    })
    .catch((err) => list.replaceChildren(el('div', 'error-box', err.message)));
  search.addEventListener('input', render);
  return () => {};
}

function showSavedLesson(view, id) {
  view.innerHTML = `<div class="page"><nav class="crumb"><a href="#/notebook">Your notebook</a><span class="crumb-sep">/</span><span>Saved lesson</span></nav><div class="saved-lesson"><p class="muted">Opening…</p></div></div>`;
  const container = view.querySelector('.saved-lesson');
  let stop = null;
  let cancelled = false;

  getLesson(id)
    .then(async (lesson) => {
      if (cancelled) return;
      const note = el('div', 'lesson-note');
      note.innerHTML = icon('book', 14);
      const ownQuestion = lesson.question && lesson.question !== DEFAULT_PAPER_QUESTION ? lesson.question : '';
      const asked = lesson.sourceName ? `${lesson.sourceName}${ownQuestion ? `: "${ownQuestion}"` : ''}` : `"${lesson.question}"`;
      note.append(`${lesson.sourceName ? 'From' : 'You asked'} ${asked} · saved ${friendlyDate(lesson.createdAt)}`);

      // Two-step delete, so a stray click can't remove a lesson
      const remove = el('button', 'link-button danger');
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        if (remove.dataset.confirm !== '1') {
          remove.dataset.confirm = '1';
          remove.textContent = 'Delete this lesson? Click again';
          return;
        }
        await deleteLesson(id);
        location.hash = '#/notebook';
      });
      note.append(' · ', remove);

      stop = await showLesson(container, lesson.answer, {
        kicker: lesson.sourceName ? `From ${lesson.sourceName}` : `Saved lesson · ${lesson.steps} steps`,
        note,
        lessonId: lesson.id,
      });
    })
    .catch((err) => container.replaceChildren(el('div', 'error-box', err.message)));

  return () => {
    cancelled = true;
    stop?.();
  };
}
