// Who may ask the AI, and what each answer costs.
//
// A "chat" is one message to the tutor: a new lesson, a follow-up question or a change to a picture.
//
// Order of payment for a chat:
//   anonymous visitor → free trial answers (TRIAL_ANSWERS), then "please log in"
//   logged-in user    → free sign-up answers, then their prepaid ₹ balance, then "please top up"
//
// Credits are charged at the answer's real AI cost (tokens × the model's price) plus a small
// markup that only covers the payment fee. Failed answers are never charged.

import { db, transaction } from './db.js';
import { config } from './config.js';

// USD per million tokens [input, output]. Set AI_PRICE_INPUT_PER_M / AI_PRICE_OUTPUT_PER_M in
// .env to override (needed for models not listed here). Check your provider's pricing page.
const MODEL_PRICES = {
  'gpt-6-luna': [0.1, 0.5],
  'gpt-6.1-terra': [1, 5],
  'gpt-6.1-sol': [2, 10],
  'gpt-5-nano': [0.05, 0.4],
  'gpt-5-mini': [0.25, 2],
  'openai/gpt-oss-120b': [0.15, 0.6],
};
const UNKNOWN_MODEL_PRICE = [1, 5]; // cautious guess so we never undercharge by much
const warnedModels = new Set();

/** [input, output] USD per million tokens for this model. */
export function modelPrice(model) {
  const input = Number(process.env.AI_PRICE_INPUT_PER_M);
  const output = Number(process.env.AI_PRICE_OUTPUT_PER_M);
  if (process.env.AI_PRICE_INPUT_PER_M && process.env.AI_PRICE_OUTPUT_PER_M && Number.isFinite(input) && Number.isFinite(output)) return [input, output];
  const known = MODEL_PRICES[model] ?? MODEL_PRICES[String(model).replace(/-\d{4}-\d{2}-\d{2}$/, '')];
  if (known) return known;
  if (!warnedModels.has(model)) {
    warnedModels.add(model);
    console.warn(`[billing] No price known for model "${model}". Using $${UNKNOWN_MODEL_PRICE.join('/$')} per million tokens. Set AI_PRICE_INPUT_PER_M and AI_PRICE_OUTPUT_PER_M in .env.`);
  }
  return UNKNOWN_MODEL_PRICE;
}

export function costUsd({ model, inputTokens, outputTokens }) {
  const [input, output] = modelPrice(model);
  return (inputTokens * input + outputTokens * output) / 1e6;
}

/** What we charge for an answer that cost the AI provider `usd`, in whole paise (rounded up). */
export function chargeForCost(usd) {
  return Math.max(1, Math.ceil(usd * config.usdToInr * (1 + config.markup) * 100));
}

const TYPICAL_INPUT_TOKENS = 5000;
const TYPICAL_OUTPUT_TOKENS = 9500;

/**
 * Average charge for a new lesson over the last 200, in paise. Prices are quoted at this, so a
 * "chat" is never promised for less than a lesson costs and a cheap follow-up leaves money over.
 * Before there is any history,
 * estimate from the configured model's price and a typical answer size.
 */
export function averageChargePaise(model) {
  const { avg, n } = db.prepare('SELECT AVG(cost_usd) AS avg, COUNT(*) AS n FROM (SELECT cost_usd FROM usage WHERE model = ? AND kind = \'lesson\' ORDER BY id DESC LIMIT 200)').get(model);
  if (n >= 5 && avg > 0) return chargeForCost(avg);
  return chargeForCost(costUsd({ model, inputTokens: TYPICAL_INPUT_TOKENS, outputTokens: TYPICAL_OUTPUT_TOKENS }));
}

// ---- Allowance -------------------------------------------------------------------------

const inFlight = new Set(); // one AI request at a time per account / visitor

function accountKey(req) {
  return req.user ? `u${req.user.id}` : `v${req.visitorId}`;
}

export function trialStatus(req) {
  const visitor = db.prepare('SELECT trial_used FROM visitors WHERE id = ?').get(req.visitorId) ?? { trial_used: 0 };
  const left = Math.max(0, config.trialAnswers - visitor.trial_used);
  return { used: visitor.trial_used, limit: config.trialAnswers, left };
}

function ipTrialsToday(ip) {
  return db.prepare("SELECT COUNT(*) AS n FROM usage WHERE ip = ? AND paid_with = 'trial' AND created_at > datetime('now', '-1 day')").get(ip).n;
}

/**
 * Decide how this request will be paid for and reserve it (a trial or free answer is taken
 * now, and given back by release() if the answer fails).
 * @returns {{ ok: true, payWith, release, settle } | { ok: false, status, code, message }}
 */
export function reserveAnswer(req, model, { minimumPaise } = {}) {
  const key = accountKey(req);
  if (inFlight.has(key)) {
    return { ok: false, status: 429, code: 'busy', message: 'Your previous question is still being answered. Wait for it to finish.' };
  }

  let payWith = null;
  if (req.user) {
    const taken = db.prepare('UPDATE users SET free_answers_left = free_answers_left - 1 WHERE id = ? AND free_answers_left > 0').run(req.user.id);
    if (taken.changes) payWith = 'free';
    else if (req.user.balance_paise >= (minimumPaise ?? averageChargePaise(model))) payWith = 'credits';
    else {
      return {
        ok: false,
        status: 402,
        code: 'payment_required',
        message: `You've used your free chats. ₹20 covers about ${Math.max(1, Math.floor(2000 / averageChargePaise(model)))} more, and every lesson you've asked for stays free to reopen.`,
      };
    }
  } else {
    if (ipTrialsToday(req.ip) >= config.trialPerIpPerDay) {
      return { ok: false, status: 401, code: 'login_required', message: 'Free chats from this network are used up for today. Sign up (free) to keep going.' };
    }
    const taken = db.prepare('UPDATE visitors SET trial_used = trial_used + 1 WHERE id = ? AND trial_used < ?').run(req.visitorId, config.trialAnswers);
    if (!taken.changes) {
      return {
        ok: false,
        status: 401,
        code: 'login_required',
        message: `You've used your ${config.trialAnswers} free chats. Sign up (free) to get ${config.freeAnswersAfterSignup} more.`,
      };
    }
    payWith = 'trial';
  }

  inFlight.add(key);
  let done = false;

  return {
    ok: true,
    payWith,
    /** The answer failed: give the trial / free answer back. */
    release() {
      if (done) return;
      done = true;
      inFlight.delete(key);
      if (payWith === 'free') db.prepare('UPDATE users SET free_answers_left = free_answers_left + 1 WHERE id = ?').run(req.user.id);
      if (payWith === 'trial') db.prepare('UPDATE visitors SET trial_used = MAX(0, trial_used - 1) WHERE id = ?').run(req.visitorId);
    },
    /** The answer succeeded: record its cost and take credits if needed. Returns a summary for the browser. */
    settle(usage) {
      if (done) return null;
      done = true;
      inFlight.delete(key);
      const usd = costUsd(usage);
      const charge = payWith === 'credits' ? chargeForCost(usd) : 0;
      transaction(() => {
        db.prepare(`
          INSERT INTO usage (user_id, visitor_id, ip, model, input_tokens, output_tokens, cost_usd, charged_paise, paid_with, kind)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(req.user?.id ?? null, req.visitorId, req.ip, usage.model, usage.inputTokens, usage.outputTokens, usd, charge, payWith, usage.kind ?? 'lesson');
        // Never below zero: if the last chat costs a little more than the balance, we cover it
        if (charge) db.prepare('UPDATE users SET balance_paise = MAX(0, balance_paise - ?) WHERE id = ?').run(charge, req.user.id);
      });
      console.log(`[billing] ${payWith}: ${usage.inputTokens} in + ${usage.outputTokens} out tokens = $${usd.toFixed(5)}${charge ? `, charged ₹${(charge / 100).toFixed(2)}` : ''}`);
      return { paidWith: payWith, chargedPaise: charge, costUsd: usd };
    },
  };
}
