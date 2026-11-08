// Plain HTML pages served by the server: about, pricing, contact, terms, privacy, refunds,
// delivery, and payment receipts. They are real pages at real URLs (not #/ routes), so payment
// providers' website checks and search engines can read them without running JavaScript.
//
// Business details come from .env (BUSINESS_NAME, SUPPORT_EMAIL, BUSINESS_ADDRESS, ...).
// Anything not set yet shows up highlighted, so it's easy to spot before going live.

import express from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { identify } from './auth.js';
import { averageChargePaise } from './billing.js';
import { getProvider } from './ai.js';

export const pagesRouter = express.Router();

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** A business detail, or a visible reminder to set it. */
function detail(value, envName) {
  return value ? esc(value) : `<mark class="missing">set ${envName} in .env</mark>`;
}

const rupees = (paise) => {
  const value = paise / 100;
  return `₹${value.toFixed(value >= 100 || Number.isInteger(value) ? 0 : 2)}`;
};

function currentModel() {
  try {
    return getProvider().modelName();
  } catch {
    return '';
  }
}

/** Who writes the lessons, in words for the privacy policy. */
function aiProviderName() {
  const provider = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
  if (provider === 'anthropic') return 'Anthropic';
  const base = process.env.AI_BASE_URL || '';
  if (/openai\.com/.test(base)) return 'OpenAI';
  if (/openrouter\.ai/.test(base)) return 'OpenRouter';
  if (/localhost|127\.0\.0\.1/.test(base)) return null; // a model running on our own server
  return 'our AI model provider';
}

const FOOTER_LINKS = [
  ['/about', 'About'],
  ['/pricing', 'Pricing'],
  ['/contact', 'Contact'],
  ['/terms', 'Terms'],
  ['/privacy', 'Privacy'],
  ['/refunds', 'Refunds'],
  ['/delivery', 'Delivery'],
];

function layout({ title, description = '', body, path = '' }) {
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · MathLens</title>
<meta name="description" content="${esc(description)}">
<script>try { if (localStorage.getItem('mathlens-theme') === 'dark') document.documentElement.dataset.theme = 'dark'; } catch (e) {}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/css/styles.css">
</head>
<body class="static-page">
<header class="topbar">
  <a class="logo" href="/#/" aria-label="MathLens home">
    <svg class="logo-mark" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="8" class="logo-tile"/><circle cx="14" cy="14" r="8" fill="none" class="logo-ring" stroke-width="2.4"/><path d="M8.5 15.5c2-4.5 3.8-4.5 5.5 0s3.5 4.5 5.5 0" fill="none" class="logo-wave" stroke-width="2.2" stroke-linecap="round"/><path d="m20 20 6 6" class="logo-ring" stroke-width="2.8" stroke-linecap="round"/></svg>
    <span class="logo-text">Math<em>Lens</em></span>
  </a>
  <nav class="topnav" aria-label="Main">
    <a href="/#/">Explore</a><a href="/#/graph">Graph Lab</a><a href="/#/ask">Ask</a><a href="/pricing"${path === '/pricing' ? ' class="active"' : ''}>Pricing</a>
  </nav>
  <a class="btn small primary static-cta" href="/#/ask">Open MathLens</a>
</header>
<main class="page legal-page">
${body}
</main>
${footerHtml()}
</body>
</html>`;
}

export function footerHtml() {
  return `<footer class="site-footer">
  <nav aria-label="Policies">${FOOTER_LINKS.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</nav>
  <p>MathLens is run by ${config.businessName ? esc(config.businessName) : 'its owner'}${config.supportEmail ? ` · <a href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a>` : ''}</p>
</footer>`;
}

function updated() {
  return `<p class="legal-updated">Last updated ${esc(config.policyUpdated)}</p>`;
}

// ---- About ---------------------------------------------------------------------------------
pagesRouter.get('/about', (req, res) => {
  res.send(layout({
    title: 'About',
    path: '/about',
    description: 'MathLens teaches math in small steps, with pictures that move as you go.',
    body: `
<p class="kicker">About</p>
<h1>Learn math by watching it happen.</h1>
<p class="lede">MathLens teaches one small step at a time, and the picture changes with every step. You see why an idea works before you have to remember the formula.</p>
<div class="legal">
<h2>What's here</h2>
<p>Free lessons on calculus, linear algebra, Fourier series and probability, each with a visual you can drag and play with. Graph Lab, a free graphing calculator for 2D and 3D. And the tutor, which writes a step-by-step lesson with its own visualization for any question you ask, or for a paper you upload.</p>
<h2>Who it's for</h2>
<p>Students who want to understand a topic instead of memorising it, people going back over math they half remember, and anyone reading a paper full of equations they'd like to see in motion.</p>
<h2>Who runs it</h2>
<p>MathLens is run by ${detail(config.businessName, 'BUSINESS_NAME')}${config.businessCity ? ` in ${esc(config.businessCity)}` : ''}. Questions, ideas and bug reports are welcome at ${config.supportEmail ? `<a href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a>` : detail('', 'SUPPORT_EMAIL')}.</p>
</div>`,
  }));
});

// ---- Pricing -------------------------------------------------------------------------------
pagesRouter.get('/pricing', (req, res) => {
  const average = averageChargePaise(currentModel());
  const lessonsFor = (paise) => Math.max(1, Math.floor(paise / average));
  const rows = [10, 20, 50, 100]
    .filter((r) => r >= config.minTopupRupees)
    .map((r) => `<tr><td>₹${r}</td><td>about ${lessonsFor(r * 100)} lessons</td></tr>`)
    .join('');
  res.send(layout({
    title: 'Pricing',
    path: '/pricing',
    description: `The lessons and Graph Lab are free. Tutor lessons cost about ${rupees(average)} each after your free ones.`,
    body: `
<p class="kicker">Pricing</p>
<h1>Free to start. <em>About ${rupees(average)} a lesson after that.</em></h1>
<p class="lede">The built-in lessons and Graph Lab are free for everyone. You only pay for the tutor, and only for the lessons you ask for.</p>
<div class="price-cards">
  <div class="price-card"><span class="price-label">Try it</span><strong>${config.trialAnswers} free</strong><p>tutor lessons without an account.</p></div>
  <div class="price-card"><span class="price-label">Sign up</span><strong>${config.freeAnswersAfterSignup} more free</strong><p>when you make a free account with Google or email.</p></div>
  <div class="price-card highlight"><span class="price-label">After that</span><strong>${rupees(average)} a lesson</strong><p>on average. Top up any amount from ₹${config.minTopupRupees}.</p></div>
</div>
<div class="legal">
<h2>What your money buys</h2>
<table class="price-table"><thead><tr><th>Top up</th><th>At today's average</th></tr></thead><tbody>${rows}</tbody></table>
<p>₹20 is about the price of a cup of chai, and it covers about ${lessonsFor(2000)} lessons.</p>
<h2>How the price is worked out</h2>
<p>Each lesson costs what the AI charges us to write it${config.markup ? `, plus ${Math.round(config.markup * 100)}% to cover the payment fee` : ''}. A short lesson costs less than the average and a long one with a 3D picture costs a little more. The average above updates as people use MathLens.</p>
<h2>Good to know</h2>
<ul>
<li>There's no subscription, and nothing renews by itself.</li>
<li>Your credit doesn't expire.</li>
<li>Every lesson is saved in your notebook. Reopening it, or asking the exact same question again, is free.</li>
<li>A lesson that fails is never charged.</li>
<li>You pay through Razorpay with UPI, cards or net banking. Prices are in Indian rupees.</li>
<li>Unused credit can be refunded within ${config.refundDays} days of buying it. See the <a href="/refunds">refund policy</a>.</li>
</ul>
</div>`,
  }));
});

// ---- Contact -------------------------------------------------------------------------------
pagesRouter.get('/contact', (req, res) => {
  res.send(layout({
    title: 'Contact us',
    path: '/contact',
    description: 'How to reach the people who run MathLens.',
    body: `
<p class="kicker">Contact</p>
<h1>Get in touch</h1>
<p class="lede">Email is the quickest way to reach us. If your message is about a payment, include the email you use on MathLens and the order ID from your receipt.</p>
<div class="legal">
<dl class="contact-list">
  <dt>Run by</dt><dd>${detail(config.businessName, 'BUSINESS_NAME')}</dd>
  <dt>Email</dt><dd>${config.supportEmail ? `<a href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a>` : detail('', 'SUPPORT_EMAIL')}</dd>
  ${config.businessPhone ? `<dt>Phone</dt><dd><a href="tel:${esc(config.businessPhone.replace(/\s+/g, ''))}">${esc(config.businessPhone)}</a></dd>` : ''}
  <dt>Address</dt><dd>${detail(config.businessAddress, 'BUSINESS_ADDRESS')}</dd>
</dl>
<p>If something went wrong with a payment, please write to us before raising a dispute with your bank. We'll look into it and put it right.</p>
</div>`,
  }));
});

// ---- Terms ---------------------------------------------------------------------------------
pagesRouter.get('/terms', (req, res) => {
  const name = detail(config.businessName, 'BUSINESS_NAME');
  res.send(layout({
    title: 'Terms and conditions',
    path: '/terms',
    description: 'The rules for using MathLens.',
    body: `
<p class="kicker">Terms</p>
<h1>Terms and conditions</h1>
${updated()}
<div class="legal">
<h2>1. Who we are</h2>
<p>MathLens ("we", "us") is run by ${name}${config.businessAddress ? `, ${esc(config.businessAddress)}` : ''}. By using the website you agree to these terms. If you don't agree with them, please don't use MathLens.</p>
<h2>2. Your account</h2>
<p>You need a free account to keep using the tutor after the free tries. Keep your password to yourself, because you're responsible for what happens in your account. Each account is for one person. We may suspend accounts that are used to collect free credit unfairly or to misuse the service.</p>
<h2>3. Credit and payments</h2>
<p>Tutor lessons are paid for with prepaid credit, which you buy through our payment partner, Razorpay. Each lesson is charged at its actual cost, as described on the <a href="/pricing">pricing page</a>, and a lesson that fails isn't charged. Credit has no cash value outside MathLens, can't be transferred to another person and doesn't expire. Free lessons and sign-up credit are a gift and may change over time.</p>
<h2>4. Lessons are written by AI</h2>
<p>The tutor's lessons are written by an AI model. They're usually right, but they can contain mistakes. Check important results yourself, especially for exams, assignments or work, and don't use MathLens as the basis for medical, legal or financial decisions.</p>
<h2>5. What you send us</h2>
<p>Your questions and the documents you upload stay yours. Only upload material you have the right to share. We use it to write your lesson, as explained in the <a href="/privacy">privacy policy</a>. Please don't use MathLens to break the law, to harass anyone, or to overload or attack the service.</p>
<h2>6. Our content</h2>
<p>The built-in lessons, the design and the code of MathLens belong to ${name}. You're welcome to use lessons for your own learning and to share links to them.</p>
<h2>7. Changes</h2>
<p>We may change features, prices or these terms. A new price only applies to lessons asked after the change, and credit you've already bought keeps its rupee value. If we change these terms in an important way, we'll update the date at the top of this page. MathLens may sometimes be unavailable, for example during maintenance.</p>
<h2>8. Liability</h2>
<p>MathLens is provided as it is. As far as the law allows, our total liability to you for any claim is limited to the amount you paid us in the three months before the claim.</p>
<h2>9. Law</h2>
<p>These terms are governed by the laws of India${config.businessCity ? `, and any dispute will be handled by the courts in ${esc(config.businessCity)}` : ''}.</p>
<h2>10. Contact</h2>
<p>Questions about these terms: ${config.supportEmail ? `<a href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a>` : detail('', 'SUPPORT_EMAIL')}.</p>
</div>`,
  }));
});

// ---- Privacy -------------------------------------------------------------------------------
pagesRouter.get('/privacy', (req, res) => {
  const provider = aiProviderName();
  res.send(layout({
    title: 'Privacy policy',
    path: '/privacy',
    description: 'What MathLens collects, why, and who it is shared with.',
    body: `
<p class="kicker">Privacy</p>
<h1>Privacy policy</h1>
${updated()}
<p class="lede">We collect what we need to run MathLens and nothing else. We don't sell your data and we don't show ads.</p>
<div class="legal">
<h2>What we collect</h2>
<ul>
<li><strong>Your account.</strong> Your email address and, if you give it, your name. If you sign up with email, your password is stored only as a scrambled one-way hash. If you sign in with Google, we receive your Google account ID, email address and name from Google.</li>
<li><strong>Your lessons.</strong> The questions you ask and the lessons the tutor writes, so they can be saved in your notebook.</li>
<li><strong>Documents you upload.</strong> Your browser reads the text out of the file; the file itself never leaves your device. The text is sent along with your question to write the lesson. We keep the lesson and a short fingerprint of the text (so we can recognise the same document again), not the text itself.</li>
<li><strong>Payments.</strong> The amount and Razorpay's order and payment IDs. Your card, UPI and bank details go straight to Razorpay; we never see them.</li>
<li><strong>Usage.</strong> For each lesson, how much it cost to make, and the IP address it came from. We use the IP address to stop people collecting free lessons unfairly.</li>
<li><strong>Cookies and browser storage.</strong> A cookie that keeps you logged in, and a cookie that counts free tries before you sign up. Your browser also remembers your light or dark theme and which lessons you've opened. We don't use advertising or tracking cookies.</li>
</ul>
<h2>Who else sees it</h2>
<ul>
<li>${provider ? `<strong>${esc(provider)}</strong>, the company whose AI model writes the lessons, receives your question and any document text in order to write the lesson.` : 'The AI model that writes the lessons runs on our own server, so your questions and documents are not sent to an outside AI company.'}</li>
<li><strong>Razorpay</strong> processes payments.</li>
<li><strong>Google</strong>, if you choose to sign in with Google.</li>
<li><strong>Our email provider</strong> receives your email address if you ask for a password reset link.</li>
<li>The pages load fonts from Google Fonts and code libraries from jsDelivr. Like any website you visit, they can see your IP address.</li>
</ul>
<h2>How long we keep it</h2>
<p>Your account and saved lessons stay until you delete them. You can delete any lesson from your notebook yourself. Payment records are kept for as long as the law requires.</p>
<h2>Your choices</h2>
<p>To get a copy of your data or to delete your account, email ${config.supportEmail ? `<a href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a>` : detail('', 'SUPPORT_EMAIL')} from the address on your account.</p>
<h2>Young learners</h2>
<p>If you're under 18, please use MathLens with a parent's or guardian's permission.</p>
<h2>Keeping it safe</h2>
<p>Passwords are hashed, login cookies can't be read by scripts on the page, and the site is served over an encrypted connection.</p>
<h2>Changes</h2>
<p>If we change what we collect or who we share it with, we'll update this page and the date at the top.</p>
</div>`,
  }));
});

// ---- Refunds -------------------------------------------------------------------------------
pagesRouter.get('/refunds', (req, res) => {
  const email = config.supportEmail ? `<a href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a>` : detail('', 'SUPPORT_EMAIL');
  res.send(layout({
    title: 'Refund and cancellation policy',
    path: '/refunds',
    description: 'When and how you can get your money back.',
    body: `
<p class="kicker">Refunds</p>
<h1>Refund and cancellation policy</h1>
${updated()}
<div class="legal">
<h2>Unused credit</h2>
<p>Changed your mind? Write to us within ${config.refundDays} days of buying credit and we'll refund the part you haven't used, in full.</p>
<h2>Failed or double payments</h2>
<p>If money left your account but no credit arrived, or you were charged twice, we'll refund it in full. Razorpay often returns failed payments on its own.</p>
<h2>Credit you've already used</h2>
<p>Credit spent on lessons can't be refunded, because the AI has already been paid to write those lessons. A lesson that fails is never charged in the first place. If a lesson came out broken or unusable, tell us and we'll add that credit back.</p>
<h2>Free lessons</h2>
<p>Free tries and sign-up lessons have no cash value and can't be exchanged for money.</p>
<h2>Cancellation</h2>
<p>There's no subscription, so there's nothing to cancel and nothing will be charged again. To close your account, email us.</p>
<h2>How to ask for a refund</h2>
<p>Email ${email} with the email address on your account and the order ID from your <a href="/receipts">receipt</a>. Approved refunds go back to the way you paid, through Razorpay, usually within 5 to 7 working days.</p>
</div>`,
  }));
});

// ---- Delivery ------------------------------------------------------------------------------
pagesRouter.get(['/delivery', '/shipping'], (req, res) => {
  res.send(layout({
    title: 'Delivery policy',
    path: '/delivery',
    description: 'How MathLens credit is delivered.',
    body: `
<p class="kicker">Delivery</p>
<h1>Shipping and delivery</h1>
${updated()}
<div class="legal">
<p>MathLens sells digital credit for the tutor, so nothing is shipped. Credit appears in your account as soon as your payment goes through, usually within a minute, and you can use it right away.</p>
<p>If your credit hasn't appeared 30 minutes after paying, email ${config.supportEmail ? `<a href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a>` : detail('', 'SUPPORT_EMAIL')} with your order ID and we'll add it.</p>
</div>`,
  }));
});

// ---- Receipts ------------------------------------------------------------------------------
function receiptHtml({ payment, user, sample = false }) {
  const isInvoice = Boolean(config.businessGstin);
  const paidAt = new Date(`${String(payment.paid_at ?? payment.created_at).replace(' ', 'T')}Z`);
  const date = Number.isNaN(paidAt.getTime()) ? '' : paidAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  return `
${sample ? '<p class="sample-banner">Sample receipt. This is what customers receive after a payment.</p>' : ''}
<article class="receipt">
  <header class="receipt-head">
    <div><p class="kicker">${isInvoice ? 'Tax invoice' : 'Receipt'}</p><h1>MathLens</h1></div>
    <div class="receipt-meta"><span>Receipt no.</span><strong>${esc(payment.razorpay_payment_id || payment.razorpay_order_id)}</strong><span>${esc(date)} IST</span></div>
  </header>
  <div class="receipt-parties">
    <div><span class="receipt-label">From</span><strong>${detail(config.businessName, 'BUSINESS_NAME')}</strong><span>${detail(config.businessAddress, 'BUSINESS_ADDRESS')}</span><span>${config.supportEmail ? esc(config.supportEmail) : detail('', 'SUPPORT_EMAIL')}</span>${isInvoice ? `<span>GSTIN ${esc(config.businessGstin)}</span>` : ''}</div>
    <div><span class="receipt-label">Billed to</span><strong>${esc(user.name || user.email)}</strong><span>${esc(user.email)}</span></div>
  </div>
  <table class="receipt-table">
    <thead><tr><th>Description</th><th>Amount</th></tr></thead>
    <tbody><tr><td>MathLens tutor credit (prepaid, digital)</td><td>${rupees(payment.amount_paise)}</td></tr></tbody>
    <tfoot><tr><td>Total paid</td><td>${rupees(payment.amount_paise)}</td></tr></tfoot>
  </table>
  <dl class="receipt-details">
    <dt>Paid with</dt><dd>Razorpay</dd>
    <dt>Order ID</dt><dd>${esc(payment.razorpay_order_id)}</dd>
    ${payment.razorpay_payment_id ? `<dt>Payment ID</dt><dd>${esc(payment.razorpay_payment_id)}</dd>` : ''}
    <dt>Status</dt><dd>Paid. The credit was added to the account at the time of payment.</dd>
  </dl>
  <p class="receipt-note">Questions about this payment: ${config.supportEmail ? esc(config.supportEmail) : detail('', 'SUPPORT_EMAIL')}. Refunds follow the policy at /refunds.</p>
  <button class="btn small no-print" type="button" onclick="window.print()">Print or save as PDF</button>
</article>`;
}

pagesRouter.get('/receipt/sample', (req, res) => {
  const payment = { razorpay_order_id: 'order_SAMPLE00001', razorpay_payment_id: 'pay_SAMPLE00001', amount_paise: 5000, paid_at: new Date().toISOString().slice(0, 19).replace('T', ' ') };
  res.send(layout({ title: 'Sample receipt', body: receiptHtml({ payment, user: { name: 'Sample Customer', email: 'customer@example.com' }, sample: true }) }));
});

pagesRouter.get('/receipts', identify, (req, res) => {
  if (!req.user) {
    return res.send(layout({ title: 'Receipts', body: '<p class="kicker">Receipts</p><h1>Log in to see your receipts</h1><p class="lede"><a href="/#/">Open MathLens</a> and log in, then come back to this page.</p>' }));
  }
  const payments = db.prepare("SELECT * FROM payments WHERE user_id = ? AND status = 'paid' ORDER BY id DESC").all(req.user.id);
  const list = payments.length
    ? `<ul class="receipt-list">${payments.map((p) => `<li><a href="/receipt/${encodeURIComponent(p.razorpay_order_id)}">${rupees(p.amount_paise)} on ${esc(String(p.paid_at ?? p.created_at).slice(0, 10))}</a><span>${esc(p.razorpay_order_id)}</span></li>`).join('')}</ul>`
    : '<p class="muted">No payments yet.</p>';
  res.send(layout({ title: 'Receipts', body: `<p class="kicker">Receipts</p><h1>Your receipts</h1>${list}` }));
});

pagesRouter.get('/receipt/:orderId', identify, (req, res) => {
  if (!req.user) return res.redirect('/receipts');
  const payment = db.prepare("SELECT * FROM payments WHERE razorpay_order_id = ? AND user_id = ? AND status = 'paid'").get(req.params.orderId, req.user.id);
  if (!payment) return res.status(404).send(layout({ title: 'Receipt not found', body: '<h1>Receipt not found</h1><p class="lede">This receipt is not in your account. <a href="/receipts">See your receipts</a>.</p>' }));
  res.send(layout({ title: 'Receipt', body: receiptHtml({ payment, user: req.user }) }));
});

/** Business details that still need filling in (for a reminder when the server starts). */
export function missingBusinessDetails() {
  return [
    ['BUSINESS_NAME', config.businessName],
    ['SUPPORT_EMAIL', config.supportEmail],
    ['BUSINESS_ADDRESS', config.businessAddress],
  ].filter(([, value]) => !value).map(([name]) => name);
}
