// SQLite storage, using Node's built-in node:sqlite (no extra package).
// The database file lives in data/mathlens.db (git-ignored). Delete it to start fresh.
//
// Money is stored as whole paise (₹1 = 100 paise) in integers, never as floats.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(import.meta.dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'mathlens.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY,
    email             TEXT NOT NULL UNIQUE,
    name              TEXT,
    password_hash     TEXT,              -- null for Google-only accounts
    google_sub        TEXT UNIQUE,       -- Google's stable user id
    balance_paise     INTEGER NOT NULL DEFAULT 0,
    free_answers_left INTEGER NOT NULL DEFAULT 0,
    signup_ip         TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,         -- sha256 of the cookie value; the raw token is never stored
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Anonymous visitors (a random id in a cookie) and how many trial answers they used
  CREATE TABLE IF NOT EXISTS visitors (
    id         TEXT PRIMARY KEY,
    trial_used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per AI answer, with its real cost
  CREATE TABLE IF NOT EXISTS usage (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visitor_id    TEXT,
    ip            TEXT,
    model         TEXT,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    cost_usd      REAL,                  -- what the AI provider charged us
    charged_paise INTEGER NOT NULL DEFAULT 0,
    paid_with     TEXT NOT NULL,         -- 'trial' | 'free' | 'credits'
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS usage_ip_time ON usage(ip, created_at);

  -- Every lesson someone asked for, so they can reopen it (and repeat questions cost nothing)
  CREATE TABLE IF NOT EXISTS lessons (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    visitor_id   TEXT,                  -- for people without an account (moved to user_id on sign-up)
    question     TEXT NOT NULL,
    question_key TEXT NOT NULL,         -- normalised question (+ document fingerprint) for matching
    title        TEXT,
    source_name  TEXT,                  -- uploaded file name, if the lesson was about a document
    answer_json  TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    opened_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS lessons_user ON lessons(user_id, question_key);
  CREATE INDEX IF NOT EXISTS lessons_visitor ON lessons(visitor_id, question_key);

  CREATE TABLE IF NOT EXISTS payments (
    id                  INTEGER PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id),
    razorpay_order_id   TEXT NOT NULL UNIQUE,
    razorpay_payment_id TEXT,
    amount_paise        INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'created',  -- 'created' | 'paid'
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at             TEXT
  );
`);

/** Run `fn` inside a transaction: all of its writes happen, or none do. */
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Remove expired sessions now and then
setInterval(() => db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run(), 6 * 3600 * 1000).unref();
