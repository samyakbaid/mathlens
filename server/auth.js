// Accounts and sessions: email + password, and "Sign in with Google".
//
// - Passwords are hashed with scrypt (built into Node) and a random salt.
// - A session is a random token in an HttpOnly cookie; only its SHA-256 hash is stored.
// - Anonymous visitors get a random id cookie so their free trial answers can be counted.
// - Google sign-in: the browser gets an ID token from Google; we check its signature
//   against Google's public keys, its audience (our client id) and its expiry.

import crypto from 'node:crypto';
import express from 'express';
import { db, transaction } from './db.js';
import { config } from './config.js';
import { claimVisitorLessons } from './lessons.js';
import { sendPasswordResetEmail } from './email.js';

const SESSION_COOKIE = 'ml_session';
const VISITOR_COOKIE = 'ml_visitor';
const SESSION_DAYS = 30;

// ---- Cookies -----------------------------------------------------------------------

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // ignore malformed cookies
    }
  }
  return cookies;
}

function cookieOptions(req, maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure || req.secure,
    path: '/',
    maxAge: maxAgeMs,
  };
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// ---- Passwords -----------------------------------------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function checkPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// ---- Sessions --------------------------------------------------------------------------

function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).run(sha256(token), userId);
  res.cookie(SESSION_COOKIE, token, cookieOptions(req, SESSION_DAYS * 86400 * 1000));
  claimVisitorLessons(userId, req.visitorId); // lessons asked before signing in move to the account
}

/**
 * Middleware for /api: sets req.user (or null) and req.visitorId (creating the cookie if needed).
 */
export function identify(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  req.user = null;
  if (cookies[SESSION_COOKIE]) {
    req.user = db.prepare(`
      SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now')
    `).get(sha256(cookies[SESSION_COOKIE])) ?? null;
  }
  let visitorId = cookies[VISITOR_COOKIE];
  if (!visitorId || !/^[A-Za-z0-9_-]{16,64}$/.test(visitorId)) {
    visitorId = crypto.randomBytes(18).toString('base64url');
    res.cookie(VISITOR_COOKIE, visitorId, cookieOptions(req, 365 * 86400 * 1000));
  }
  db.prepare('INSERT OR IGNORE INTO visitors (id) VALUES (?)').run(visitorId);
  req.visitorId = visitorId;
  next();
}

/**
 * Reject state-changing requests that come from another website (CSRF protection on top of
 * SameSite cookies). Browsers always send Origin on cross-site POSTs.
 */
export function sameOriginOnly(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Request blocked (wrong origin).' });
    } catch {
      return res.status(403).json({ error: 'Request blocked (bad origin).' });
    }
  }
  next();
}

// ---- Simple rate limiting (per IP, in memory) -------------------------------------------

function rateLimiter({ max, windowMs, by = (req) => req.ip }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const id = by(req);
    const count = (hits.get(id) ?? 0) + 1;
    hits.set(id, count);
    if (count > max) return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
    next();
  };
}

// ---- Users ----------------------------------------------------------------------------------

/** Public view of a user: what the browser is allowed to see. */
export function publicUser(user) {
  if (!user) return null;
  return {
    email: user.email,
    name: user.name,
    balancePaise: user.balance_paise,
    freeAnswersLeft: user.free_answers_left,
    hasPassword: Boolean(user.password_hash),
    hasGoogle: Boolean(user.google_sub),
  };
}

/**
 * Free answers for a new account. Limited per IP per day, so nobody can farm free credit
 * by creating lots of throwaway accounts.
 */
function freeAnswersForNewAccount(ip) {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM users WHERE signup_ip = ? AND created_at > datetime('now', '-1 day')").get(ip);
  return count < config.freeSignupsPerIpPerDay ? config.freeAnswersAfterSignup : 0;
}

function createUser({ email, name, passwordHash = null, googleSub = null, ip }) {
  const result = db.prepare(`
    INSERT INTO users (email, name, password_hash, google_sub, free_answers_left, signup_ip)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(email, name, passwordHash, googleSub, freeAnswersForNewAccount(ip), ip);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();
const looksLikeEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

// ---- Google ID tokens ---------------------------------------------------------------------

let googleKeys = { keys: [], fetchedAt: 0 };

async function getGoogleKey(kid) {
  if (!googleKeys.keys.length || Date.now() - googleKeys.fetchedAt > 3600 * 1000 || !googleKeys.keys.some((k) => k.kid === kid)) {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!response.ok) throw new Error('Could not reach Google to check the sign-in');
    googleKeys = { keys: (await response.json()).keys ?? [], fetchedAt: Date.now() };
  }
  const jwk = googleKeys.keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error('Unknown Google signing key');
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

/** Check a Google ID token and return its claims ({ sub, email, name, ... }). */
async function verifyGoogleToken(idToken) {
  const parts = String(idToken ?? '').split('.');
  if (parts.length !== 3) throw new Error('Malformed Google token');
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString());
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');

  const key = await getGoogleKey(header.kid);
  const valid = crypto.verify('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), key, Buffer.from(signaturePart, 'base64url'));
  if (!valid) throw new Error('Invalid Google token signature');

  const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
  const now = Date.now() / 1000;
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('Token not issued by Google');
  if (claims.aud !== config.googleClientId) throw new Error('Token is for a different app');
  if (!(claims.exp > now - 60)) throw new Error('Google sign-in expired, please try again');
  if (!claims.email || claims.email_verified !== true) throw new Error('Your Google email is not verified');
  return claims;
}

// ---- Routes -----------------------------------------------------------------------------------

export const authRouter = express.Router();
// Per address, and high, because everyone on a campus can share one. Guessing one account's password
// is limited separately, however many addresses it comes from.
const limitAuth = rateLimiter({ max: 120, windowMs: 60 * 1000 });
const limitLoginPerAccount = rateLimiter({ max: 10, windowMs: 60 * 1000, by: (req) => normalizeEmail(req.body?.email) });

authRouter.post('/signup', limitAuth, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const name = String(req.body?.name ?? '').trim().slice(0, 80) || null;

  if (!looksLikeEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Use a password with at least 8 characters.' });
  if (password.length > 200) return res.status(400).json({ error: 'That password is too long.' });

  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({
      error: existing.password_hash
        ? 'An account with this email already exists. Log in instead.'
        : 'This email uses Google sign-in. Use "Continue with Google".',
    });
  }

  const user = createUser({ email, name, passwordHash: hashPassword(password), ip: req.ip });
  startSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post('/login', limitAuth, limitLoginPerAccount, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (user && !user.password_hash) {
    return res.status(400).json({ error: 'This account uses Google sign-in. Use "Continue with Google".' });
  }
  if (!user || !checkPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  startSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post('/google', limitAuth, async (req, res) => {
  if (!config.googleClientId) return res.status(400).json({ error: 'Google sign-in is not set up on this server.' });
  let claims;
  try {
    claims = await verifyGoogleToken(req.body?.credential);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }

  const email = normalizeEmail(claims.email);
  let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(claims.sub);
  if (!user) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user) {
      // Same email as an existing account, now proven by Google. Sign-up never proved who set that
      // password, so someone could have registered this address before its owner arrived. Cancel
      // the old password, logins and reset links so nobody else stays in the account. The credit
      // stays, and a real owner who wants a password back can use "Forgot your password?".
      const accountId = user.id;
      transaction(() => {
        db.prepare('UPDATE users SET google_sub = ?, name = COALESCE(name, ?), password_hash = NULL WHERE id = ?').run(claims.sub, claims.name ?? null, accountId);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(accountId);
        db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(accountId);
      });
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    } else {
      user = createUser({ email, name: claims.name ?? null, googleSub: claims.sub, ip: req.ip });
    }
  }
  startSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

// ---- Forgotten passwords ---------------------------------------------------------------------

const RESET_LINKS_PER_HOUR = 3; // per account, so nobody can flood someone's inbox
const limitForgot = rateLimiter({ max: 30, windowMs: 60 * 1000 });

// The answer is the same whether or not the account exists, and the email is sent after replying,
// so this can't be used to find out who has an account. A Google-only account can use this too:
// getting the email proves they own the address, and it gives them a password as well.
authRouter.post('/forgot', limitForgot, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!looksLikeEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });

  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
  if (user) {
    const { count } = db.prepare("SELECT COUNT(*) AS count FROM password_resets WHERE user_id = ? AND created_at > datetime('now', '-1 hour')").get(user.id);
    if (count < RESET_LINKS_PER_HOUR) {
      const token = crypto.randomBytes(32).toString('base64url');
      db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))").run(sha256(token), user.id);
      sendPasswordResetEmail(user.email, token).catch((err) => console.error('[email] Could not send a reset link:', err.message));
    }
  }
  res.json({ ok: true });
});

authRouter.post('/reset', limitAuth, (req, res) => {
  const password = String(req.body?.password ?? '');
  if (password.length < 8) return res.status(400).json({ error: 'Use a password with at least 8 characters.' });
  if (password.length > 200) return res.status(400).json({ error: 'That password is too long.' });

  const reset = db.prepare("SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > datetime('now')").get(sha256(String(req.body?.token ?? '')));
  if (!reset) return res.status(400).json({ code: 'bad_reset_link', error: 'This link has expired or was already used. Ask for a new one.' });

  // A new password logs out every device, in case someone else was in the account
  const passwordHash = hashPassword(password);
  transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, reset.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(reset.user_id);
  });
  startSession(req, res, reset.user_id);
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});
