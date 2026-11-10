// How MathLens is being used: accounts, lessons, questions, AI cost and payments.
// Read only. Usage:
//   deploy/stats.sh ubuntu@your-server      (the live site, from your Mac)
//   node deploy/stats.mjs data/mathlens.db  (a local database)

import { DatabaseSync } from 'node:sqlite';

const file = process.argv[2] || '/var/lib/mathlens/mathlens.db';
const db = new DatabaseSync(file, { readOnly: true });
const usdToInr = Number(process.env.USD_TO_INR) || 90;

// Times are stored in UTC. "Today" starts at midnight in India.
const periods = [
  ['Today', "datetime('now', '+330 minutes', 'start of day', '-330 minutes')"],
  ['Last 7 days', "datetime('now', '-7 days')"],
  ['All time', "'0000-01-01'"],
];

const one = (sql) => db.prepare(sql).get();
const rupees = (paise) => `₹${(paise / 100).toFixed(2).replace(/\.00$/, '')}`;

for (const [label, since] of periods) {
  const accounts = one(`SELECT COUNT(*) AS n FROM users WHERE created_at >= ${since}`).n;
  const use = one(`
    SELECT
      SUM(kind = 'lesson') AS lessons,
      SUM(kind = 'followup') AS questions,
      SUM(kind = 'picture') AS pictures,
      SUM(paid_with IN ('free', 'trial')) AS freeChats,
      COUNT(DISTINCT COALESCE('u' || user_id, 'v' || visitor_id)) AS people,
      COALESCE(SUM(cost_usd), 0) AS costUsd,
      COALESCE(SUM(charged_paise), 0) AS chargedPaise
    FROM usage WHERE created_at >= ${since}`);
  const paid = one(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_paise), 0) AS paise FROM payments WHERE status = 'paid' AND paid_at >= ${since}`);
  const aiCostPaise = Math.round(use.costUsd * usdToInr * 100);
  console.log(`\n${label}`);
  console.log(`  ${accounts} new accounts · ${use.people} people used the tutor`);
  console.log(`  ${use.lessons ?? 0} lessons · ${use.questions ?? 0} questions · ${use.pictures ?? 0} picture changes · ${use.freeChats ?? 0} of them free chats`);
  console.log(`  ${paid.n} top-ups worth ${rupees(paid.paise)} · credit spent ${rupees(use.chargedPaise)} · AI cost about ${rupees(aiCostPaise)}`);
}

const recent = db.prepare(`
  SELECT p.paid_at, p.amount_paise, u.email FROM payments p JOIN users u ON u.id = p.user_id
  WHERE p.status = 'paid' ORDER BY p.paid_at DESC LIMIT 5`).all();
console.log('\nLatest payments');
if (!recent.length) console.log('  none yet');
for (const row of recent) console.log(`  ${row.paid_at} UTC  ${rupees(row.amount_paise).padStart(7)}  ${row.email}`);
console.log('');
