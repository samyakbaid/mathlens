// App entry point: shows the right page for the URL.
//
// Pages (the part after # in the URL):
//   #/                    Explore: the learning-path map
//   #/topic/<id>          a built-in lesson, e.g. #/topic/eigenvectors
//   #/graph               Graph Lab, a Desmos-style graphing calculator (?e=... holds the expressions)
//   #/ask?q=<question>    Ask: the AI tutor (add &go=1 to submit immediately)
//   #/notebook[/<id>]     Notebook: saved lessons
//   #/reset?token=<...>   the link in a password reset email
//
// Press / or Ctrl/Cmd+K anywhere to search topics or ask a question.

import { findTopic } from './topics.js';
import { toggleTheme } from './lib/theme.js';
import { showHome } from './views/home-view.js';
import { showTopic } from './views/topic-view.js';
import { showAskPage } from './views/ask-view.js';
import { showGraphPage } from './views/graph-view.js';
import { showNotebook } from './views/notebook-view.js';
import { mountAccountBar, openResetDialog } from './views/account-ui.js';
import { openPalette } from './views/palette.js';

const view = document.getElementById('view');
const navLinks = [...document.querySelectorAll('#topnav a')];
let cleanupCurrentPage = null;

function route() {
  // Stop whatever the previous page was doing (animations, pending requests)
  cleanupCurrentPage?.();
  cleanupCurrentPage = null;

  // A password reset link: take the token out of the address bar and history right away
  if (location.hash.startsWith('#/reset')) {
    const token = new URLSearchParams(location.hash.split('?')[1]).get('token');
    history.replaceState(null, '', `${location.pathname}#/`);
    if (token) openResetDialog(token);
  }

  const [path, queryString] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(queryString);
  const [section, id] = path.split('/').filter(Boolean);
  const isGraph = section === 'graph';

  view.className = `view${isGraph ? ' full' : ''}`;
  document.body.dataset.page = section || 'home';

  if (section === 'topic' && findTopic(id)) {
    cleanupCurrentPage = showTopic(view, findTopic(id));
  } else if (section === 'ask') {
    cleanupCurrentPage = showAskPage(view, { question: params.get('q') ?? '', autoSubmit: params.get('go') === '1' });
  } else if (isGraph) {
    cleanupCurrentPage = showGraphPage(view, { encoded: params.get('e'), mode: params.get('m') });
  } else if (section === 'notebook') {
    cleanupCurrentPage = showNotebook(view, { id });
  } else {
    cleanupCurrentPage = showHome(view);
  }

  const navPath = section === 'topic' || !section ? '/' : `/${section}`;
  navLinks.forEach((link) => link.classList.toggle('active', link.dataset.path === navPath));
  window.scrollTo(0, 0);
}

document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
document.getElementById('search-trigger').addEventListener('click', () => openPalette());
document.addEventListener('keydown', (event) => {
  const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
  const shortcut = (event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey);
  if (shortcut && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    openPalette();
  }
});
mountAccountBar(document.getElementById('account-bar'));

window.addEventListener('hashchange', route);
route();
