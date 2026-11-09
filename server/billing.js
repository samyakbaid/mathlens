// Who may ask the AI, and what each answer costs.
//
// A "chat" is a new lesson, a change to a picture, or a set of QUESTIONS_PER_CHAT follow-up questions.
//
// Follow-up questions inside a lesson are free up to FREE_QUESTIONS_PER_DAY. After that, the first
// question of a set takes a chat and the rest of the set is kept in questions_covered until it's used.
//
// Order of payment for a chat:
//   anonymous visitor → free trial answers (TRIAL_ANSWERS), then "please log in"
//   logged-in user    → free sign-up answers, then their prepaid ₹ balance, then "please top up"
//
// A new lesson or picture change is charged to credit at its real AI cost (tokens × the model's
// price) plus a small markup that only covers the payment fee. A set of questions is charged the
// average price of a chat. Failed answers are never charged.

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

// Answers still being written aren't in the usage table yet. They're counted here too, or a burst
// of requests from new visitors would all get past the daily limits before the first one finished.
const underway = new Map();
const countUnderway = (key) => underway.get(key) ?? 0;
function markUnderway(payWith, ip, change) {
  const keys = { question: ['question', `question:${ip}`], trial: ['free-chat', `trial:${ip}`], free: ['free-chat'] }[payWith] ?? [];
  for (const key of keys) {
    const next = countUnderway(key) + change;
    if (next > 0) underway.set(key, next);
    else underway.delete(key);
  }
}

function accountKey(req) {
  return req.user ? `u${req.user.id}` : `v${req.visitorId}`;
}

export function trialStatus(req) {
  const visitor = db.prepare('SELECT trial_used FROM visitors WHERE id = ?').get(req.visitorId) ?? { trial_used: 0 };
  const left = Math.max(0, config.trialAnswers - visitor.trial_used);
  return { used: visitor.trial_used, limit: config.trialAnswers, left };
}

function ipTrialsToday(ip) {
  return db.prepare("SELECT COUNT(*) AS n FROM usage WHERE ip = ? AND paid_with = 'trial' AND created_at > datetime('now', '-1 day')").get(ip).n + countUnderway(`trial:${ip}`);
}

/** Free chats used across the whole site in the last day, including any being written now. */
function freeChatsUsedToday() {
  return db.prepare("SELECT COUNT(*) AS n FROM usage WHERE paid_with IN ('trial', 'free') AND created_at > datetime('now', '-1 day')").get().n + countUnderway('free-chat');
}

function questionsCovered(req) {
  const row = req.user
    ? db.prepare('SELECT questions_covered AS n FROM users WHERE id = ?').get(req.user.id)
    : db.prepare('SELECT questions_covered AS n FROM visitors WHERE id = ?').get(req.visitorId);
  return row?.n ?? 0;
}

function addQuestionsCovered(req, count) {
  if (req.user) db.prepare('UPDATE users SET questions_covered = questions_covered + ? WHERE id = ?').run(count, req.user.id);
  else db.prepare('UPDATE visitors SET questions_covered = questions_covered + ? WHERE id = ?').run(count, req.visitorId);
}

function useCoveredQuestion(req) {
  const used = req.user
    ? db.prepare('UPDATE users SET questions_covered = questions_covered - 1 WHERE id = ? AND questions_covered > 0').run(req.user.id)
    : db.prepare('UPDATE visitors SET questions_covered = questions_covered - 1 WHERE id = ? AND questions_covered > 0').run(req.visitorId);
  return used.changes > 0;
}

/** Follow-up questions this person can still ask today for free, and how many their last chat covers. */
export function freeQuestionsStatus(req) {
  const limit = config.freeQuestionsPerDay;
  const asked = req.user
    ? db.prepare("SELECT COUNT(*) AS n FROM usage WHERE paid_with = 'question' AND (user_id = ? OR visitor_id = ?) AND created_at > datetime('now', '-1 day')").get(req.user.id, req.visitorId).n
    : db.prepare("SELECT COUNT(*) AS n FROM usage WHERE paid_with = 'question' AND visitor_id = ? AND created_at > datetime('now', '-1 day')").get(req.visitorId).n;
  let left = Math.max(0, limit - asked);
  if (left > 0) {
    const network = db.prepare("SELECT COUNT(*) AS everyone, COUNT(*) - COUNT(user_id) AS visitors FROM usage WHERE paid_with = 'question' AND ip = ? AND created_at > datetime('now', '-1 day')").get(req.ip);
    const site = db.prepare("SELECT COUNT(*) AS n FROM usage WHERE paid_with = 'question' AND created_at > datetime('now', '-1 day')").get().n;
    const here = countUnderway(`question:${req.ip}`);
    if (
      site + countUnderway('question') >= config.freeQuestionsSitePerDay ||
      network.everyone + here >= config.freeQuestionsAllPerIpPerDay ||
      (!req.user && network.visitors + here >= config.freeQuestionsPerIpPerDay)
    ) {
      left = 0;
    }
  }
  return { limit, left, covered: questionsCovered(req), perChat: config.questionsPerChat };
}

/**
 * Take one chat: a free trial chat, a free sign-up chat, or enough balance to pay for it.
 * @returns {{ ok: true, payWith: string } | { ok: false, status: number, code: string, message: string }}
 */
function takeChat(req, model, minimumPaise) {
  const freeChatsGone = freeChatsUsedToday() >= config.freeChatsSitePerDay;
  if (req.user) {
    // Someone who has bought credit is never held back by the site-wide limit on free chats
    if (!freeChatsGone || req.user.balance_paise > 0) {
      const taken = db.prepare('UPDATE users SET free_answers_left = free_answers_left - 1 WHERE id = ? AND free_answers_left > 0').run(req.user.id);
      if (taken.changes) return { ok: true, payWith: 'free' };
    }
    if (req.user.balance_paise >= (minimumPaise ?? averageChargePaise(model))) return { ok: true, payWith: 'credits' };
    if (freeChatsGone && req.user.free_answers_left > 0) {
      return {
        ok: false,
        status: 402,
        code: 'payment_required',
        message: `MathLens is very busy today and the free chats have run out for now. Yours are safe and will work again tomorrow. To keep going now, you can top up from ₹${config.minTopupRupees}.`,
      };
    }
    return {
      ok: false,
      status: 402,
      code: 'payment_required',
      message: `You've used your free chats. ₹20 covers about ${Math.max(1, Math.floor(2000 / averageChargePaise(model)))} more, and every lesson you've asked for stays free to reopen.`,
    };
  }
  if (freeChatsGone) {
    return { ok: false, status: 401, code: 'login_required', message: `MathLens is very busy today and the free chats have run out for now. Sign up (free) and your ${config.freeAnswersAfterSignup} free chats will be ready tomorrow.` };
  }
  if (ipTrialsToday(req.ip) >= config.trialPerIpPerDay) {
    return { ok: false, status: 401, code: 'login_required', message: 'Free chats from this network are used up for today. Sign up (free) to keep going.' };
  }
  const taken = db.prepare('UPDATE visitors SET trial_used = trial_used + 1 WHERE id = ? AND trial_used < ?').run(req.visitorId, config.trialAnswers);
  if (taken.changes) return { ok: true, payWith: 'trial' };
  return {
    ok: false,
    status: 401,
    code: 'login_required',
    message: `You've used your ${config.trialAnswers} free chats. Sign up (free) to get ${config.freeAnswersAfterSignup} more.`,
  };
}

/**
 * Decide how this request will be paid for and reserve it (a trial or free chat is taken now, and
 * given back by release() if the answer fails). A question uses a free daily question first, then
 * one its last chat covers, then a new chat. If the AI then finds it needs a new picture,
 * upgradeToChat() takes a chat instead.
 * @returns {{ ok: true, payWith, upgradeToChat, release, settle } | { ok: false, status, code, message }}
 */
export function reserveAnswer(req, model, { question = false } = {}) {
  const key = accountKey(req);
  if (inFlight.has(key)) {
    return { ok: false, status: 429, code: 'busy', message: 'Your previous question is still being answered. Wait for it to finish.' };
  }

  let payWith = null;
  if (question && freeQuestionsStatus(req).left > 0) {
    payWith = 'question';
  } else if (question && useCoveredQuestion(req)) {
    payWith = 'covered';
  } else {
    const chat = takeChat(req, model);
    if (!chat.ok) return chat;
    payWith = chat.payWith;
  }

  inFlight.add(key);
  markUnderway(payWith, req.ip, 1);
  let done = false;

  return {
    ok: true,
    get payWith() {
      return payWith;
    },
    /** This needs a chat after all (it changes a picture). Takes one, or says why it can't. */
    upgradeToChat(minimum) {
      if (payWith === 'question' || payWith === 'covered') {
        const chat = takeChat(req, model, minimum);
        if (!chat.ok) return chat;
        if (payWith === 'covered') addQuestionsCovered(req, 1);
        markUnderway(payWith, req.ip, -1);
        markUnderway(chat.payWith, req.ip, 1);
        payWith = chat.payWith;
      } else if (payWith === 'credits' && req.user.balance_paise < minimum) {
        return takeChat(req, model, minimum);
      }
      return { ok: true };
    },
    /** The answer failed: give back whatever it took. */
    release() {
      if (done) return;
      done = true;
      inFlight.delete(key);
      markUnderway(payWith, req.ip, -1);
      if (payWith === 'covered') addQuestionsCovered(req, 1);
      if (payWith === 'free') db.prepare('UPDATE users SET free_answers_left = free_answers_left + 1 WHERE id = ?').run(req.user.id);
      if (payWith === 'trial') db.prepare('UPDATE visitors SET trial_used = MAX(0, trial_used - 1) WHERE id = ?').run(req.visitorId);
    },
    /** The answer succeeded: record its cost and take credits if needed. Returns a summary for the browser. */
    settle(usage) {
      if (done) return null;
      done = true;
      inFlight.delete(key);
      markUnderway(payWith, req.ip, -1);
      const usd = costUsd(usage);
      const isQuestion = usage.kind === 'followup';
      // This question took a chat, so it starts a new set. A picture change takes a whole chat itself.
      const startsSet = isQuestion && (payWith === 'free' || payWith === 'trial' || payWith === 'credits');
      const charge = payWith !== 'credits' ? 0 : isQuestion ? averageChargePaise(model) : chargeForCost(usd);
      transaction(() => {
        db.prepare(`
          INSERT INTO usage (user_id, visitor_id, ip, model, input_tokens, output_tokens, cost_usd, charged_paise, paid_with, kind)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(req.user?.id ?? null, req.visitorId, req.ip, usage.model, usage.inputTokens, usage.outputTokens, usd, charge, payWith, usage.kind ?? 'lesson');
        // Never below zero: if the last chat costs a little more than the balance, we cover it
        if (charge) db.prepare('UPDATE users SET balance_paise = MAX(0, balance_paise - ?) WHERE id = ?').run(charge, req.user.id);
        if (startsSet) addQuestionsCovered(req, config.questionsPerChat - 1);
      });
      console.log(`[billing] ${payWith}: ${usage.inputTokens} in + ${usage.outputTokens} out tokens = $${usd.toFixed(5)}${charge ? `, charged ₹${(charge / 100).toFixed(2)}` : ''}`);
      return { paidWith: payWith, chargedPaise: charge, costUsd: usd };
    },
  };
}
