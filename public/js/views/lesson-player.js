// Shows an AI lesson: title, intro, the visualization (sandboxed iframe) with the step rail under
// it, key ideas, the related built-in lesson, and all steps on one page. Used by Ask and Notebook.
//
// Page ⇄ visualization messages (see public/viz-kit/kit.js):
//   viz → page  { type: 'mathlens:ready' }               the kit has started; send the current step
//   page → viz  { type: 'mathlens:step', index, count }  show this step
//   viz → page  { type: 'mathlens:goto', index }         an in-scene action asks for another step
//   viz → page  { type: 'mathlens:height', height }      content height (used when the frame can grow)

import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { renderMarkdown } from '../lib/markdown.js';
import { addSteps } from '../lib/controls.js';
import { themeCss, onThemeChange } from '../lib/theme.js';
import { findTopic } from '../topics.js';
import { bringIntoView } from './topic-view.js';
import { addLessonChat } from './lesson-chat.js';

// The viz kit (base styles, equation helper, step protocol) goes into every visualization.
let kit = { css: '', js: '', graph: '' };
const kitReady = Promise.all(['viz-kit/kit.css', 'viz-kit/kit.js', 'viz-kit/graph.js'].map((url) => fetch(url).then((r) => (r.ok ? r.text() : '')).catch(() => '')))
  .then(([css, js, graph]) => {
    kit = { css, js, graph };
  });

const VIZ_FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap';

/**
 * Render a lesson into `container`.
 * @param {HTMLElement} container
 * @param {object} answer - { title, intro, steps: [{ title, explanation, visualFocus }], keyIdeas, visualizationHtml, relatedBuiltInTopic }
 * @param {{ kicker?: string, note?: HTMLElement, lessonId?: number }} options - note: extra line under the title (e.g. "saved"); lessonId: turns on the chat
 * @returns {Promise<() => void>} cleanup
 */
export async function showLesson(container, answer, { kicker, note, lessonId } = {}) {
  await kitReady;
  const steps = answer.steps?.length ? answer.steps : [{ title: answer.title, explanation: answer.explanation ?? '', visualFocus: '' }];

  const article = el('article', 'ai-lesson');
  const header = el('header', 'lesson-head');
  header.append(el('p', 'kicker', kicker ?? `A lesson in ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`), el('h2', 'lesson-title', answer.title));
  if (answer.intro) {
    const intro = el('div', 'lede');
    intro.innerHTML = renderMarkdown(answer.intro);
    header.append(intro);
  }
  if (note) header.append(note);

  const lessonCard = el('section', 'lesson fit');
  const stage = el('div', 'lesson-stage');
  let lesson = null;
  const picture = await createPictureFrame({ title: answer.title, card: lessonCard, stepCount: steps.length, getStep: () => lesson?.index ?? 0 });
  picture.setHtml(answer.visualizationHtml);
  const frame = picture.frame;
  stage.append(frame);
  const stopWatchingStage = watchStage(stage, frame);
  const rail = el('div', 'lesson-rail');
  lessonCard.append(stage, addResizeHandle(lessonCard, frame), rail);

  lesson = addSteps(
    rail,
    steps.map((step, i) => ({ title: step.title, text: step.explanation, focus: step.visualFocus, enter: () => picture.sendStep(i) })),
  );
  const stopChat = lessonId
    ? addLessonChat({
        rail: lesson,
        card: lessonCard,
        target: { lessonId },
        picture: { show: (html) => picture.setHtml(html), reset: () => picture.setHtml(answer.visualizationHtml) },
      })
    : () => {};

  // After the lesson: key ideas, the related built-in lesson, and everything on one page
  const after = el('div', 'after-lesson');
  if (answer.keyIdeas?.length) {
    const box = el('section', 'key-ideas');
    box.append(el('h3', '', 'What to remember'));
    const list = el('div');
    list.innerHTML = renderMarkdown(answer.keyIdeas.map((idea) => `- ${idea}`).join('\n'));
    box.append(list);
    after.append(box);
  }
  const related = findTopic(answer.relatedBuiltInTopic);
  if (related) {
    const link = el('a', 'related-lesson');
    link.href = `#/topic/${related.id}`;
    const text = el('span');
    text.append(el('small', '', 'Practise it in a MathLens lesson'), el('strong', '', related.title), el('span', 'muted', related.summary));
    link.append(text);
    link.insertAdjacentHTML('beforeend', icon('right'));
    after.append(link);
  }

  const transcript = el('details', 'transcript');
  transcript.append(el('summary', '', 'Read all the steps on one page'));
  const all = el('div', 'explanation');
  all.innerHTML = steps
    .map((step, i) => `<h3>${i + 1}. ${escapeHtml(step.title)}</h3>${renderMarkdown(step.explanation)}${step.visualFocus ? `<div class="muted">${renderMarkdown(step.visualFocus)}</div>` : ''}`)
    .join('');
  transcript.append(all);

  article.append(header, lessonCard, after, transcript);
  container.replaceChildren(article);
  lesson.go(0);
  lessonCard.addEventListener('lessonstep', (event) => {
    if (event.detail.byReader) bringIntoView(lessonCard);
  });
  lessonCard.addEventListener('picturegoto', (event) => lesson.go(event.detail.index));

  return () => {
    picture.destroy();
    stopChat();
    stopWatchingStage();
  };
}

/**
 * A sandboxed frame for an AI-written picture: it can't touch this page, cookies or storage
 * ("allow-scripts" without "allow-same-origin"). Keeps it on the current step and in the current
 * theme, and lights up the picture when a coloured phrase in the card is hovered or tapped.
 */
export async function createPictureFrame({ title, card, stepCount, getStep }) {
  await kitReady;
  const frame = el('iframe', 'ai-frame');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.title = `Interactive visualization: ${title}`;
  let html = '';
  const render = () => {
    frame.dataset.resizes = '0';
    frame.style.height = '';
    frame.srcdoc = withTheme(html, { stepCount, step: getStep() });
  };
  const sendStep = (index) => frame.contentWindow?.postMessage({ type: 'mathlens:step', index, count: stepCount }, '*');

  const sendHighlight = (color) => frame.contentWindow?.postMessage({ type: 'mathlens:highlight', color }, '*');
  let tappedRef = null;
  const onOver = (event) => {
    const ref = event.target.closest?.('.ml-ref');
    if (ref && event.pointerType === 'mouse') sendHighlight(ref.dataset.ref);
  };
  const onOut = (event) => {
    if (event.target.closest?.('.ml-ref') && event.pointerType === 'mouse') sendHighlight(null);
  };
  const onTap = (event) => {
    const ref = event.target.closest?.('.ml-ref');
    if (!ref || !matchMedia('(hover: none)').matches) return;
    tappedRef = tappedRef === ref ? null : ref;
    sendHighlight(tappedRef ? ref.dataset.ref : null);
  };
  card.addEventListener('pointerover', onOver);
  card.addEventListener('pointerout', onOut);
  card.addEventListener('click', onTap);

  const onMessage = (event) => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data ?? {};
    if (data.type === 'mathlens:ready') sendStep(getStep());
    if (data.type === 'mathlens:goto') card.dispatchEvent(new CustomEvent('picturegoto', { detail: { index: Number(data.index) || 0 } }));
    if (data.type === 'mathlens:height') fitFrame(frame, data.height);
  };
  window.addEventListener('message', onMessage);
  const stopWatchingTheme = onThemeChange(() => {
    if (html) render();
  }); // new colours, same step

  return {
    frame,
    sendStep,
    setHtml(next) {
      html = next;
      render();
    },
    destroy() {
      window.removeEventListener('message', onMessage);
      stopWatchingTheme();
      card.removeEventListener('pointerover', onOver);
      card.removeEventListener('pointerout', onOut);
      card.removeEventListener('click', onTap);
    },
  };
}

/** Says so when a picture is taller than its space, and scrolls to the rest. */
export function watchStage(stage, frame) {
  const more = el('button', 'scroll-more', 'More of this picture below');
  more.type = 'button';
  more.hidden = true;
  more.insertAdjacentHTML('beforeend', icon('down', 14));
  more.addEventListener('click', () => stage.scrollBy({ top: stage.clientHeight * 0.7, behavior: 'smooth' }));
  stage.append(more);
  let stageHeight = stage.clientHeight;
  const mark = () => {
    if (stage.clientHeight !== stageHeight) {
      stageHeight = stage.clientHeight;
      frame.style.height = '';
      frame.dataset.resizes = '0';
    }
    const overflowing = window.matchMedia('(min-width: 721px) and (min-height: 560px)').matches && frame.getBoundingClientRect().height > stage.clientHeight + 4;
    more.hidden = !overflowing || stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 8;
    stage.classList.toggle('overflowing', overflowing);
  };
  stage.addEventListener('scroll', mark, { passive: true });
  const watcher = new ResizeObserver(mark);
  watcher.observe(stage);
  watcher.observe(frame);
  return () => {
    watcher.disconnect();
    stage.removeEventListener('scroll', mark);
    more.remove();
  };
}

/** The handle between the picture and the text. */
export function addResizeHandle(card, frame) {
  const grip = el('div', 'lesson-grip');
  grip.title = 'Drag to make the picture or the text bigger';
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'horizontal');
  grip.setAttribute('aria-label', 'Resize the picture and the text');
  grip.tabIndex = 0;
  makeResizable(grip, card, frame);
  return grip;
}

/** Dragging the handle moves the line between the picture and the text. */
function makeResizable(grip, card, frame) {
  const setHeight = (height) => {
    const box = card.getBoundingClientRect();
    const track = card.querySelector('.rail-track')?.getBoundingClientRect().height ?? 60;
    const limited = Math.max(150, Math.min(box.height - track - 170, height));
    card.style.setProperty('--rail-card-height', `${Math.round(limited)}px`);
    if (frame) {
      frame.style.height = ''; // the picture refits itself to the new space
      frame.dataset.resizes = '0';
    }
  };
  const current = () => card.querySelector('.rail-card')?.getBoundingClientRect().height ?? 260;
  let startY = 0;
  let startHeight = 0;
  grip.addEventListener('pointerdown', (event) => {
    grip.setPointerCapture(event.pointerId);
    grip.classList.add('dragging');
    startY = event.clientY;
    startHeight = current();
  });
  grip.addEventListener('pointermove', (event) => {
    if (grip.hasPointerCapture(event.pointerId)) setHeight(startHeight + startY - event.clientY);
  });
  const stop = () => grip.classList.remove('dragging');
  grip.addEventListener('pointerup', stop);
  grip.addEventListener('pointercancel', stop);
  grip.addEventListener('dblclick', () => {
    card.style.removeProperty('--rail-card-height');
    if (frame) frame.style.height = '';
  });
  grip.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    setHeight(current() + (event.key === 'ArrowUp' ? 30 : -30));
  });
}

/** Grow the frame for real overflow (never below the stage), and stop after a few changes so
 *  layouts sized by the frame (100vh) can't loop. */
function fitFrame(frame, reported) {
  const inFittedLesson = Boolean(frame.closest('.lesson.fit')) && window.matchMedia('(min-width: 721px) and (min-height: 560px)').matches;
  const floor = inFittedLesson ? frame.parentElement.clientHeight : 420;
  const target = Math.max(floor, Math.min(1100, Math.ceil(Number(reported) || 0)));
  if (inFittedLesson && target <= floor + 5) {
    frame.style.height = ''; // it fits: follow the stage's height as that changes
    return;
  }
  const currentHeight = frame.getBoundingClientRect().height;
  const resizes = Number(frame.dataset.resizes || 0);
  const change = target - currentHeight;
  if (resizes >= 6 || (change > 0 && change < 6) || (change < 0 && change > -40)) return;
  frame.dataset.resizes = String(resizes + 1);
  frame.style.height = `${target}px`;
}

/** Add theme colours, fonts, the step count and the viz kit to the AI's HTML. */
function withTheme(html, { stepCount = 0, step = 0 } = {}) {
  const head = [
    `<link rel="stylesheet" href="${VIZ_FONTS}">`,
    `<style id="mathlens-theme">${themeCss()}\n${kit.css}</style>`,
    `<script>window.MATHLENS_STEP_COUNT = ${Number(stepCount) || 0}; window.MATHLENS_INITIAL_STEP = ${Number(step) || 0};</script>`,
    `<script>${kit.js.replace(/<\/script/gi, '<\\/script')}</script>`,
    `<script>${kit.graph.replace(/<\/script/gi, '<\\/script')}</script>`,
  ].join('');
  if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (tag) => tag + head);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${head}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${html}</body></html>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
