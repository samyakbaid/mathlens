// Sending email, over plain SMTP so any provider works (Gmail with an app password, Brevo, ...).
// Only used for password reset links.

import nodemailer from 'nodemailer';
import { config } from './config.js';

export function emailConfigured() {
  return Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
}

function sendEmail({ to, subject, text, html }) {
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPass },
  });
  return transport.sendMail({ from: config.mailFrom || config.smtpUser, to, subject, text, html });
}

/**
 * Email someone their reset link. The link is built from PUBLIC_URL and never from the request's
 * Host header, which an attacker could forge to get a link pointing at their own site.
 */
export async function sendPasswordResetEmail(to, token) {
  const isProduction = process.env.NODE_ENV === 'production';
  const base = config.publicUrl || (isProduction ? '' : `http://localhost:${process.env.PORT || 3000}`);
  if (!base) {
    console.error('[email] Set PUBLIC_URL so password reset links can be sent.');
    return;
  }
  const link = `${base.replace(/\/+$/, '')}/#/reset?token=${token}`;

  if (!emailConfigured()) {
    // Lets you try the flow on your own machine. A deployed site never logs a working link.
    if (!config.publicUrl && !isProduction) console.log(`[email] SMTP isn't set up. Reset link for local testing: ${link}`);
    else console.error('[email] Password reset requested, but SMTP is not set up.');
    return;
  }

  await sendEmail({
    to,
    subject: 'Reset your MathLens password',
    text: `Someone asked to reset the password for your MathLens account.\n\nChoose a new password here (the link works once, for one hour):\n${link}\n\nIf this wasn't you, ignore this email and your password stays the same.`,
    html: `<p>Someone asked to reset the password for your MathLens account.</p><p><a href="${link}">Choose a new password</a></p><p>The link works once, for one hour. If this wasn't you, ignore this email and your password stays the same.</p>`,
  });
}
