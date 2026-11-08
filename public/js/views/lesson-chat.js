// The chat inside a lesson: ask about a step, or ask for the picture to work differently.
// It opens in place of the step text, so the picture stays in view while you talk about it.
// The same chat runs in AI lessons and built-in lessons (see lesson-player.js and topic-view.js).

import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { renderMarkdown } from '../lib/markdown.js';
import { askFollowUp, listFollowUps } from '../lib/api.js';
import { allowanceText, applyBilling, getAccount, onAccountChange, refreshAccount } from '../lib/account.js';
import { openAuthDialog, openCreditsDialog } from './account-ui.js';
import { bringIntoView } from './topic-view.js';

const SUGGESTIONS = ['Explain this step more simply', 'Show this step with another example', 'Make the picture simpler', 'Use different numbers in the picture'];
const LONG_WAIT_MS = 9000;

/**
 * @param {object} options
 * @param {object} options.rail - from addSteps()
 * @param {HTMLElement} options.card - the lesson card
 * @param {object} options.target - { lessonId } or { topicId, title, steps: [{ title, text }] }
 * @param {{ show: (html: string) => any, reset: () => any }} options.picture - changes what's on screen
 * @returns {() => void} cleanup
 */
export function addLessonChat({ rail, card, target, picture }) {
  const source = target.lessonId ? { lessonId: target.lessonId } : { topicId: target.topicId };
  let pictureId = 0; // 0 is the lesson's original picture
  let busy = false;
  let open = false;
  let cardHeightBefore = '';
  let items = [];

  const askButton = el('button', 'btn rail-ask');
  askButton.type = 'button';
  askButton.innerHTML = icon('ask', 15);
  askButton.append(el('span', '', 'Ask a question'));
  rail.addAction(askButton);

  const panel = el('div', 'chat');
  const head = el('div', 'chat-head');
  const stepLabel = el('strong', 'chat-step');
  const originalButton = el('button', 'link-button', 'Show the original picture');
  originalButton.type = 'button';
  originalButton.hidden = true;
  const closeButton = el('button', 'link-button', 'Back to the step');
  closeButton.type = 'button';
  head.append(stepLabel, originalButton, closeButton);

  const thread = el('div', 'chat-thread');
  thread.tabIndex = 0;
  const empty = el('div', 'chat-empty');
  empty.append(el('p', '', "Ask anything about this lesson, or tell me how you'd like the picture to work."));
  const chips = el('div', 'chat-chips');
  for (const text of SUGGESTIONS) {
    const chip = el('button', 'chip', text);
    chip.type = 'button';
    // Fills the box instead of sending, so a stray tap never spends a chat
    chip.addEventListener('click', () => {
      input.value = text;
      input.focus();
      fitInput();
    });
    chips.append(chip);
  }
  empty.append(chips);
  thread.append(empty);

  const form = el('form', 'chat-form');
  const input = el('textarea', 'chat-input');
  input.rows = 1;
  input.maxLength = 1000;
  input.placeholder = 'Ask about this step, or ask to change the picture';
  input.setAttribute('aria-label', 'Your question about this lesson');
  const send = el('button', 'btn primary small', 'Send');
  send.type = 'submit';
  form.append(input, send);
  const hint = el('p', 'chat-hint');
  panel.append(head, thread, form, hint);

  const questionsText = () => {
    const free = getAccount().freeQuestions;
    if (!free) return '';
    const more = `${free.covered} more question${free.covered === 1 ? '' : 's'}`;
    if (free.left > 0 && free.covered > 0) return `${free.left} of ${free.limit} free questions left today, then your last chat covers ${more}.`;
    if (free.left > 0) return `${free.left} of ${free.limit} free questions left today. After that, ${free.perChat} questions use 1 chat.`;
    if (free.covered > 0) return `Your last chat covers ${more}.`;
    return `No free questions left today. Your next question uses 1 chat, and that covers ${free.perChat} questions.`;
  };
  const updateHint = () => {
    hint.textContent = [questionsText(), 'Changing the picture uses 1 chat.', allowanceText()].filter(Boolean).join(' ');
  };
  const stopWatchingAccount = onAccountChange(updateHint);
  updateHint();

  const updateStep = () => {
    stepLabel.textContent = `You're on step ${rail.index + 1} of ${rail.steps.length}`;
  };
  const onStep = () => updateStep();
  card.addEventListener('lessonstep', onStep);
  updateStep();

  function fitInput() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(110, input.scrollHeight + 2)}px`;
  }
  input.addEventListener('input', fitInput);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  function setOpen(next) {
    open = next;
    rail.showPanel(next ? panel : null);
    askButton.classList.toggle('active', next);
    // A little more room for the conversation, with the picture still in view
    if (next) {
      cardHeightBefore = card.style.getPropertyValue('--rail-card-height');
      if (!cardHeightBefore) card.style.setProperty('--rail-card-height', 'clamp(262px, 37vh, 420px)');
      updateHint();
      thread.scrollTop = thread.scrollHeight;
      if (window.matchMedia('(hover: hover)').matches) input.focus({ preventScroll: true });
      bringIntoView(card);
    } else if (!cardHeightBefore) {
      card.style.removeProperty('--rail-card-height');
    }
  }
  askButton.addEventListener('click', () => setOpen(!open));
  closeButton.addEventListener('click', () => setOpen(false));

  // ---- The picture ----------------------------------------------------------------------------
  function markPictures() {
    originalButton.hidden = pictureId === 0;
    for (const button of thread.querySelectorAll('[data-picture]')) {
      const showing = Number(button.dataset.picture) === pictureId;
      button.textContent = showing ? 'Showing this version' : 'Show this version';
      button.disabled = showing;
    }
  }
  async function showPicture(id) {
    const item = items.find((entry) => entry.id === id);
    if (item?.visualizationHtml) await picture.show(item.visualizationHtml);
    else await picture.reset();
    pictureId = item?.visualizationHtml ? id : 0;
    markPictures();
    bringIntoView(card);
  }
  originalButton.addEventListener('click', () => showPicture(0));

  // ---- Messages -------------------------------------------------------------------------------
  /** Scroll inside the chat only, so the picture above stays where it is. */
  function scrollThreadTo(element) {
    const top = element.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop;
    thread.scrollTo({ top: Math.max(0, top - 4), behavior: 'smooth' });
  }
  function addQuestion(text, stepIndex) {
    empty.hidden = true;
    const bubble = el('div', 'chat-question');
    bubble.append(el('span', 'chat-question-step', `Step ${stepIndex + 1}`), el('span', '', text));
    thread.append(bubble);
    return bubble;
  }
  function addReply(item, { free = false } = {}) {
    const reply = el('div', 'chat-reply');
    const words = el('div', 'chat-words');
    words.innerHTML = renderMarkdown(item.reply);
    reply.append(words);
    if (item.visualizationHtml) {
      const row = el('div', 'chat-picture-row');
      row.innerHTML = icon('eye', 14);
      row.append(el('span', '', 'The picture changed for this.'));
      const button = el('button', 'link-button');
      button.type = 'button';
      button.dataset.picture = String(item.id);
      button.addEventListener('click', () => showPicture(item.id));
      row.append(button);
      reply.append(row);
    }
    if (free) reply.append(el('p', 'chat-note', 'You asked this already, so no chat was used.'));
    thread.append(reply);
    return reply;
  }
  function showPending() {
    const box = el('div', 'chat-thinking');
    const dots = el('span', 'chat-dots');
    dots.append(el('i'), el('i'), el('i'));
    const label = el('span', '', 'Thinking');
    box.append(dots, label);
    thread.append(box);
    const timer = setTimeout(() => {
      label.textContent = 'Still working. Changing a picture can take a minute or two.';
    }, LONG_WAIT_MS);
    return () => {
      clearTimeout(timer);
      box.remove();
    };
  }

  async function ask(text, { retry = false, bubble = null } = {}) {
    if (busy) return;
    busy = true;
    send.disabled = true;
    const stepIndex = rail.index;
    const question = bubble ?? addQuestion(text, stepIndex);
    const stopPending = showPending();
    scrollThreadTo(question);
    let failure = null;
    try {
      const item = await askFollowUp({
        ...source,
        question: text,
        stepIndex,
        basePictureId: pictureId || undefined,
        ...(target.topicId ? { title: target.title, steps: target.steps } : {}),
      });
      applyBilling(item.billing);
      stopPending();
      items.push(item);
      const free = item.billing?.paidWith === 'saved';
      const reply = addReply(item, { free });
      if (item.visualizationHtml) await showPicture(item.id);
      else markPictures();
      scrollThreadTo(question); // the question at the top, the start of the reply right under it
    } catch (err) {
      stopPending();
      failure = err;
    }
    busy = false;
    send.disabled = false;
    if (open && window.matchMedia('(hover: hover)').matches) input.focus({ preventScroll: true });
    if (!failure) return;

    // Out of free chats or credit: sign up or top up, then send the same question
    if (failure.code === 'login_required' || failure.code === 'payment_required') refreshAccount();
    if (!retry && failure.code === 'login_required' && (await openAuthDialog({ mode: 'signup', reason: failure.message }))) return ask(text, { retry: true, bubble: question });
    if (!retry && failure.code === 'payment_required' && (await openCreditsDialog({ reason: failure.message }))) return ask(text, { retry: true, bubble: question });
    thread.append(el('div', 'error-box chat-error', failure.message));
    question.remove();
    input.value = text; // nothing lost: it can be sent again
    fitInput();
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    fitInput();
    thread.querySelector('.chat-error')?.remove();
    ask(text);
  });

  // ---- Earlier chats ---------------------------------------------------------------------------
  let stopped = false;
  listFollowUps(source)
    .then(async (saved) => {
      if (stopped || !saved.length) return;
      items = saved;
      for (const item of saved) {
        addQuestion(item.question, item.stepIndex);
        addReply(item);
      }
      askButton.querySelector('span').textContent = `Your questions (${saved.length})`;
      // Open the lesson the way the reader left it, with their latest picture
      const latest = [...saved].reverse().find((item) => item.visualizationHtml);
      if (latest) await showPicture(latest.id);
      else markPictures();
    })
    .catch(() => {
      // The chat still works if the history can't load
    });

  return () => {
    stopped = true;
    stopWatchingAccount();
    card.removeEventListener('lessonstep', onStep);
  };
}
