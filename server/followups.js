// Follow-up chats inside a lesson: a question about a step, or a request to change the picture.
//
// Works on saved AI lessons and on built-in lessons. The server reads a saved lesson from the
// database, so a browser can't swap in other content. A built-in lesson's text only exists in the
// browser, so it's sent with the question, limited in size, and treated as material to explain.
//
// A question is free, up to FREE_QUESTIONS_PER_DAY, and after that it's one chat at its real cost.
// Changing a picture always uses a chat. Asking the same thing about the same step again returns
// the saved reply for free.

import express from 'express';
import { db } from './db.js';
import { answerFollowUp, describeError, getProvider, rewritePicture } from './ai.js';
import { freeQuestionsStatus, reserveAnswer, trialStatus } from './billing.js';
import { publicUser } from './auth.js';
import { keepAlive } from './keep-alive.js';
import { normalizeQuestion, owner } from './lessons.js';

const MAX_QUESTION = 1000;
const MAX_HISTORY = 4; // earlier exchanges the AI sees
const MAX_TOPIC_STEPS = 20;
const MAX_STEP_TEXT = 3000;
// A question costs far less than a lesson, so a small balance can still pay for one.
// Changing a picture costs more, so it needs a little more.
const MINIMUM_BALANCE_PAISE = 15;
const MINIMUM_PICTURE_BALANCE_PAISE = 35;
const TOPIC_ID = /^[a-z0-9-]{1,80}$/;

const clean = (value, limit) => String(value ?? '').slice(0, limit);

/** What this chat is about: a saved lesson or a built-in topic. */
function findTarget(req, source) {
  if (source.lessonId !== undefined && source.lessonId !== null && source.lessonId !== '') {
    const [where, values] = owner(req);
    const row = db.prepare(`SELECT id, answer_json, source_name FROM lessons WHERE id = ? AND ${where}`).get(Number(source.lessonId), ...values);
    if (!row) return { error: 'That lesson is not in your notebook.', status: 404 };
    const answer = JSON.parse(row.answer_json);
    return { lessonId: row.id, topicId: null, lesson: { title: answer.title, intro: answer.intro, steps: answer.steps ?? [], fromDocument: Boolean(row.source_name) }, originalHtml: answer.visualizationHtml ?? '' };
  }
  const topicId = String(source.topicId ?? '');
  if (!TOPIC_ID.test(topicId)) return { error: 'Choose a lesson first.', status: 400 };
  return { lessonId: null, topicId, lesson: null, originalHtml: '' };
}

/** Rows for this person and this lesson or topic, oldest first. */
function threadRows(req, target) {
  const [where, values] = owner(req);
  if (target.lessonId) return db.prepare(`SELECT * FROM followups WHERE lesson_id = ? AND ${where} ORDER BY id`).all(target.lessonId, ...values);
  return db.prepare(`SELECT * FROM followups WHERE topic_id = ? AND ${where} ORDER BY id`).all(target.topicId, ...values);
}

const publicRow = (row) => ({
  id: row.id,
  stepIndex: row.step_index,
  question: row.question,
  reply: row.reply,
  visualizationHtml: row.visualization_html || null,
  createdAt: row.created_at,
});

export const followupsRouter = express.Router();

followupsRouter.get('/', (req, res) => {
  const target = findTarget(req, req.query);
  if (target.error) return res.status(target.status).json({ error: target.error });
  res.json({ items: threadRows(req, target).map(publicRow) });
});

followupsRouter.post('/', async (req, res) => {
  const body = req.body ?? {};
  const question = clean(body.question, MAX_QUESTION + 1).trim();
  if (!question) return res.status(400).json({ error: 'Type your question first.' });
  if (question.length > MAX_QUESTION) return res.status(400).json({ error: `Follow-up questions can be up to ${MAX_QUESTION} characters long.` });

  const target = findTarget(req, body);
  if (target.error) return res.status(target.status).json({ error: target.error });

  // A built-in lesson's text comes from the page
  if (target.topicId) {
    const steps = Array.isArray(body.steps) ? body.steps.slice(0, MAX_TOPIC_STEPS) : [];
    target.lesson = {
      title: clean(body.title, 200),
      intro: '',
      steps: steps.map((step) => ({ title: clean(step?.title, 200), explanation: clean(step?.text, MAX_STEP_TEXT) })),
      builtIn: true,
    };
    if (!target.lesson.steps.length) return res.status(400).json({ error: 'This lesson has no steps to ask about.' });
  }
  const stepCount = target.lesson.steps.length;
  const stepIndex = Math.max(0, Math.min(stepCount - 1, Math.floor(Number(body.stepIndex) || 0)));

  const account = () => ({ user: publicUser(req.user ? db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) : null), trial: trialStatus(req), freeQuestions: freeQuestionsStatus(req) });
  const rows = threadRows(req, target);

  // Asked this about this step already? The saved reply is free. Very short messages like "why?"
  // depend on what came before, so they always get a new answer.
  const questionKey = normalizeQuestion(question);
  if (questionKey.split(' ').length >= 3) {
    const saved = rows.find((row) => row.question_key === questionKey && row.step_index === stepIndex);
    if (saved) return res.json({ ...publicRow(saved), billing: { paidWith: 'saved', chargedPaise: 0, costUsd: 0, ...account() } });
  }

  let model = '';
  try {
    model = getProvider().modelName();
  } catch (err) {
    const { status, message } = describeError(err);
    return res.status(status).json({ error: message });
  }

  const ticket = reserveAnswer(req, model, { minimumPaise: MINIMUM_BALANCE_PAISE, freeQuestion: true });
  if (!ticket.ok) return res.status(ticket.status).json({ error: ticket.message, code: ticket.code });

  // The picture the reader is looking at now: the original, or one of their changed versions
  const base = rows.find((row) => row.id === Number(body.basePictureId) && row.visualization_html);
  const currentHtml = base?.visualization_html ?? target.originalHtml;

  console.log(`[follow-up] (${ticket.payWith}) ${target.lessonId ? `lesson ${target.lessonId}` : target.topicId}, step ${stepIndex + 1}: ${question.slice(0, 100)}`);
  const started = Date.now();
  const finish = keepAlive(res);
  try {
    const answer = await answerFollowUp({
      lesson: target.lesson,
      stepIndex,
      question,
      history: rows.slice(-MAX_HISTORY).map((row) => ({ question: row.question, reply: row.reply })),
    });
    const { reply } = answer;
    const usage = { ...answer.usage };
    let visualizationHtml = '';
    if (answer.changePicture) {
      // A question was free. Changing the picture uses a chat, so take one before doing the work.
      const chat = ticket.upgradeToChat(MINIMUM_PICTURE_BALANCE_PAISE);
      if (!chat.ok) {
        ticket.release();
        return finish(chat.status, { error: `Changing a picture uses a chat. ${chat.message}`, code: chat.code });
      }
      const picture = await rewritePicture({ lesson: target.lesson, stepIndex, question, pictureRequest: answer.pictureRequest, currentHtml });
      visualizationHtml = picture.visualizationHtml;
      usage.inputTokens += picture.usage.inputTokens;
      usage.outputTokens += picture.usage.outputTokens;
    }
    const billing = ticket.settle({ ...usage, kind: visualizationHtml ? 'picture' : 'followup' });
    const result = db.prepare(`
      INSERT INTO followups (user_id, visitor_id, lesson_id, topic_id, step_index, question, question_key, reply, visualization_html)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user?.id ?? null, req.visitorId, target.lessonId, target.topicId, stepIndex, question, questionKey, reply, visualizationHtml || null);
    console.log(`[follow-up] done in ${((Date.now() - started) / 1000).toFixed(1)}s${visualizationHtml ? ', picture changed' : ''}`);
    finish(200, { id: Number(result.lastInsertRowid), stepIndex, question, reply, visualizationHtml: visualizationHtml || null, billing: { ...billing, ...account() } });
  } catch (err) {
    ticket.release(); // failed answers are free
    console.error('[follow-up] failed:', err);
    const { status, message } = describeError(err);
    finish(status, { error: message });
  }
});
