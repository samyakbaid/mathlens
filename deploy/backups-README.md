# MathLens backups

Encrypted daily copies of the MathLens database, pushed automatically by the server. The last 30 are kept in `backups/`. GitHub and the server can't read them; only the private key can.

**The private key is at `~/.config/mathlens/backup-key.txt` on the owner's Mac. It is not in this repo, and without it these backups can't be opened.** Keep a second copy in a password manager.

Full steps are in the MathLens repo's README, under "Backups". The short version, from the `mathlens` folder on the Mac:

```
deploy/restore-backup.sh
```

That downloads the newest backup, decrypts it to `~/mathlens-restore/` and checks it. It doesn't change the live site.
