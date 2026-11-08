// The signed-in user, free answers, balance and prices, shared by every page.
//
//   await refreshAccount();           // load from GET /api/me
//   getAccount().user                 // null when logged out
//   onAccountChange((account) => ...) // re-render when it changes

let account = { loaded: false, user: null, trial: null, pricing: null, integrations: {} };
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener(account));
}

export function getAccount() {
  return account;
}

export function onAccountChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshAccount() {
  try {
    const response = await fetch('/api/me');
    if (response.ok) account = { ...(await response.json()), loaded: true };
  } catch {
    // offline: keep what we have
  }
  emit();
  return account;
}

/** After an AI answer, the server sends the new balance / free answers left. */
export function applyBilling(billing) {
  if (!billing) return;
  if (billing.user !== undefined) account.user = billing.user;
  if (billing.trial) account.trial = billing.trial;
  emit();
}

async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Something went wrong (${response.status})`);
    error.code = data.code;
    throw error;
  }
  return data;
}

export async function signup({ name, email, password }) {
  await post('/api/auth/signup', { name, email, password });
  return refreshAccount();
}

export async function login({ email, password }) {
  await post('/api/auth/login', { email, password });
  return refreshAccount();
}

export async function loginWithGoogle(credential) {
  await post('/api/auth/google', { credential });
  return refreshAccount();
}

export function requestPasswordReset(email) {
  return post('/api/auth/forgot', { email });
}

export async function resetPassword(token, password) {
  await post('/api/auth/reset', { token, password });
  return refreshAccount();
}

export async function logout() {
  await post('/api/auth/logout');
  return refreshAccount();
}

export function createTopupOrder(amountRupees) {
  return post('/api/payments/order', { amountRupees });
}

export async function verifyTopup(response) {
  const data = await post('/api/payments/verify', response);
  await refreshAccount();
  return data;
}

// ---- Formatting helpers ------------------------------------------------------------------

export function rupees(paise) {
  const value = paise / 100;
  return `₹${value.toFixed(value >= 100 || Number.isInteger(value) ? 0 : 2)}`;
}

/** Roughly how many explanations this many paise buys. */
export function answersFor(paise) {
  const average = account.pricing?.averageAnswerPaise || 50;
  return Math.max(0, Math.floor(paise / average));
}

/** One short line describing what the person can still do, e.g. "2 free chats left". */
export function allowanceText() {
  const { user, trial } = account;
  if (!account.loaded) return '';
  if (!user) {
    return trial?.left > 0
      ? `${trial.left} free ${trial.left === 1 ? 'chat' : 'chats'} left, no account needed`
      : 'Free chats used. Sign up (free) to keep going.';
  }
  if (user.freeAnswersLeft > 3) return `${user.freeAnswersLeft} free chats left`;
  if (user.freeAnswersLeft > 0) return `${user.freeAnswersLeft} free ${user.freeAnswersLeft === 1 ? 'chat' : 'chats'} left. After that, ₹20 covers about ${answersFor(2000)} more.`;
  if (user.balancePaise > 0) return `Balance ${rupees(user.balancePaise)}, about ${answersFor(user.balancePaise)} chats`;
  return `₹20 covers about ${answersFor(2000)} more chats`;
}
