// Top-ups with Razorpay (₹, UPI / cards / netbanking).
//
// Flow:
//   1. Browser: POST /api/payments/order { amountRupees }  → we create a Razorpay order for that amount
//   2. Browser opens Razorpay Checkout with the order id; the user pays
//   3. Browser: POST /api/payments/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//      → we check the signature with our secret and add the order's amount to the balance
//   4. (Optional) Razorpay calls POST /api/payments/webhook, in case the browser closed before step 3
//
// The amount credited always comes from our own order record, never from the browser.
// Crediting is idempotent: steps 3 and 4 can both arrive and the money is added once.

import crypto from 'node:crypto';
import express from 'express';
import { db, transaction } from './db.js';
import { config } from './config.js';
import { publicUser } from './auth.js';

export const paymentsRouter = express.Router();

export function paymentsEnabled() {
  return Boolean(config.razorpayKeyId && config.razorpayKeySecret);
}

function hmacHex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/** Mark an order paid and add its amount to the user's balance (only once). */
function creditOrder(orderId, paymentId) {
  return transaction(() => {
    const payment = db.prepare('SELECT * FROM payments WHERE razorpay_order_id = ?').get(orderId);
    if (!payment) return null;
    if (payment.status !== 'paid') {
      db.prepare("UPDATE payments SET status = 'paid', razorpay_payment_id = ?, paid_at = datetime('now') WHERE id = ?").run(paymentId, payment.id);
      db.prepare('UPDATE users SET balance_paise = balance_paise + ? WHERE id = ?').run(payment.amount_paise, payment.user_id);
      console.log(`[payments] order ${orderId} paid: +₹${(payment.amount_paise / 100).toFixed(2)} for user ${payment.user_id}`);
    }
    return payment;
  });
}

paymentsRouter.post('/order', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Please log in first.', code: 'login_required' });
  if (!paymentsEnabled()) return res.status(503).json({ error: 'Payments are not set up on this server yet.' });

  const rupees = Math.round(Number(req.body?.amountRupees));
  if (!Number.isFinite(rupees) || rupees < config.minTopupRupees || rupees > config.maxTopupRupees) {
    return res.status(400).json({ error: `Choose an amount between ₹${config.minTopupRupees} and ₹${config.maxTopupRupees}.` });
  }
  const amountPaise = rupees * 100;

  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt: `u${req.user.id}-${Date.now()}`,
      notes: { user_id: String(req.user.id), purpose: 'MathLens credits' },
    }),
  }).catch(() => null);

  if (!response?.ok) {
    console.error('[payments] Razorpay order failed:', response?.status, await response?.text().catch(() => ''));
    return res.status(502).json({ error: 'Could not start the payment. Please try again.' });
  }
  const order = await response.json();
  db.prepare('INSERT INTO payments (user_id, razorpay_order_id, amount_paise) VALUES (?, ?, ?)').run(req.user.id, order.id, amountPaise);

  res.json({ orderId: order.id, amountPaise, keyId: config.razorpayKeyId, email: req.user.email, name: req.user.name ?? '' });
});

paymentsRouter.post('/verify', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Please log in first.', code: 'login_required' });
  const orderId = String(req.body?.razorpay_order_id ?? '');
  const paymentId = String(req.body?.razorpay_payment_id ?? '');
  const signature = String(req.body?.razorpay_signature ?? '');

  const payment = db.prepare('SELECT * FROM payments WHERE razorpay_order_id = ? AND user_id = ?').get(orderId, req.user.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  if (!safeEqualHex(hmacHex(config.razorpayKeySecret, `${orderId}|${paymentId}`), signature)) {
    return res.status(400).json({ error: 'Payment could not be verified. If money was taken, it will be refunded by Razorpay or credited shortly.' });
  }

  creditOrder(orderId, paymentId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user), creditedPaise: payment.amount_paise });
});

/** Razorpay webhook (set it up in the Razorpay dashboard for the events payment.captured and order.paid). */
export function handleWebhook(req, res) {
  if (!config.razorpayWebhookSecret) return res.status(404).end();
  const signature = req.headers['x-razorpay-signature'];
  const raw = req.body; // a Buffer (express.raw)
  if (!Buffer.isBuffer(raw) || !safeEqualHex(hmacHex(config.razorpayWebhookSecret, raw), signature)) {
    return res.status(400).json({ error: 'bad signature' });
  }
  let event;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    return res.status(400).end();
  }
  const entity = event.payload?.payment?.entity;
  if ((event.event === 'payment.captured' || event.event === 'order.paid') && entity?.order_id) {
    creditOrder(entity.order_id, entity.id);
  }
  res.json({ ok: true });
}
