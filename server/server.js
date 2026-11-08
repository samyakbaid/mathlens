// MathLens web server.
// - Serves the website from /public
// - POST /api/ask            asks the AI (Claude or an open model) to explain a concept and build a visualization
// - GET  /api/me             who is logged in, free answers left, balance and prices
// - POST /api/auth/...       sign up, log in (email or Google), log out
// - POST /api/payments/...   top up credits with Razorpay
// - GET  /api/lessons/...    the notebook: saved lessons (repeat questions are free)

import './env.js'; // must be first: loads .env
import express from 'express';
import path from 'node:path';
import { explainConcept, describeError, getProvider } from './ai.js';
import { config } from './config.js';
import { emailConfigured } from './email.js';
import { keepAlive } from './keep-alive.js';
import { followupsRouter } from './followups.js';
import { identify, sameOriginOnly, authRouter, publicUser } from './auth.js';
import { reserveAnswer, trialStatus, averageChargePaise, freeQuestionsStatus } from './billing.js';
import { paymentsRouter, paymentsEnabled, handleWebhook } from './payments.js';
import { db } from './db.js';
import { lessonsRouter, lessonKey, findSavedLesson, saveLesson } from './lessons.js';
import { pagesRouter, missingBusinessDetails } from './pages.js';

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');
const MAX_QUESTION_LENGTH = 2000;

const MAX_DOCUMENT_CHARS = 120000; // about 30k tokens: plenty for a paper, and still cheap

// Answers still being written, per account and question. A reload while waiting joins the same
// request instead of starting (and paying for) a second one.
const inFlight = new Map(); // "account|key" → Promise<answer>

const app = express();
// Behind a proxy (Render, Railway, nginx...) set TRUST_PROXY=1 so req.ip is the visitor's real IP.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// For the hosting provider's uptime check
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Shows the caller their own IP as the server sees it, to confirm TRUST_PROXY after deploying.
// The free limits count by IP, so a wrong value would make every visitor look like one person.
if (process.env.SHOW_IP_CHECK === 'true') {
  app.get('/ipcheck', (req, res) => res.json({ seenAs: req.ip, forwardedFor: req.headers['x-forwarded-for'] ?? null }));
}

// The webhook needs the raw body to check Razorpay's signature, so it comes before express.json()
app.post('/api/payments/webhook', express.raw({ type: 'application/json', limit: '100kb' }), handleWebhook);

// Questions with an attached paper can be large; everything else stays small
const smallJson = express.json({ limit: '50kb' });
const largeJson = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path === '/api/ask' ? largeJson : smallJson)(req, res, next));
app.use(express.static(PUBLIC_DIR));
app.use(pagesRouter); // /about, /pricing, /contact, /terms, /privacy, /refunds, /delivery, /receipts
app.use('/api', sameOriginOnly, identify);
app.use('/api/auth', authRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/lessons', lessonsRouter);
app.use('/api/followups', followupsRouter);

/** Everything the browser needs to show the account bar, limits and prices. */
app.get('/api/me', (req, res) => {
  let model = '';
  try {
    model = getProvider().modelName();
  } catch {
    // unknown provider: the AI page shows the error when used
  }
  const average = averageChargePaise(model);
  res.json({
    user: publicUser(req.user),
    trial: trialStatus(req),
    freeQuestions: freeQuestionsStatus(req),
    pricing: {
      currency: 'INR',
      averageAnswerPaise: average,
      markup: config.markup,
      minTopupRupees: config.minTopupRupees,
      maxTopupRupees: config.maxTopupRupees,
      freeAnswersAfterSignup: config.freeAnswersAfterSignup,
    },
    integrations: {
      googleClientId: config.googleClientId || null,
      businessName: config.businessName || null,
      payments: paymentsEnabled(),
    },
  });
});

app.post('/api/ask', async (req, res) => {
  const builtInTopics = Array.isArray(req.body?.builtInTopics) ? req.body.builtInTopics.slice(0, 200) : [];
  const documentText = typeof req.body?.document?.text === 'string' ? req.body.document.text.slice(0, MAX_DOCUMENT_CHARS) : '';
  const documentName = documentText ? String(req.body.document.name ?? 'document').slice(0, 160) : null;
  let question = String(req.body?.question ?? '').trim();
  if (!question && documentText) question = 'Explain the main idea of this document.';

  if (!question) {
    return res.status(400).json({ error: 'Type a question first.' });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({ error: `Questions can be up to ${MAX_QUESTION_LENGTH} characters long.` });
  }

  let model = '';
  try {
    model = getProvider().modelName();
  } catch (err) {
    const { status, message } = describeError(err);
    return res.status(status).json({ error: message });
  }

  const currentUser = () => (req.user ? db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) : null);
  const key = lessonKey(question, documentText);
  const account = req.user ? `u${req.user.id}` : `v${req.visitorId}`;

  // Asked this before? The saved lesson is free.
  const saved = findSavedLesson(req, key);
  if (saved) {
    console.log(`[ask] (saved lesson ${saved.id}, free) ${question.slice(0, 120)}`);
    return res.json({ ...saved.answer, lessonId: saved.id, billing: { paidWith: 'saved', chargedPaise: 0, costUsd: 0, user: publicUser(currentUser()), trial: trialStatus(req) } });
  }

  // Already being answered (for example, the page was reloaded while waiting)? Join that request.
  const running = inFlight.get(`${account}|${key}`);
  if (running) {
    try {
      const { answer, lessonId } = await running;
      return res.json({ ...answer, lessonId, billing: { paidWith: 'saved', chargedPaise: 0, costUsd: 0, user: publicUser(currentUser()), trial: trialStatus(req) } });
    } catch {
      // that attempt failed: try again below
    }
  }

  // Free trial, free sign-up answers or prepaid credits?
  const ticket = reserveAnswer(req, model);
  if (!ticket.ok) return res.status(ticket.status).json({ error: ticket.message, code: ticket.code });

  console.log(`[ask] (${ticket.payWith}) ${documentName ? `[${documentName}, ${documentText.length} chars] ` : ''}${question.slice(0, 120)}`);
  const started = Date.now();

  const work = explainConcept(question, builtInTopics, { documentText, documentName }).then(({ answer, usage }) => {
    const billing = ticket.settle(usage);
    const lessonId = saveLesson(req, { question, key, sourceName: documentName, answer });
    return { answer, usage, billing, lessonId };
  });
  work.catch(() => {}); // handled below; don't let the shared copy crash the server
  inFlight.set(`${account}|${key}`, work);

  const finish = keepAlive(res);

  try {
    const { answer, billing, lessonId } = await work;
    console.log(`[ask] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    finish(200, { ...answer, lessonId, billing: { ...billing, user: publicUser(currentUser()), trial: trialStatus(req) } });
  } catch (err) {
    ticket.release(); // failed answers are free
    console.error('[ask] failed:', err);
    const { status, message } = describeError(err);
    finish(status, { error: message });
  } finally {
    inFlight.delete(`${account}|${key}`);
  }
});

app.listen(PORT, process.env.HOST || undefined, () => {
  console.log(`MathLens running at http://localhost:${PORT}`);
  try {
    const provider = getProvider();
    console.log(`Ask AI: ${provider.name} / ${provider.modelName() || '(no model set)'}`);
    const problem = provider.setupProblem();
    if (problem) console.log(`Note: ${problem}, so the "Ask AI" tab will not work yet. See .env.example`);
  } catch (err) {
    console.log(`Note: ${err.message}`);
  }
  console.log(`Accounts: email${config.googleClientId ? ' + Google' : ' (set GOOGLE_CLIENT_ID for Google sign-in)'} · Payments: ${paymentsEnabled() ? 'Razorpay' : 'off (set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)'}`);
  if (!emailConfigured()) console.log('Password reset: emails are off (set SMTP_HOST, SMTP_USER and SMTP_PASS). See .env.example');
  else if (!config.publicUrl && process.env.NODE_ENV === 'production') console.log('Password reset: set PUBLIC_URL so emails can link back to the site');
  const missing = missingBusinessDetails();
  if (missing.length) console.log(`Policy pages: fill in ${missing.join(', ')} in .env before going live (they show on /contact, /terms and receipts)`);
});
