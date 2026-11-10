// Emails the site owner (SUPPORT_EMAIL) when something needs them, such as the AI account running
// out of credit. The same alert is sent at most once every few hours, so a busy site can't flood
// the inbox.

import { config } from './config.js';
import { emailConfigured, sendEmail } from './email.js';

const QUIET_HOURS = 6;
const lastSent = new Map();

export function alertOwner(key, subject, text) {
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < QUIET_HOURS * 3600 * 1000) return;
  lastSent.set(key, now);
  console.error(`[alert] ${subject}`);
  if (!emailConfigured() || !config.supportEmail) {
    console.error('[alert] Not emailed: set SMTP_* and SUPPORT_EMAIL in .env to get these by email.');
    return;
  }
  sendEmail({ to: config.supportEmail, subject: `MathLens: ${subject}`, text }).catch((err) => console.error('[alert] email failed:', err.message));
}
