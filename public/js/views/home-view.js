// Explore: the home page. A moving hero, an "ask anything" box, the learning paths drawn as
// lines of stations (with what you've already visited), and the two tools.

import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { startHeroArt } from '../lib/hero-art.js';
import { paths, findTopic, visitedTopics } from '../topics.js';
import { getAccount, onAccountChange, rupees } from '../lib/account.js';

const EXAMPLES = [
  'Why does the gradient point uphill?',
  'What is a Lagrange multiplier?',
  'How does gradient descent find a minimum?',
  'What does the determinant measure?',
];

/** @returns {() => void} cleanup */
export function showHome(view) {
  view.innerHTML = `
    <div class="page home">
      <section class="hero">
        <canvas class="hero-art" aria-hidden="true"></canvas>
        <div class="hero-copy">
          <p class="kicker">An interactive notebook for mathematics</p>
          <h1>See the math <em>move.</em></h1>
          <p class="lede">Each idea comes in small steps, and the picture changes with every one. Play with it until it makes sense. Stuck on something we don't cover? Ask the tutor and it builds a lesson just for you.</p>
          <form class="hero-ask" role="search">
            <input name="question" placeholder="What do you want to understand?" autocomplete="off" aria-label="Your question" />
            <button class="btn primary" type="submit">Teach me</button>
          </form>
          <div class="hero-examples"><span>Try</span></div>
        </div>
      </section>
      <div class="continue-slot"></div>
      <a class="price-strip" href="/pricing">
        <span><strong>Free to start.</strong> The lessons and Graph Lab are always free. Sign up and the tutor gives you <b data-fill="free">5</b> free chats. Inside a lesson, <b data-fill="questions">4</b> follow-up questions a day are free, and after that <b data-fill="per-chat">4</b> questions use 1 chat.</span>
        <span class="price-strip-cta">After that, about <b data-fill="average">₹0.20</b> a chat ${icon('right', 14)}</span>
      </a>
      <section class="paths-section">
        <header class="section-head">
          <h2>Learning paths</h2>
          <p>Short routes through the big ideas. Each station builds on the one before it, so start on the left.</p>
        </header>
        <div class="paths"></div>
      </section>
      <section class="tools">
        <a class="tool-card" href="#/graph">
          ${graphIllustration()}
          <div><h3>Graph Lab</h3><p>Type an equation and see it drawn, flat or in 3D. Any letter you haven't defined becomes a slider you can drag.</p><span class="tool-link">Open Graph Lab ${icon('right', 14)}</span></div>
        </a>
        <a class="tool-card" href="#/ask">
          ${askIllustration()}
          <div><h3>Ask the tutor</h3><p>Ask about any idea, or drop in a paper you're reading. You get a slow, step-by-step lesson with a picture that moves as you go, and you can ask follow-up questions or have the picture changed.</p><span class="tool-link">Ask a question ${icon('right', 14)}</span></div>
        </a>
        <a class="tool-card" href="#/notebook">
          ${notebookIllustration()}
          <div><h3>Your notebook</h3><p>Every lesson the tutor makes for you is kept here, with your follow-up questions, so you can come back later without using another chat.</p><span class="tool-link">Open your notebook ${icon('right', 14)}</span></div>
        </a>
      </section>
    </div>
  `;

  const stopArt = startHeroArt(view.querySelector('.hero-art'));

  // Real numbers in the pricing strip
  const fillPrices = ({ pricing, freeQuestions }) => {
    if (!pricing) return;
    const set = (key, value) => view.querySelectorAll(`[data-fill="${key}"]`).forEach((node) => (node.textContent = value));
    set('free', String(pricing.freeAnswersAfterSignup));
    set('questions', String(freeQuestions?.limit ?? 4));
    set('per-chat', String(freeQuestions?.perChat ?? 4));
    set('average', rupees(pricing.averageAnswerPaise));
  };
  fillPrices(getAccount());
  const stopWatchingAccount = onAccountChange(fillPrices);

  // Ask box and example questions
  const form = view.querySelector('.hero-ask');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = form.question.value.trim();
    location.hash = question ? `#/ask?q=${encodeURIComponent(question)}&go=1` : '#/ask';
  });
  const examples = view.querySelector('.hero-examples');
  for (const example of EXAMPLES) {
    const chip = el('a', 'chip', example);
    chip.href = `#/ask?q=${encodeURIComponent(example)}&go=1`;
    examples.append(chip);
  }

  // Progress
  const visited = new Set(visitedTopics());
  const last = findTopic(visitedTopics()[0]);
  if (last) {
    const banner = el('a', 'continue');
    banner.href = `#/topic/${last.id}`;
    banner.append(el('span', 'continue-label', 'Pick up where you left off'), el('strong', '', last.title));
    banner.insertAdjacentHTML('beforeend', icon('right'));
    view.querySelector('.continue-slot').append(banner);
  }

  // The paths, as lines of stations
  const list = view.querySelector('.paths');
  paths.forEach((path, p) => {
    const stations = path.topics.map(findTopic).filter(Boolean);
    const done = stations.filter((t) => visited.has(t.id)).length;
    const nextUp = stations.find((t) => !visited.has(t.id));

    const card = el('article', 'path');
    const head = el('header', 'path-head');
    const titles = el('div');
    titles.append(el('h3', '', path.title), el('p', '', path.blurb));
    head.append(el('span', 'path-no', String(p + 1).padStart(2, '0')), titles, el('span', 'path-progress', `${done} of ${stations.length} visited`));

    const track = el('ol', 'track');
    track.style.setProperty('--stations', stations.length);
    stations.forEach((topic, i) => {
      const item = el('li', 'station');
      if (visited.has(topic.id)) item.classList.add('visited');
      if (topic === nextUp) item.classList.add('next');
      const link = el('a');
      link.href = `#/topic/${topic.id}`;
      const dot = el('span', 'station-dot');
      if (visited.has(topic.id)) dot.innerHTML = icon('check', 14);
      else dot.textContent = String(i + 1);
      link.append(
        dot,
        el('span', 'station-level', topic === nextUp ? (done ? 'Up next' : 'Start here') : topic.level),
        el('strong', 'station-title', topic.title),
        el('span', 'station-summary', topic.summary),
      );
      item.append(link);
      track.append(item);
    });

    card.append(head, track);
    list.append(card);
  });

  return () => {
    stopArt();
    stopWatchingAccount();
  };
}

function graphIllustration() {
  return `<svg class="tool-art" viewBox="0 0 120 80" aria-hidden="true">
    <path d="M10 70H112M14 74V8" class="art-axis" />
    <path d="M16 58C30 10 44 10 58 40S86 70 108 18" class="art-curve" />
    <circle cx="58" cy="40" r="5" class="art-point" />
    <path d="M70 76h36" class="art-track" /><circle cx="84" cy="76" r="4" class="art-knob" />
  </svg>`;
}

function notebookIllustration() {
  return `<svg class="tool-art" viewBox="0 0 120 80" aria-hidden="true">
    <path d="M30 10h60v62H30z" class="art-page" />
    <path d="M40 24h40M40 34h40M40 44h28" class="art-lines" />
    <path d="M76 10v20l6-5 6 5V10" class="art-ribbon" />
  </svg>`;
}

function askIllustration() {
  return `<svg class="tool-art" viewBox="0 0 120 80" aria-hidden="true">
    <path d="M12 40h96" class="art-track" />
    <circle cx="22" cy="40" r="9" class="art-done" /><circle cx="60" cy="40" r="9" class="art-active" /><circle cx="98" cy="40" r="9" class="art-todo" />
    <path d="m18 40 3 3 5-6" class="art-check" />
    <text x="60" y="44.5" class="art-num">2</text><text x="98" y="44.5" class="art-num muted">3</text>
    <path d="M40 62h40M46 70h28" class="art-lines" />
  </svg>`;
}
