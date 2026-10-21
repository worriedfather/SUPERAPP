# Moving DA OPS production from the laptop to the Liquid Zimbabwe server

Written 2026-10-20 from an inventory of the laptop that is production today.

## What production is today (laptop `C:\DA-Bot`)

| Component | How it runs now | Moves? |
|---|---|---|
| DA OPS API `dafuel/server/index.js` on 127.0.0.1:4000 | SYSTEM task "DA OPS API" → `start-da-api.bat` loop + "DA OPS Watchdog" every minute | yes |
| Staging API on 127.0.0.1:4001 | SYSTEM tasks "DA OPS Staging API" + watchdog | yes (same tunnel) |
| PostgreSQL 18.4, databases `dafuel` (1.2 GB, 83 tables) and `da_bots` (truck status, bot history) | Windows service | yes |
| Cloudflare tunnel `dafuel-hq` → fuel.dasuperapp.com, staging.dasuperapp.com | service "Cloudflared (DA Fuel)", creds in `.cloudflared\` | yes, same tunnel |
| Hourly DB backup → OneDrive `DA-OPS-Backups\dumps` (+ protected daily) | task "DA OPS DB Backup" | yes |
| Backup verify, DB maintain, Whiteslip daily/evening importers | tasks | yes |
| Email day-end bot (`DA email bot\bot.js`) | Startup-folder `.bat` (needs a logged-in user) | yes, as a task |
| Truck-status WhatsApp bot (Baileys) | `tools\start-truck-status-bot.bat` window | yes, QR re-link likely |
| Wi-Fi failover tasks | 2 tasks | no, delete |
| Android/iOS builds, Claude sessions | Android Studio, this repo | stay on laptop |
| OneDrive input folders: `DA Finance\Whiteslips`, `DA Site Analytics` workbooks, Costing/Card_Balances drops | OneDrive sync under `C:\Users\tinas` | server must sync the same account |
| FileMaker (retail + DA Card) | remote FileMaker Server, public host | nothing to move |

Node v24.15.0. Repo `dafuel` has the SUPERAPP remote; `server/` is a local git with NO remote.
Files with the laptop's user path hard-coded: `agents/backup-verify.mjs`, `agents/ops-brief.mjs`,
`da-whiteslip-daily.bat`, `import/load-whiteslips.mjs`, `sync-bots.js`, `import-dayend.mjs`,
`import-pump-sales.mjs`, `backfill-whiteslips*.mjs`, `import/load-history.mjs`, `import/inspect.mjs`,
`import/load-trip-history-gaps.mjs`. Most read an env override first (`WS_ROOT`, `BACKUP_DIR`, `CHECKPOINT_DIR`).

## Decision: Windows Server, not Linux

Everything above is Task Scheduler, `.bat`, PowerShell, OneDrive and a Windows PostgreSQL service.
On Windows Server 2022 it moves file-for-file in a day. On Linux every supervisor, watchdog, importer
schedule and the OneDrive file drop has to be rebuilt (a week, and a new set of first-month bugs).
If Liquid only offers Linux, say so and the plan changes to: systemd units, rclone for OneDrive, and
a rewrite of the 12 scripts above.

Ask Liquid for: Windows Server 2022, 4 vCPU, 8 GB RAM, 120 GB SSD, static public IP, Africa/Harare
timezone, outbound 443 open, inbound closed except RDP/SSH from the office IP. Liquid's data centre
gives the UPS and generator the laptop never had.

## Phase 0: access and accounts (owner)

1. RDP credentials from Liquid. You enter them; I never do.
2. On the server enable the built-in OpenSSH Server feature and add a key I generate on the laptop.
   That is how deploys and checks reach the server afterwards (`ssh da-server <command>`).
   Nothing else is exposed: Postgres stays on 127.0.0.1, the API stays behind the tunnel.
3. Sign in to OneDrive on the server with the DA account that owns `DA Finance` and `DA-OPS-Backups`,
   and let the three folders sync (Whiteslips, DA Site Analytics, DA-OPS-Backups). Owner's sign-in.
4. Give the `server/` repo a remote now: a private GitHub repo in the company's org, so the server
   pulls code instead of receiving copies. I can create it from here with `gh` once you confirm the org.

## Phase 1: build the box (no downtime, 1 day)

Scripted as `tools/liquid-setup.ps1` (to write once the OS is confirmed). It does, in order:

1. Install Node 24.x LTS, Git, PostgreSQL 18.x (same major), cloudflared, Python 3 + ReportLab.
2. `git clone` dafuel and server into `C:\DA-Bot`, `npm ci` in both, `npm run build` the client.
3. Copy secrets by hand (never through git): `server/.env`, `server/.env.staging`, `C:\DA-Bot\secrets`,
   `tools/pgpass.conf`, the cloudflared `config.yml` + tunnel credentials json + `cert.pem`,
   the email bot `.env`, the truck bot's `data/baileys_auth`.
4. Fix the paths: create the same Windows user name so `C:\Users\tinas\OneDrive\...` resolves, or
   set `WS_ROOT`, `BACKUP_DIR`, `CHECKPOINT_DIR` in `.env` and edit `da-whiteslip-daily.bat`.
   Same-user-name is the smaller change and keeps every script identical.
5. Restore the database from yesterday's dump (`pg_restore -Fc`), recreate roles from `db/roles.sql`
   with the CURRENT passwords, restore `da_bots` too. Run `da_verify_chain()` and compare row counts.
6. Turn on WAL archiving to `DA-OPS-Backups\wal` before the first start. It is staged in the laptop's
   `postgresql.auto.conf` but never activated; on the new box it costs nothing.
7. Register the tasks with the existing scripts: `register-api-tasks.ps1`, `register-staging-system.ps1`,
   backup, backup-verify, db-maintain, whiteslip daily + evening, email bot and truck bot as
   ONSTART SYSTEM tasks. Clear the battery flags out of habit. Do NOT register the Wi-Fi failover.
8. Start the API on the server with the tunnel still on the laptop. Check `/api/health?deep=1` on
   localhost, run `npm test`, run every importer once, sign in on a browser through an SSH port
   forward. The server is now a warm standby with yesterday's data.

## Phase 2: cutover (one evening, about 15 minutes of API downtime)

Pick 22:00 to 23:00 Harare: day-shift submissions are in by 20:30, night submissions start after 06:00.
The app's offline outbox holds anything a site tries to send during the gap.

1. Laptop: disable "DA OPS API", "DA OPS Watchdog", staging tasks, email bot, truck bot, backup task.
   Stop the API. Prod is now frozen. Two live APIs on one tunnel would split writes across two
   databases, so this step is not optional.
2. Laptop: final `pg_dump -Fc` of `dafuel` and `da_bots` (3 minutes). Copy to the server over SSH.
3. Server: drop and restore both databases from that dump. Verify chain + counts match the laptop.
4. Laptop: stop and disable the "Cloudflared (DA Fuel)" service.
   Server: start cloudflared with the same tunnel. DNS does not change; the tunnel just has a new
   connector. Public health comes back within a minute.
5. Server: start API, staging, bots, watchdogs. Verify: public `/api/health`, a real login, one
   site submission, one push notification, the truck bot connected (if WhatsApp says the device was
   replaced, you scan the QR on the business number once).
6. Laptop: leave everything installed but every DA task and the Cloudflared service DISABLED.
   That is the rollback: re-enable tasks, restore the server's latest dump, start the laptop tunnel.
   Keep that option for two weeks, then stop the laptop's Postgres service.

## Phase 3: how work reaches the server afterwards

- Code: edit on the laptop as now → commit → push → `ssh da-server C:\DA-Bot\tools\deploy.bat`
  (git pull, `npm ci` if the lockfile changed, `npm run build`, `preflight-check.mjs`, `POST /api/admin/reload`).
  The preflight gate and the 0.5 s hand-over keep working unchanged.
- Numbers: "update numbers" becomes the same importers run over SSH; the OneDrive files arrive on the
  server by sync, not by the laptop being on.
- Database questions: psql over an SSH port forward. Port 5432 is never opened to the internet.
- Android/iOS builds stay on the laptop; the APK copy to `server/apk/latest.apk` goes over SSH.
- Backups: hourly dumps land in the server's OneDrive, which is now off-box by definition.
  Add one external uptime check on fuel.dasuperapp.com (Cloudflare health check or UptimeRobot)
  so a dead server is reported by something that is not the server.

## What is user-gated (you, not me)

RDP login and the OpenSSH key install; OneDrive sign-in on the server; the WhatsApp QR scan if the
truck bot is replaced; creating the company GitHub org or confirming it; Liquid firewall tickets.
Everything else in Phases 1 to 3 I run from the laptop over SSH once the key is in.
