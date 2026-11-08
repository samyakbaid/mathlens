// Makes a consistent copy of the database while the site is running and keeps the last 14 on the
// server. If BACKUP_REPO and BACKUP_AGE_RECIPIENT are set, it also encrypts the copy and pushes it
// to that private repo, keeping the last 30. If anything fails, it emails SUPPORT_EMAIL.
//   node deploy/backup.mjs <database file> <backup folder>
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emailConfigured, sendEmail } from '../server/email.js';

const KEEP_ON_SERVER = 14;
const KEEP_OFF_SERVER = 30;
const MAX_ENCRYPTED_BYTES = 90 * 1024 * 1024; // GitHub refuses files over 100 MB

const [source, folder] = process.argv.slice(2);
const { BACKUP_REPO, BACKUP_AGE_RECIPIENT } = process.env;
const SSH_KEY = process.env.BACKUP_SSH_KEY || '/etc/mathlens-backup/deploy_key';
const KNOWN_HOSTS = process.env.BACKUP_KNOWN_HOSTS || '/etc/mathlens-backup/known_hosts';

function backupOnServer() {
  const target = path.join(folder, `mathlens-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  const db = new DatabaseSync(source, { readOnly: true });
  db.prepare('VACUUM INTO ?').run(target);
  db.close();
  fs.chmodSync(target, 0o600);
  const backups = fs.readdirSync(folder).filter((name) => /^mathlens-.*\.db$/.test(name)).sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_ON_SERVER))) fs.rmSync(path.join(folder, old));
  console.log(`Backed up to ${target}`);
  return target;
}

function pushOffServer(copy) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mathlens-backup-'));
  const env = { ...process.env, GIT_SSH_COMMAND: `ssh -i ${SSH_KEY} -o IdentitiesOnly=yes -o BatchMode=yes -o UserKnownHostsFile=${KNOWN_HOSTS} -o StrictHostKeyChecking=yes` };
  const git = (...args) => execFileSync('git', ['-C', path.join(work, 'repo'), ...args], { env, stdio: 'pipe' });
  try {
    const encrypted = path.join(work, `${path.basename(copy)}.age`);
    execFileSync('age', ['-r', BACKUP_AGE_RECIPIENT, '-o', encrypted, copy], { stdio: 'pipe' });
    if (fs.statSync(encrypted).size > MAX_ENCRYPTED_BYTES) throw new Error('The encrypted backup is too large for GitHub. Move backups to object storage.');

    // Start from what's already in the repo, so a rebuilt server can't wipe older backups
    execFileSync('git', ['clone', '--quiet', '--depth', '1', BACKUP_REPO, path.join(work, 'repo')], { env, stdio: 'pipe' });
    const dir = path.join(work, 'repo', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(encrypted, path.join(dir, path.basename(encrypted)));
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.age')).sort();
    for (const old of files.slice(0, Math.max(0, files.length - KEEP_OFF_SERVER))) fs.rmSync(path.join(dir, old));
    fs.copyFileSync(new URL('./backups-README.md', import.meta.url), path.join(work, 'repo', 'README.md'));

    // One commit replaces the history, so deleted backups really leave the repo
    git('checkout', '--quiet', '--orphan', 'backup-tmp');
    git('add', '-A');
    git('-c', 'user.name=MathLens backup', '-c', 'user.email=backup@mathlens.in', 'commit', '--quiet', '-m', `Backup ${path.basename(encrypted)}`);
    git('branch', '-M', 'main');
    git('push', '--quiet', '--force', 'origin', 'main');
    console.log(`Pushed ${path.basename(encrypted)} off the server`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

try {
  const copy = backupOnServer();
  if (BACKUP_REPO && BACKUP_AGE_RECIPIENT) pushOffServer(copy);
  else console.log('Off-server backup is off: BACKUP_REPO and BACKUP_AGE_RECIPIENT are not set.');
} catch (err) {
  const detail = String(err.stderr || err.message).slice(0, 1500);
  console.error('Backup failed:', detail);
  if (emailConfigured() && process.env.SUPPORT_EMAIL) {
    await sendEmail({
      to: process.env.SUPPORT_EMAIL,
      subject: 'MathLens backup failed',
      text: `Last night's MathLens backup failed.\n\n${detail}\n\nCheck it on the server with: sudo journalctl -u mathlens-backup -n 30`,
    }).catch((mailErr) => console.error('Could not send the alert email:', mailErr.message));
  }
  process.exitCode = 1;
}
