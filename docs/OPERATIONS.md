# MathLens: running the live site

Accounts and limits, payments, policy pages, hosting, backups and monitoring. For how the code works, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Accounts, free limits and credits

Only **Ask AI** costs money to run, so only it is limited. Built-in topics and Graph Lab stay free and need no account.

1. **Sign up** (email + password, or Google): 5 free chats. Nobody gets a free chat without an account (`TRIAL_ANSWERS` is 0). Sign-up doesn't check that an email address is real, so the site-wide limit below is what stops fake accounts from running up the bill. Up to 1,000 new accounts per network per day get them, high enough for a whole campus on one shared address. All free chats together are limited to 200 a day across the site (`FREE_CHATS_SITE_PER_DAY`), about ₹100 a day at normal lesson sizes. When they run out, people who have bought credit carry on, and everyone else's free chats wait until the next day.
2. **Credits:** after that, people top up any amount from ₹10 with Razorpay (UPI, cards, netbanking). Each answer is charged at **its real AI cost** (tokens × the model's price, converted to ₹) plus 3% to cover Razorpay's fee. A chat is a new lesson, a change to a picture, or a set of `QUESTIONS_PER_CHAT` (4) follow-up questions. The first `FREE_QUESTIONS_PER_DAY` (4) questions a day are free. A set of questions is charged the average chat price, not its real cost. With gpt-6-luna on medium reasoning effort a new lesson costs about ₹0.50, so ₹10 ≈ 20 chats. Prices are quoted at the lesson price. The top-up dialog shows the live average.

Failed answers are never charged, and only one question per account runs at a time. All limits and prices are in `.env.example`.

**Turn on payments:** create a Razorpay account, switch to Test Mode, copy the API keys into `.env` as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`, and restart. Test payments use Razorpay's test cards/UPI and no real money moves. For live mode Razorpay needs your KYC and website policy pages (terms, privacy, refunds, contact). Optionally add a webhook (events `payment.captured`, `order.paid`) pointing to `https://<your-site>/api/payments/webhook` and set `RAZORPAY_WEBHOOK_SECRET`, so a payment still counts if the buyer closes the tab early.

**Turn on Google sign-in:** in Google Cloud Console create an OAuth client ID of type *Web application*, add `http://localhost:3000` and `http://localhost` (and later your real domain) under *Authorized JavaScript origins*, then set `GOOGLE_CLIENT_ID` in `.env` and restart. Only the client ID is used. The client secret isn't needed, so keep it out of MathLens.

## Policy pages and receipts

Razorpay checks these pages before it approves a live account, so they're plain server-rendered pages that load without JavaScript:

| Page | What it says |
| --- | --- |
| `/about` | what MathLens is and who runs it |
| `/pricing` | free limits, the live average price per lesson, what each top-up buys |
| `/contact` | support email, phone, address |
| `/terms` | terms and conditions |
| `/privacy` | what is stored, who it's shared with (AI provider, Razorpay, Google) |
| `/refunds` | cancellation and refund policy |
| `/delivery` (also `/shipping`) | credit is digital and added straight away |
| `/receipt/sample` | a sample receipt (print it to PDF if Razorpay asks for a sample invoice) |
| `/receipts` | a signed-in person's payments, each with a printable receipt |

Fill in your details in `.env`: `BUSINESS_NAME` (your name or company, as on your Razorpay KYC), `SUPPORT_EMAIL` and `BUSINESS_ADDRESS` are needed. `BUSINESS_PHONE`, `BUSINESS_CITY`, and `BUSINESS_GSTIN` (receipts become tax invoices) are optional. Until they're set, the pages show a red "set X in .env" marker and the server prints a reminder at startup. The policy text is a starting point. Read it and change `server/pages.js` to match how you actually run things; it isn't legal advice.

**Turn on password reset:** set `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` in `.env` (see `.env.example`), plus `PUBLIC_URL` once deployed. Links work once, for one hour, and using one logs the account out everywhere else. Without SMTP on your own machine, the link is printed in the server log so you can test it.

**Data:** everything is stored in `data/mathlens.db` (git-ignored). Passwords are hashed with scrypt; session cookies are HttpOnly. Back this file up once real people pay.

## Deploying on an Oracle Always Free server

The site runs on one Ubuntu server, with Cloudflare Tunnel in front. Visitors reach it through Cloudflare, so the server needs no open web ports and HTTPS is handled for you.

**Server:** the Always Free `VM.Standard.E2.1.Micro` (1 GB memory) in Mumbai, because Ampere A1 was out of capacity there. Oracle treats a Micro as idle if CPU and network use stay under 20% for 7 days, which a quiet site can do. Check the server still runs now and then, and start it again if Oracle has stopped it. The setup script also works on A1 if you move later.

- `deploy/deploy.sh ubuntu@SERVER_IP https://your.site` sets up the server, uploads `.env` with the live settings, and starts the site. Use it again whenever `.env` changes.
- `deploy/deploy.sh ubuntu@SERVER_IP` sends the latest commit and restarts.
- The database is at `/var/lib/mathlens`. See "Backups" below.
- The tunnel gives up on a request after about 125 seconds. If a very long lesson hits that, asking again joins the same answer or opens the saved lesson without another charge.

## Backups

Every day the server copies the database, keeps the last 14 copies in `/var/backups/mathlens`, encrypts the new copy and pushes it to the private repo `samyakbaid/mathlens-backups`, which keeps the last 30. If a backup fails, the server emails `SUPPORT_EMAIL`.

**The key:** backups can only be opened with `~/.config/mathlens/backup-key.txt` on your Mac. Keep a second copy in a password manager. Without it, every backup is unreadable. The server only holds the public half, so a hacked server can't read old backups.

**Run a backup now:**
```
ssh ubuntu@SERVER_IP 'sudo systemctl start mathlens-backup && sudo journalctl -u mathlens-backup -n 5 --no-pager'
```

**Get a copy back on your Mac** (doesn't touch the live site):
```
deploy/restore-backup.sh
```
It decrypts the newest backup to `~/mathlens-restore/mathlens.db` and prints the integrity check and counts. To pick an older one, pass its file name from the `backups/` folder on GitHub. Delete the file when you're done, because it holds customer data.

**Put a backup on the live site** (only after real data loss, because anything newer than the backup is lost):
```
scp ~/mathlens-restore/mathlens.db ubuntu@SERVER_IP:/tmp/restore.db
ssh ubuntu@SERVER_IP
sudo systemctl stop mathlens
sudo mv /var/lib/mathlens/mathlens.db /var/lib/mathlens/mathlens.db.before-restore
sudo rm -f /var/lib/mathlens/mathlens.db-wal /var/lib/mathlens/mathlens.db-shm
sudo install -o mathlens -g mathlens -m 600 /tmp/restore.db /var/lib/mathlens/mathlens.db
rm /tmp/restore.db
sudo systemctl start mathlens
```

## Checking how it is used

`deploy/stats.sh ubuntu@SERVER_IP` prints new accounts, lessons, questions, free chats, top-ups, credit spent and AI cost for today (India time), the last 7 days and all time, plus the latest payments. It only reads the database.

If the AI account runs out of credit, students see "The tutor is taking a short break" and the server emails `SUPPORT_EMAIL` (at most once every 6 hours).
