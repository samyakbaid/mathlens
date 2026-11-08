// Account UI: the top-bar account button, the log in / sign up dialog and the "add credits" dialog.

import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getTheme } from '../lib/theme.js';
import {
  getAccount, onAccountChange, refreshAccount, signup, login, loginWithGoogle, logout,
  createTopupOrder, verifyTopup, rupees, answersFor,
} from '../lib/account.js';

const PRESET_AMOUNTS = [10, 20, 50, 100];

// ---- Top bar ---------------------------------------------------------------------------

/** Renders "Log in / Sign up", or the balance button with a small menu, into `container`. */
export function mountAccountBar(container) {
  let openMenu = null;
  document.addEventListener('click', (event) => {
    if (openMenu && !openMenu.contains(event.target)) openMenu.hidden = true;
  });

  const render = () => {
    openMenu = null;
    const { user, loaded } = getAccount();
    container.replaceChildren();
    if (!loaded) return;

    if (!user) {
      const loginButton = el('button', 'btn small ghost', 'Log in');
      const signupButton = el('button', 'btn small primary', 'Sign up');
      loginButton.type = signupButton.type = 'button';
      loginButton.addEventListener('click', () => openAuthDialog({ mode: 'login' }));
      signupButton.addEventListener('click', () => openAuthDialog({ mode: 'signup' }));
      container.append(loginButton, signupButton);
      return;
    }

    const chip = el('button', 'account-chip');
    chip.type = 'button';
    chip.setAttribute('aria-haspopup', 'menu');
    const credit = user.freeAnswersLeft > 0 ? `${user.freeAnswersLeft} free` : rupees(user.balancePaise);
    chip.append(el('span', 'account-avatar', (user.name || user.email)[0].toUpperCase()), el('span', 'account-credit', credit));

    const menu = el('div', 'account-menu');
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    const header = el('div', 'account-menu-head');
    header.append(el('strong', '', user.name || user.email), el('span', 'muted', user.email));
    const stats = el('div', 'account-menu-stats');
    stats.append(stat('Free answers', String(user.freeAnswersLeft)), stat('Balance', rupees(user.balancePaise)));
    const topup = el('button', 'btn small primary', 'Add credits');
    const out = el('button', 'btn small ghost', 'Log out');
    topup.type = out.type = 'button';
    topup.addEventListener('click', () => {
      menu.hidden = true;
      openCreditsDialog();
    });
    out.addEventListener('click', async () => {
      menu.hidden = true;
      await logout();
    });
    const actions = el('div', 'button-row');
    actions.append(topup, out);
    const links = el('div', 'account-menu-links');
    const receipts = el('a', '', 'Receipts');
    receipts.href = '/receipts';
    const pricingLink = el('a', '', 'Pricing');
    pricingLink.href = '/pricing';
    links.append(receipts, pricingLink);
    menu.append(header, stats, actions, links);

    chip.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    openMenu = menu;
    container.append(chip, menu);
  };

  onAccountChange(render);
  render();
  refreshAccount();
}

function stat(label, value) {
  const box = el('div', 'account-stat');
  box.append(el('span', 'muted', label), el('strong', '', value));
  return box;
}

// ---- Dialog helper ---------------------------------------------------------------------

function createDialog(className) {
  const dialog = el('dialog', `modal ${className}`);
  const close = el('button', 'modal-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close(); // click on the backdrop
  });
  dialog.append(close);
  document.body.append(dialog);
  dialog.addEventListener('close', () => setTimeout(() => dialog.remove(), 0));
  return dialog;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded) return resolve();
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => {
      script.dataset.loaded = '1';
      resolve();
    });
    script.addEventListener('error', () => reject(new Error('Could not load ' + new URL(src).host)));
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.append(script);
    }
  });
}

// ---- Log in / sign up --------------------------------------------------------------------

/**
 * Opens the log in / sign up dialog.
 * @param {{mode?: 'login'|'signup', reason?: string}} options - reason explains why we're asking
 * @returns {Promise<boolean>} true once the person is logged in
 */
export function openAuthDialog({ mode = 'signup', reason = '' } = {}) {
  return new Promise((resolve) => {
    const { integrations, pricing } = getAccount();
    const dialog = createDialog('auth-modal');
    let currentMode = mode;
    let succeeded = false;

    const title = el('h2', 'modal-title');
    const subtitle = el('p', 'modal-subtitle');
    const google = el('div', 'google-button');
    const divider = el('div', 'modal-divider', 'or');
    const form = el('form', 'modal-form');
    const nameField = field('Name', 'text', 'name', 'Your name (optional)');
    const emailField = field('Email', 'email', 'email', 'you@example.com');
    const passwordField = field('Password', 'password', 'current-password', 'At least 8 characters');
    const error = el('div', 'modal-error');
    const submit = el('button', 'btn primary modal-submit');
    submit.type = 'submit';
    const switcher = el('p', 'modal-switch');
    form.append(nameField.row, emailField.row, passwordField.row, error, submit);
    dialog.append(title, subtitle, google, divider, form, switcher);

    const render = () => {
      const isSignup = currentMode === 'signup';
      title.textContent = isSignup ? 'Make a free account' : 'Welcome back';
      const perk = pricing?.freeAnswersAfterSignup ? `Sign up and your next ${pricing.freeAnswersAfterSignup} lessons are free. Your saved lessons come with you.` : '';
      subtitle.textContent = reason || (isSignup ? perk : 'Log in to keep asking the tutor and see your saved lessons.');
      nameField.row.hidden = !isSignup;
      passwordField.input.autocomplete = isSignup ? 'new-password' : 'current-password';
      submit.textContent = isSignup ? 'Sign up' : 'Log in';
      switcher.replaceChildren(isSignup ? 'Already have an account? ' : 'New to MathLens? ');
      const link = el('button', 'link-button', isSignup ? 'Log in' : 'Sign up free');
      link.type = 'button';
      link.addEventListener('click', () => {
        currentMode = isSignup ? 'login' : 'signup';
        error.textContent = '';
        render();
      });
      switcher.append(link);
    };

    const finish = () => {
      succeeded = true;
      dialog.close();
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        const details = { name: nameField.input.value.trim(), email: emailField.input.value.trim(), password: passwordField.input.value };
        if (currentMode === 'signup') await signup(details);
        else await login(details);
        finish();
      } catch (err) {
        error.textContent = err.message;
      } finally {
        submit.disabled = false;
      }
    });

    // Google sign-in button (only if the server has a Google client id)
    if (integrations?.googleClientId) {
      loadScript('https://accounts.google.com/gsi/client')
        .then(() => {
          window.google.accounts.id.initialize({
            client_id: integrations.googleClientId,
            callback: async ({ credential }) => {
              error.textContent = '';
              try {
                await loginWithGoogle(credential);
                finish();
              } catch (err) {
                error.textContent = err.message;
              }
            },
          });
          window.google.accounts.id.renderButton(google, {
            theme: getTheme() === 'dark' ? 'filled_black' : 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            width: 320,
          });
        })
        .catch(() => {
          google.textContent = 'Google sign-in could not load. Use email instead.';
        });
    } else {
      google.hidden = true;
      divider.hidden = true;
    }

    dialog.addEventListener('close', () => resolve(succeeded));
    render();
    dialog.showModal();
    (currentMode === 'signup' ? nameField : emailField).input.focus();
  });
}

function field(label, type, autocomplete, placeholder) {
  const row = el('label', 'modal-field');
  const input = el('input');
  Object.assign(input, { type, autocomplete, placeholder, required: type !== 'text' });
  if (type === 'password') input.minLength = 8;
  row.append(el('span', '', label), input);
  return { row, input };
}

// ---- Add credits ---------------------------------------------------------------------------

/**
 * Opens the "add credits" dialog: choose any amount, see how many explanations it buys, pay with Razorpay.
 * @returns {Promise<boolean>} true if credits were added
 */
export async function openCreditsDialog({ reason = '' } = {}) {
  if (!getAccount().user) {
    const loggedIn = await openAuthDialog({ mode: 'login', reason: 'Log in to add credits.' });
    if (!loggedIn) return false;
    if (getAccount().user.freeAnswersLeft > 0) return true; // a new account starts with free answers
  }

  return new Promise((resolve) => {
    const { user, pricing, integrations } = getAccount();
    const average = pricing?.averageAnswerPaise ?? 50;
    const min = pricing?.minTopupRupees ?? 10;
    const max = pricing?.maxTopupRupees ?? 5000;
    let amount = 20;
    let paid = false;
    let handedToRazorpay = false; // once Razorpay's window is open, it decides when we're done

    const dialog = createDialog('credits-modal');
    const title = el('h2', 'modal-title', 'Add credits');
    const subtitle = el('p', 'modal-subtitle', reason || `Your balance is ${rupees(user.balancePaise)}. You only pay for the lessons you ask for.`);

    // Why it's worth it, in real numbers
    const reasons = el('ul', 'worth-it');
    for (const text of [
      `₹20 covers about ${answersFor(2000)} lessons, roughly the price of a cup of chai.`,
      'Every lesson is saved in your notebook, and reopening it costs nothing.',
      "There's no subscription. You pay once and your credit never runs out.",
    ]) {
      const item = el('li');
      item.innerHTML = icon('check', 15);
      item.append(text);
      reasons.append(item);
    }
    const cost = el('p', 'cost-explainer');
    cost.append(
      `A lesson costs about ${rupees(average)} on average: what the AI charges us${pricing?.markup ? `, plus ${Math.round(pricing.markup * 100)}% for the payment fee` : ''}. `,
    );
    const pricingLink = el('a', '', 'How pricing works');
    pricingLink.href = '/pricing';
    pricingLink.target = '_blank';
    cost.append(pricingLink);

    const grid = el('div', 'amount-grid');
    const buttons = PRESET_AMOUNTS.map((value) => {
      const button = el('button', 'amount-option');
      button.type = 'button';
      button.append(el('strong', '', `₹${value}`), el('span', '', `about ${answersFor(value * 100)} lessons`));
      button.addEventListener('click', () => {
        amount = value;
        custom.value = '';
        update();
      });
      grid.append(button);
      return { value, button };
    });

    const customRow = el('label', 'modal-field');
    const custom = el('input');
    Object.assign(custom, { type: 'number', min, max, step: 1, inputMode: 'numeric', placeholder: `Any amount from ₹${min}` });
    customRow.append(el('span', '', 'Or choose your own amount (₹)'), custom);
    custom.addEventListener('input', () => {
      amount = Number(custom.value);
      update();
    });

    const summary = el('p', 'modal-summary');
    const error = el('div', 'modal-error');
    const pay = el('button', 'btn primary modal-submit');
    pay.type = 'button';
    dialog.append(title, subtitle, reasons, grid, customRow, summary, error, pay, cost);

    function update() {
      buttons.forEach(({ value, button }) => button.classList.toggle('selected', value === amount && !custom.value));
      const valid = Number.isFinite(amount) && amount >= min && amount <= max;
      pay.disabled = !valid || !integrations?.payments;
      pay.textContent = valid ? `Pay ₹${Math.round(amount)} with UPI, card or netbanking` : `Choose ₹${min} to ₹${max}`;
      summary.textContent = valid ? `₹${Math.round(amount)} is about ${answersFor(Math.round(amount) * 100)} lessons at today's average.` : '';
      if (!integrations?.payments) error.textContent = 'Payments are not set up on this server yet (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).';
    }

    pay.addEventListener('click', async () => {
      error.textContent = '';
      pay.disabled = true;
      try {
        const [order] = await Promise.all([createTopupOrder(Math.round(amount)), loadScript('https://checkout.razorpay.com/v1/checkout.js')]);
        handedToRazorpay = true;
        dialog.close(); // Razorpay opens its own window; our dialog would sit on top of it
        const checkout = new window.Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amountPaise,
          currency: 'INR',
          name: 'MathLens',
          description: `₹${order.amountPaise / 100} of AI explanation credits`,
          prefill: { email: order.email, name: order.name },
          theme: { color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2d70f6' },
          handler: async (response) => {
            try {
              await verifyTopup(response);
              paid = true;
              toast(`Added ₹${order.amountPaise / 100} of credit. Thank you!`);
            } catch (err) {
              toast(err.message, true);
            }
            resolve(paid);
          },
          modal: { ondismiss: () => resolve(paid) },
        });
        checkout.on('payment.failed', (response) => toast(response.error?.description || 'Payment failed. No money was taken.', true));
        checkout.open();
      } catch (err) {
        if (handedToRazorpay) {
          toast(err.message, true);
          resolve(false);
        } else {
          error.textContent = err.message;
          pay.disabled = false;
        }
      }
    });

    dialog.addEventListener('close', () => {
      if (!handedToRazorpay) resolve(paid);
    });
    update();
    dialog.showModal();
  });
}

// ---- Toast -----------------------------------------------------------------------------------

export function toast(message, isError = false) {
  const note = el('div', isError ? 'toast error' : 'toast', message);
  document.body.append(note);
  requestAnimationFrame(() => note.classList.add('visible'));
  setTimeout(() => {
    note.classList.remove('visible');
    setTimeout(() => note.remove(), 300);
  }, 3500);
}
