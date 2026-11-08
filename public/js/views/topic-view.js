// A built-in lesson page:
//   header (path · station n of m, title, summary)
//   the lesson card: the visual on top, the step-by-step rail directly under it
//   the instruments: the topic's controls, grouped into cards in a row
//   the notes (the written explanation), then the next station on the path

import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { renderMarkdown } from '../lib/markdown.js';
import { pathOf, markVisited } from '../topics.js';

/**
 * Shows one topic. Returns the topic's cleanup function (stops animations etc.).
 *
 * The topic's mount() receives three empty containers:
 *   plotArea  - where canvases go
 *   controls  - where sliders, buttons and readouts go (grouped into cards by each addHeading)
 *   lesson    - where the step-by-step rail goes (addSteps(lesson, [...]))
 */
export function showTopic(view, topic) {
  view.replaceChildren();
  markVisited(topic.id);
  const place = pathOf(topic.id);

  const page = el('div', 'page lesson-page');

  const header = el('header', 'lesson-head');
  const crumb = el('nav', 'crumb');
  crumb.setAttribute('aria-label', 'Breadcrumb');
  const home = el('a', '', 'Explore');
  home.href = '#/';
  crumb.append(home);
  if (place) {
    crumb.append(el('span', 'crumb-sep', '/'), el('span', '', place.path.title), el('span', 'crumb-sep', '/'), el('span', '', `Station ${place.index + 1} of ${place.path.topics.length}`));
  }
  header.append(crumb, el('h1', '', topic.title), el('p', 'lede', topic.summary));

  const lessonCard = el('section', 'lesson fit');
  const plotArea = el('div', 'plot-area lesson-stage');
  const lesson = el('div', 'lesson-rail');
  lessonCard.append(plotArea, lesson);

  const controls = el('div', 'controls');

  const notes = el('article', 'explanation notes');
  notes.innerHTML = `<p class="notes-kicker">Notes</p>${renderMarkdown(topic.explanation)}`;

  const askLink = el('a', 'btn ask-about');
  askLink.href = `#/ask?q=${encodeURIComponent(`${topic.title}: `)}`;
  askLink.innerHTML = icon('ask');
  askLink.append(`Still stuck? Ask the tutor about ${topic.title.toLowerCase()}`);
  notes.append(askLink);

  page.append(header, lessonCard, controls, notes);
  if (place) page.append(pathNav(place));
  view.append(page);

  const cleanup = topic.mount({ plotArea, controls, lesson });
  groupInstruments(controls);
  if (!lesson.children.length) lessonCard.classList.remove('fit');
  shareStageHeight(plotArea);
  lessonCard.addEventListener('lessonstep', (event) => {
    if (event.detail.byReader) bringIntoView(lessonCard);
  });
  return cleanup;
}

/**
 * Topics give each plot a fixed height. In the screen-sized lesson card, let the plots share the
 * available height instead, in the same proportions, so the visual and the step text fit together.
 */
function shareStageHeight(stage) {
  for (const wrap of stage.querySelectorAll('.plot-wrap')) {
    const canvas = wrap.querySelector('canvas.plot');
    const height = parseFloat(canvas?.style.height) || 400;
    wrap.style.setProperty('--share', String(height));
    wrap.style.setProperty('--natural', `${height}px`);
    wrap.classList.add('shared');
  }
}

/** Scroll so the whole lesson card is on screen (when the reader moves to another step). */
export function bringIntoView(card) {
  const rect = card.getBoundingClientRect();
  const top = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-height')) || 64) + 12;
  if (rect.top >= top - 4 && rect.bottom <= window.innerHeight + 4) return;
  window.scrollTo({ top: window.scrollY + rect.top - top, behavior: 'smooth' });
}

/**
 * Topics add their controls one after another, with addHeading() starting each section.
 * Wrap every heading and the controls after it into a card, so they sit side by side.
 */
function groupInstruments(controls) {
  const children = [...controls.children];
  controls.replaceChildren();
  controls.className = 'instruments';
  let group = null;
  for (const child of children) {
    if (child.classList.contains('control-heading') || !group) {
      group = el('div', 'instrument');
      controls.append(group);
    }
    group.append(child);
  }
  if (!controls.children.length) controls.remove();
}

/** Previous / next station on the path. */
function pathNav({ path, previous, next }) {
  const nav = el('nav', 'path-nav');
  nav.setAttribute('aria-label', `${path.title} path`);
  const card = (topic, label, direction) => {
    const link = el('a', `path-step ${direction}`);
    link.href = `#/topic/${topic.id}`;
    const text = el('span');
    text.append(el('small', '', label), el('strong', '', topic.title));
    if (direction === 'previous') {
      link.innerHTML = icon('left');
      link.append(text);
    } else {
      link.append(text);
      link.insertAdjacentHTML('beforeend', icon('right'));
    }
    return link;
  };
  if (previous) nav.append(card(previous, 'Previous station', 'previous'));
  else nav.append(el('span'));
  if (next) nav.append(card(next, `Next on the ${path.title.toLowerCase()} path`, 'next'));
  else {
    const done = el('a', 'path-step next');
    done.href = '#/';
    const text = el('span');
    text.append(el('small', '', `End of the ${path.title.toLowerCase()} path`), el('strong', '', 'Back to all paths'));
    done.append(text);
    done.insertAdjacentHTML('beforeend', icon('right'));
    nav.append(done);
  }
  return nav;
}
