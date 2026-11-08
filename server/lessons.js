// Saved lessons ("your notebook"): every answer someone gets is stored with their question.
//
// - Asking the same question again returns the saved lesson for free.
// - GET /api/lessons/similar finds earlier lessons on nearly the same question, so the page can
//   offer the saved one before spending an answer.
// - Lessons belong to the account (or, before sign-up, to the browser's visitor id; they move to
//   the account when that person signs up or logs in).

import crypto from 'node:crypto';
import express from 'express';
import { db } from './db.js';

// Words that don't change what a question is about
const STOPWORDS = new Set(`a an the of to in on for and or is are was were be been it its this that these those what whats
  how why when where which who whom does do did can could would should will shall may might me my i you your we our
  explain tell show teach give please about with as by from at into intuition intuitively simple simply visually visual
  mean means meaning understand understanding work works works help some there their they them than then`.split(/\s+/));

/** A canonical form of the question: lower case, no punctuation, single spaces. */
export function normalizeQuestion(question) {
  return String(question)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The key a lesson is stored under. A document adds its fingerprint, so a new paper is a new lesson. */
export function lessonKey(question, documentText) {
  const base = normalizeQuestion(question);
  if (!documentText) return base;
  const fingerprint = crypto.createHash('sha256').update(String(documentText)).digest('hex').slice(0, 16);
  return `doc:${fingerprint}|${base}`;
}

function contentWords(question) {
  return new Set(
    normalizeQuestion(question)
      .split(' ')
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
      .map((w) => w.replace(/(ies|es|s)$/, (end) => (end === 'ies' ? 'y' : ''))),
  );
}

/** How alike two questions are, from 0 to 1 (overlap of their content words). */
function similarity(a, b) {
  const x = contentWords(a);
  const y = contentWords(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/** SQL condition + values that select the lessons this person owns. */
export function owner(req) {
  return req.user ? ['user_id = ?', [req.user.id]] : ['user_id IS NULL AND visitor_id = ?', [req.visitorId]];
}

export function findSavedLesson(req, key) {
  const [where, values] = owner(req);
  const row = db.prepare(`SELECT * FROM lessons WHERE ${where} AND question_key = ? ORDER BY id DESC LIMIT 1`).get(...values, key);
  if (!row) return null;
  db.prepare("UPDATE lessons SET opened_at = datetime('now') WHERE id = ?").run(row.id);
  return { id: row.id, answer: JSON.parse(row.answer_json) };
}

export function saveLesson(req, { question, key, sourceName, answer }) {
  const result = db.prepare(`
    INSERT INTO lessons (user_id, visitor_id, question, question_key, title, source_name, answer_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.user?.id ?? null, req.visitorId, question, key, answer.title || question.slice(0, 120), sourceName ?? null, JSON.stringify(answer));
  return Number(result.lastInsertRowid);
}

/** After sign-up or log-in, the lessons this browser collected become the account's. */
export function claimVisitorLessons(userId, visitorId) {
  if (!visitorId) return;
  db.prepare('UPDATE lessons SET user_id = ? WHERE visitor_id = ? AND user_id IS NULL').run(userId, visitorId);
  db.prepare('UPDATE followups SET user_id = ? WHERE visitor_id = ? AND user_id IS NULL').run(userId, visitorId);
}

function summary(row) {
  let steps = 0;
  try {
    steps = JSON.parse(row.answer_json).steps?.length ?? 0;
  } catch {
    // ignore
  }
  return { id: row.id, title: row.title, question: row.question, sourceName: row.source_name, createdAt: row.created_at, steps };
}

// ---- Routes ------------------------------------------------------------------------------

export const lessonsRouter = express.Router();

lessonsRouter.get('/', (req, res) => {
  const [where, values] = owner(req);
  const rows = db.prepare(`SELECT id, title, question, source_name, created_at, answer_json FROM lessons WHERE ${where} ORDER BY id DESC LIMIT 300`).all(...values);
  res.json({ lessons: rows.map(summary) });
});

lessonsRouter.get('/similar', (req, res) => {
  const question = String(req.query.q ?? '').slice(0, 2000);
  if (!question.trim()) return res.json({ matches: [] });
  const [where, values] = owner(req);
  const rows = db.prepare(`SELECT id, title, question, source_name, created_at, answer_json FROM lessons WHERE ${where} AND source_name IS NULL ORDER BY id DESC LIMIT 300`).all(...values);
  const matches = rows
    .map((row) => ({ ...summary(row), score: similarity(question, row.question) }))
    .filter((m) => m.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  res.json({ matches });
});

lessonsRouter.get('/:id', (req, res) => {
  const [where, values] = owner(req);
  const row = db.prepare(`SELECT * FROM lessons WHERE id = ? AND ${where}`).get(Number(req.params.id), ...values);
  if (!row) return res.status(404).json({ error: 'That lesson is not in your notebook.' });
  db.prepare("UPDATE lessons SET opened_at = datetime('now') WHERE id = ?").run(row.id);
  res.json({ ...summary(row), answer: JSON.parse(row.answer_json) });
});

lessonsRouter.delete('/:id', (req, res) => {
  const [where, values] = owner(req);
  const result = db.prepare(`DELETE FROM lessons WHERE id = ? AND ${where}`).run(Number(req.params.id), ...values);
  if (!result.changes) return res.status(404).json({ error: 'That lesson is not in your notebook.' });
  res.json({ ok: true });
});
