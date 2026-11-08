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

// The viz kit (base styles, equation helper, step protocol) goes into every visualization.
let kit = { css: '', js: '' };
const kitReady = Promise.all(['viz-kit/kit.css', 'viz-kit/kit.js'].map((url) => fetch(url).then((r) => (r.ok ? r.text() : '')).catch(() => '')))
  .then(([css, js]) => {
    kit = { css, js };
  });

const VIZ_FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap';

/**
 * Render a lesson into `container`.
 * @param {HTMLElement} container
 * @param {object} answer - { title, intro, steps: [{ title, explanation, visualFocus }], keyIdeas, visualizationHtml, relatedBuiltInTopic }
 * @param {{ kicker?: string, note?: HTMLElement }} options - note: extra line under the title (e.g. "saved")
 * @returns {Promise<() => void>} cleanup
 */
export async function showLesson(container, answer, { kicker, note } = {}) {
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

  // The visualization is untrusted code, so it runs in a sandboxed iframe:
  // "allow-scripts" without "allow-same-origin" means it can't touch this page, cookies or storage.
  const lessonCard = el('section', 'lesson fit');
  const stage = el('div', 'lesson-stage');
  const frame = el('iframe', 'ai-frame');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.title = `Interactive visualization: ${answer.title}`;
  frame.srcdoc = withTheme(answer.visualizationHtml, { stepCount: steps.length, step: 0 });
  stage.append(frame);
  const rail = el('div', 'lesson-rail');
  lessonCard.append(stage, rail);

  const sendStep = (index) => frame.contentWindow?.postMessage({ type: 'mathlens:step', index, count: steps.length }, '*');
  const lesson = addSteps(
    rail,
    steps.map((step, i) => ({ title: step.title, text: step.explanation, focus: step.visualFocus, enter: () => sendStep(i) })),
  );

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
    .map((step, i) => `<h3>${i + 1}. ${escapeHtml(step.title)}</h3>${renderMarkdown(step.explanation)}${step.visualFocus ? `<p class="muted">${escapeHtml(step.visualFocus)}</p>` : ''}`)
    .join('');
  transcript.append(all);

  article.append(header, lessonCard, after, transcript);
  container.replaceChildren(article);
  lesson.go(0);
  lessonCard.addEventListener('lessonstep', (event) => {
    if (event.detail.byReader) bringIntoView(lessonCard);
  });

  const onMessage = (event) => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data ?? {};
    if (data.type === 'mathlens:ready') sendStep(lesson.index);
    if (data.type === 'mathlens:goto') lesson.go(Number(data.index) || 0);
    if (data.type === 'mathlens:height') fitFrame(frame, data.height);
  };
  window.addEventListener('message', onMessage);

  // New colours when the theme changes, staying on the same step
  const stopWatchingTheme = onThemeChange(() => {
    frame.dataset.resizes = '0';
    frame.srcdoc = withTheme(answer.visualizationHtml, { stepCount: steps.length, step: lesson.index });
  });

  return () => {
    window.removeEventListener('message', onMessage);
    stopWatchingTheme();
  };
}

/** Grow the frame for real overflow (never below the stage), and stop after a few changes so
 *  layouts sized by the frame (100vh) can't loop. */
function fitFrame(frame, reported) {
  const inFittedLesson = Boolean(frame.closest('.lesson.fit')) && window.matchMedia('(min-width: 721px) and (min-height: 560px)').matches;
  const floor = inFittedLesson ? frame.parentElement.clientHeight : 420;
  const target = Math.max(floor, Math.min(1100, Math.ceil(Number(reported) || 0)));
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
  ].join('');
  if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (tag) => tag + head);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${head}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${html}</body></html>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
