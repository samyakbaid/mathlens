// Ask: type a question, or attach a paper, and the AI tutor answers with a lesson in steps plus a
// visualization that changes with every step. Every lesson is saved to the notebook, so asking
// the same thing again is free.

import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { askAI } from '../lib/api.js';
import { applyBilling, allowanceText, onAccountChange, refreshAccount } from '../lib/account.js';
import { listLessons, similarLessons, friendlyDate } from '../lib/notebook.js';
import { readDocument, ACCEPTED } from '../lib/documents.js';
import { openAuthDialog, openCreditsDialog } from './account-ui.js';
import { showLesson } from './lesson-player.js';
import { topics } from '../topics.js';

const EXAMPLES = [
  'What does the Jacobian determinant mean geometrically?',
  'Show me gradient descent on a 2D loss surface',
  'Explain the singular value decomposition visually',
  "What is a Markov chain's stationary distribution?",
  'How does the Fourier transform separate frequencies?',
  'What is a Lagrange multiplier?',
];

const THINKING = ['Reading your question', 'Planning the steps', 'Working out the math', 'Building the picture', 'Checking every equation', 'Putting the lesson together'];
const THINKING_PAPER = ['Reading the paper', 'Finding the main idea', 'Rebuilding the equations', 'Planning the steps', 'Building the picture', 'Putting the lesson together'];

/**
 * @param {HTMLElement} view
 * @param {{question?: string, autoSubmit?: boolean}} options
 * @returns {() => void} cleanup
 */
export function showAskPage(view, { question = '', autoSubmit = false } = {}) {
  view.innerHTML = `
    <div class="page ask-page">
      <header class="ask-hero">
        <p class="kicker">The tutor</p>
        <h1>Stuck on something? <em>We'll go one step at a time.</em></h1>
        <p class="lede">Ask about any idea in math, or drop in a paper you're reading. You get a short lesson that moves at your pace, with a picture that changes at every step.</p>
      </header>
      <form class="ask-form">
        <div class="attachment" hidden></div>
        <textarea name="question" rows="3" placeholder="e.g. Why do eigenvectors of a symmetric matrix end up perpendicular?" aria-label="Your question"></textarea>
        <div class="ask-actions">
          <label class="btn small ghost attach-button" title="Attach a paper or notes (PDF, TXT, Markdown, LaTeX)">
            ${icon('paperclip')}<span>Attach a paper</span>
            <input type="file" accept="${ACCEPTED}" hidden />
          </label>
          <span class="ask-hint">Say how deep you want to go, like "I'm in my second year of college". <span class="ask-allowance"></span></span>
          <button class="btn primary" type="submit">Teach me</button>
        </div>
      </form>
      <div class="suggestion" hidden></div>
      <div class="examples"></div>
      <section class="recent" hidden>
        <div class="recent-head"><h2>From your notebook</h2><a href="#/notebook">See all</a></div>
        <div class="recent-list"></div>
      </section>
      <div class="ask-result"></div>
    </div>
  `;

  const form = view.querySelector('.ask-form');
  const textarea = form.question;
  const submitButton = form.querySelector('button[type="submit"]');
  const fileInput = form.querySelector('input[type="file"]');
  const attachment = form.querySelector('.attachment');
  const suggestion = view.querySelector('.suggestion');
  const result = view.querySelector('.ask-result');
  const allowance = view.querySelector('.ask-allowance');
  let controller = null;
  let thinkingTimer = null;
  let stopLesson = null;
  let documentFile = null; // { name, text, pages, truncated }
  let skipSimilarFor = null; // the question the reader chose to ask again anyway

  const showAllowance = () => (allowance.textContent = allowanceText());
  const stopWatchingAccount = onAccountChange(showAllowance);
  showAllowance();

  // Example chips fill the box and submit
  const examples = view.querySelector('.examples');
  for (const example of EXAMPLES) {
    const chip = el('button', 'chip', example);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      textarea.value = example;
      ask();
    });
    examples.append(chip);
  }

  // The last few saved lessons
  listLessons()
    .then((lessons) => {
      if (!lessons.length) return;
      const section = view.querySelector('.recent');
      const list = section.querySelector('.recent-list');
      for (const lesson of lessons.slice(0, 4)) list.append(lessonCard(lesson));
      section.hidden = false;
    })
    .catch(() => {});

  // ---- Attaching a paper ---------------------------------------------------------------
  async function attach(file) {
    attachment.hidden = false;
    attachment.replaceChildren(el('span', 'attachment-status', `Reading ${file.name}…`));
    try {
      documentFile = await readDocument(file);
      const words = Math.max(100, Math.round(documentFile.text.split(/\s+/).length / 100) * 100);
      const details = [documentFile.pages ? `${documentFile.pages} ${documentFile.pages === 1 ? 'page' : 'pages'}` : null, `about ${words.toLocaleString()} words`, documentFile.truncated ? 'long, so the tutor reads the first part' : null].filter(Boolean).join(' · ');
      const chip = el('div', 'attachment-chip');
      chip.innerHTML = icon('book');
      const text = el('span');
      text.append(el('strong', '', documentFile.name), el('small', '', details));
      const remove = el('button', 'attachment-remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${documentFile.name}`);
      remove.innerHTML = icon('close', 14);
      remove.addEventListener('click', detach);
      chip.append(text, remove);
      attachment.replaceChildren(chip);
      textarea.placeholder = 'What should the lesson focus on? (Optional. Leave it empty for the main idea.)';
      submitButton.textContent = 'Teach me this paper';
    } catch (err) {
      documentFile = null;
      attachment.replaceChildren(el('span', 'attachment-error', err.message));
    }
  }
  function detach() {
    documentFile = null;
    fileInput.value = '';
    attachment.hidden = true;
    attachment.replaceChildren();
    textarea.placeholder = 'e.g. Why do eigenvectors of a symmetric matrix end up perpendicular?';
    submitButton.textContent = 'Teach me';
  }
  fileInput.addEventListener('change', () => fileInput.files[0] && attach(fileInput.files[0]));
  form.addEventListener('dragover', (event) => {
    event.preventDefault();
    form.classList.add('dragging');
  });
  form.addEventListener('dragleave', () => form.classList.remove('dragging'));
  form.addEventListener('drop', (event) => {
    event.preventDefault();
    form.classList.remove('dragging');
    const file = event.dataTransfer?.files?.[0];
    if (file) attach(file);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ask();
  });
  // Ctrl/Cmd + Enter submits from the textarea
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) ask();
  });

  // ---- Asking ---------------------------------------------------------------------------
  function showThinking(messages) {
    let i = 0;
    const box = el('div', 'thinking');
    const line = el('div', 'thinking-line');
    const label = el('p', 'thinking-label', `${messages[0]}…`);
    const note = el('p', 'thinking-note', documentFile ? 'Papers take a little longer, usually a couple of minutes.' : 'This usually takes about a minute, sometimes two.');
    box.append(line, label, note);
    result.replaceChildren(box);
    clearInterval(thinkingTimer);
    thinkingTimer = setInterval(() => {
      i = Math.min(i + 1, messages.length - 1);
      label.textContent = `${messages[i]}…`;
    }, 6000);
  }

  /** Before spending an answer, offer a saved lesson on nearly the same question. */
  async function offerSavedLesson(q) {
    if (documentFile || !q || skipSimilarFor === q) return false;
    const [match] = await similarLessons(q);
    if (!match) return false;
    suggestion.hidden = false;
    suggestion.replaceChildren();
    const text = el('div');
    text.append(el('strong', '', 'You already have a lesson on this.'), el('span', '', ` "${match.title}", saved ${friendlyDate(match.createdAt)}. Opening it is free.`));
    const open = el('a', 'btn small primary', 'Open my saved lesson');
    open.href = `#/notebook/${match.id}`;
    const again = el('button', 'btn small', 'Ask anyway');
    again.type = 'button';
    again.addEventListener('click', () => {
      skipSimilarFor = q;
      suggestion.hidden = true;
      ask();
    });
    const buttons = el('div', 'button-row');
    buttons.append(open, again);
    suggestion.append(text, buttons);
    return true;
  }

  async function ask() {
    const q = textarea.value.trim();
    if (!q && !documentFile) return textarea.focus();
    suggestion.hidden = true;
    if (await offerSavedLesson(q)) return;

    controller?.abort();
    controller = new AbortController();
    submitButton.disabled = true;
    stopLesson?.();
    stopLesson = null;
    showThinking(documentFile ? THINKING_PAPER : THINKING);

    try {
      const answer = await askAI(q, topics, controller.signal, documentFile);
      applyBilling(answer.billing);
      clearInterval(thinkingTimer);
      const free = answer.billing?.paidWith === 'saved';
      const note = el('p', 'lesson-note');
      note.innerHTML = icon('book', 14);
      note.append(free ? 'You asked this before, so here is your saved lesson. No answer was used.' : 'Saved to your notebook. Asking this again is free.');
      stopLesson = await showLesson(result, answer, {
        kicker: documentFile ? `From ${documentFile.name}` : undefined,
        note,
      });
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      clearInterval(thinkingTimer);
      if (err.name === 'AbortError') return;
      result.replaceChildren(el('div', 'error-box', err.message));
      submitButton.disabled = false;
      // Out of free tries or credit: ask to sign up / top up, then retry the same question
      if (err.code === 'login_required' || err.code === 'payment_required') refreshAccount();
      if (err.code === 'login_required' && (await openAuthDialog({ mode: 'signup', reason: err.message }))) return await ask();
      if (err.code === 'payment_required' && (await openCreditsDialog({ reason: err.message }))) return await ask();
    } finally {
      submitButton.disabled = false;
    }
  }

  textarea.value = question;
  if (question && autoSubmit) ask();
  else textarea.focus();

  return () => {
    controller?.abort();
    clearInterval(thinkingTimer);
    stopLesson?.();
    stopWatchingAccount();
  };
}

/** A small card linking to a saved lesson. */
export function lessonCard(lesson) {
  const card = el('a', 'lesson-card');
  card.href = `#/notebook/${lesson.id}`;
  card.append(
    el('span', 'lesson-card-meta', `${lesson.sourceName ? 'Paper · ' : ''}${lesson.steps} steps · ${friendlyDate(lesson.createdAt)}`),
    el('strong', '', lesson.title),
    el('span', 'lesson-card-question', lesson.sourceName ?? lesson.question),
  );
  return card;
}
