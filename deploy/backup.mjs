// Makes a consistent copy of the database while the site is running, and keeps the last 14.
//   node deploy/backup.mjs <database file> <backup folder>
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const [source, folder] = process.argv.slice(2);
const KEEP = 14;
const target = path.join(folder, `mathlens-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);

const db = new DatabaseSync(source, { readOnly: true });
db.prepare('VACUUM INTO ?').run(target);
db.close();
fs.chmodSync(target, 0o600);

const backups = fs.readdirSync(folder).filter((name) => /^mathlens-.*\.db$/.test(name)).sort();
for (const old of backups.slice(0, Math.max(0, backups.length - KEEP))) fs.rmSync(path.join(folder, old));
console.log(`Backed up to ${target}`);
