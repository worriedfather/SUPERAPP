# DA Fleet Manager — Handover

For continuing this build on a new machine (and for a fresh Claude Code session).
**Read `CLAUDE.md` first** — it holds the domain rules and is authoritative; do not
change those without asking. This file covers the *current build state*, how it's
deployed, how to run it on a new laptop, what's left, and where it's heading.

---

## 1. What it is, and where it's at

Fuel requisition + approval for the DA Motors haulage fleet (Zimbabwe), replacing a
WhatsApp group. It is now a **working pilot**, not a prototype:

- **Android app** (Vite + React + Capacitor) — driver request wizard, approver
  workflow, card system, efficiency analytics, and an AI "Intelligence" tab.
- **Node/Express API** + **self-hosted PostgreSQL 18** — append-only, hash-chained,
  every state change attributable.
- **Deployed** on one Windows box via a **Cloudflare Tunnel**: the API is public at
  **https://fuel.dasuperapp.com**, so the app works on any phone with internet.
- **Loaded with real history** — ~3,653 card draws (Jan–Jul 2026) + ~3,373 approvals,
  reconstructed from the client's own records. Efficiency/Intelligence run on real data.
- **Hardened for pilot** — test GPS spoofer off, secrets rotated, driver PINs reset.

Current pilot go-live steps and status are in **`GO_LIVE.md`**.

---

## 2. Stack & architecture

```
Android app (Capacitor WebView, React)         src/*
      │  HTTPS
      ▼
Cloudflare Tunnel  fuel.dasuperapp.com  ──►  Node/Express API  :4000   server/*
                                                   │
                                                   ▼
                                          PostgreSQL 18  "dafuel"      db/*
```

- **Frontend:** `src/App.jsx` is essentially the entire UI (one big file: driver
  home/card/wizard, approver stepped workflow, card system, efficiency, intelligence,
  master data). `src/Login.jsx`, `src/api.js` (server calls + in-app server override),
  `src/device.js` (GPS/camera, native + browser fallback), `src/ocr.js` (client OCR),
  `src/data.js` / `src/stations.js` (seed/reference data used by the UI).
- **Backend (`server/`, ESM):** `index.js` (routes), `auth.js` (PIN login, JWT, roles,
  rate-limit), `db.js` (pg pool + `tx()`), `state.js` (read-model projection),
  `efficiency.js` (fill-to-fill legs), `intelligence.js` (Anthropic API, grounded),
  `da-sites.js` (canonical DA site list + fuzzy matcher), `seed.js` (master seed),
  `da-tunnel.js` (pm2 wrapper for cloudflared).
- **DB (`db/`):** `schema.sql` (tables, triggers, `da_verify_chain`, views),
  `roles.sql` (low-privilege `da_app` grants), `dafuel.dump` (a full snapshot — see §4).
- **AI:** Intelligence tab → `POST /api/intelligence` → `server/intelligence.js` builds
  a compact figures object from the DB and calls the Anthropic Messages API
  (`@anthropic-ai/sdk`, model `claude-opus-5`, adaptive thinking). Key is server-side only.

### Data model (the important idea)
Append-only log tables — `request`, `decision`, `redemption`, `card_ledger`,
`request_photo`, `audit_log` — each with a SHA-256 hash chain (tamper-evident;
`SELECT * FROM da_verify_chain('request')`). Current state (a request's status, a card's
balance) is **derived** by reading the log, never stored. Master tables
(`actor`/`driver`/`horse`/`station`/…) are editable but audited; deletes are blocked.
The app connects as `da_app`, which physically cannot UPDATE/DELETE the log.

**Efficiency** = fill-to-fill legs computed from consecutive redemptions per card:
*dist* = odometer delta, *litres* = drawn at the fill, plus **site** (DA station where
drawn) and **route** (corridor prev-site → this-site). **Site ≠ Route ≠ Client** —
sites are DA fuelling stations (`da-sites.js`, 58 of them), routes are corridors driven,
clients (e.g. African Chrome, Kwekwe Mine) are delivery destinations, not yet tracked.

---

## 3. Deployment (current box)

Both run under **pm2**, set to resume on reboot (`pm2 status`, `pm2 logs <name>`):

| pm2 process | what | notes |
|---|---|---|
| `da-fuel-api` | `server/index.js` | the API on :4000 |
| `da-fuel-tunnel` | `server/da-tunnel.js` → cloudflared | runs the **named** tunnel `da-fuel` → `fuel.dasuperapp.com` |

- The Cloudflare tunnel `da-fuel` is a **named tunnel** on the client's Cloudflare
  account (domain `dasuperapp.com`). Its config + credentials live **outside the repo**
  at `C:\Users\<user>\.cloudflared\` (`config.yml`, `<tunnel-id>.json`, `cert.pem`).
  **These must be copied to move the tunnel** (see §5).
- There is a **separate, unrelated cloudflared tunnel "DA CCTV"** on the same box — leave
  it alone; `da-fuel` coexists with it (that's why the tunnel runs via a pm2 Node wrapper,
  not `cloudflared service install`, which only manages one tunnel).
- Postgres runs as a normal Windows service.

---

## 4. Secrets & sensitive files (handle on the move)

All in the repo folder (so they travel when you copy it) **except the tunnel creds**:

- `server/.env` — **real secrets**: `DATABASE_URL` (da_app password), `JWT_SECRET`,
  `ANTHROPIC_API_KEY`, `SEED_DATABASE_URL` (postgres superuser password). Rotated for the
  pilot. If the new box's Postgres password differs, update `SEED_DATABASE_URL` and the
  scripts in `server/import/*` (they hardcode `Canice@1234` for the postgres user).
- `PILOT_PINS.csv` — every driver/staff login + their PIN (plaintext; the DB stores only
  hashes). **Sensitive** — hand out, then delete. Regenerate anytime with
  `node server/import/reset-pins.mjs`.
- `C:\Users\<user>\.cloudflared\` — the Cloudflare tunnel credentials. **NOT in the repo.**
  Copy separately to run `fuel.dasuperapp.com` from the new box.
- `.env.production` — `VITE_API_BASE=https://fuel.dasuperapp.com` (baked into the APK).

> None of these secret *values* are reproduced in this doc on purpose — they're in the
> files above. Treat `.env` and `PILOT_PINS.csv` as confidential.

---

## 5. Moving to the new laptop — checklist

1. **Copy the whole `C:\DA-Bot\dafuel` folder** to the new machine (keep the path, or
   fix paths in the `.ps1`/`.sh` helpers if you change it).
2. **Install prerequisites:**
   - Node.js 18+ (built on 24). `npm install` in the project root **and** in `server/`.
   - PostgreSQL 18. Note the superuser password you set.
   - For APK builds: JDK 21 + Android SDK cmdline-tools. The old box used a portable
     toolchain under `C:\DA-Bot\tools` + `C:\DA-Bot\gradle-home` referenced by
     `build-apk.ps1` — copy those too, or reinstall and update the paths in that script.
3. **Restore the database** (fastest — exact pilot state):
   ```
   psql -U postgres -c "CREATE DATABASE dafuel;"
   psql -U postgres -d dafuel -f db/schema.sql
   psql -U postgres -d dafuel -f db/roles.sql        # creates da_app; edit its password to match .env
   pg_restore -U postgres -d dafuel --no-owner db/dafuel.dump
   ```
   *Or* rebuild from source (the client CSVs are in `files (33)/`, which is in the repo):
   `bash server/import/rebuild-real.sh`.
4. **Point `.env`** — set `DATABASE_URL`/`SEED_DATABASE_URL` passwords to the new box's
   Postgres. Keep `JWT_SECRET` and `ANTHROPIC_API_KEY` as-is (or rotate with
   `node server/import/rotate-secrets.mjs`).
5. **Run it:** `cd server && node index.js` (or set up pm2 as in `GO_LIVE.md` §C).
6. **The tunnel — decide the cutover.** To keep `fuel.dasuperapp.com`: copy
   `C:\Users\<olduser>\.cloudflared\` to the new box, run `cloudflared tunnel run da-fuel`
   there (under pm2 via `server/da-tunnel.js`), and **stop it on the old box** (don't run
   two connectors). The baked APK keeps working, unchanged. Alternatively point the app at
   a new address by editing `.env.production` and rebuilding.
7. **Verify:** `curl https://fuel.dasuperapp.com/api/health` → `{"ok":true}`; sign in on a
   phone; open Efficiency + Intelligence.

---

## 6. Commands cheat-sheet

| Task | Command |
|---|---|
| Web dev (proxies /api to :4000) | `npm run dev` |
| Run API | `cd server && node index.js` |
| Build APK | `powershell -File build-apk.ps1` → `android/app/build/outputs/apk/debug/app-debug.apk` |
| Install APK | `adb install -r <apk>` |
| Reload data from source CSVs | `bash server/import/rebuild-real.sh` |
| Reset all PINs (+ handout) | `node server/import/reset-pins.mjs` |
| Rotate DB/JWT secrets | `node server/import/rotate-secrets.mjs` |
| Full end-to-end test (10k ops, throwaway DB) | `bash server/sim-run.sh 10000` |
| Verify hash chains | `curl .../api/verify` (admin) |

Logins: staff + drivers in `PILOT_PINS.csv`. Driver username = first-initial+surname
(e.g. `amudzingwa`). `admin` / `approver` are staff.

---

## 7. Done vs. pending

**Done:** backend + append-only DB + hash chain; PIN login bound to handset; driver
wizard; stepped approver workflow (confirm/decline→back-to-driver); card system report +
Excel/PDF export; efficiency analytics (truck/driver/route/site, date filters);
Intelligence tab (Anthropic, grounded, executive tone, site/route/client aware, estimates
rather than refuses); real historical data loaded; 10k-op simulation passing; Cloudflare
Tunnel + pm2 deploy; pilot hardening (spoofer off, secrets rotated, PINs reset); APK baked
to the public URL.

**Pending / deferred** (see also `CLAUDE.md` build order):
- **Offline queue** — a request needs signal when sent (matters at dead-zone forecourts).
- **Server-side OCR** with a confidence threshold (client Tesseract is a prototype).
- **Station coordinate survey** — geo-lock is deliberately loose (25 km, `SURVEY_TOLERANCE_M`)
  until the 58 sites are surveyed; then tighten to 250 m.
- **Backups architecture** — pilot minimum is nightly `pg_dump` off-box; target is hot
  standby + WAL archiving + offsite (load-shedding is the failure mode, not disk).
- **iOS / approver web console** — APK is Android only; no hosted web build yet.
- **DA card platform API** — redemptions are a manual postback until the card API is
  confirmed (CLAUDE.md build item 5, blocked pending their API).
- **Release-signed APK** (currently debug-signed sideload) and **tighter CORS** for prod.

---

## 8. Where it's heading — merge with the other DA bots

**STATUS: the merge has started — see `SUPERAPP_MODULES.md`.** The six WhatsApp
bots (stock, price survey, sales survey, delivery notes, recon, fuel allocation)
now have in-app submission modules writing to the same append-only spine. New
roles `site_manager` and `depot`; new tables `site_stock`/`price_survey`/
`sales_survey`/`delivery_note`/`recon_day` via the idempotent `db/superapp.sql`
migration; approver/admin get **Retail** and **Logistics** dashboards. Apply
steps and what's left (push reminders, VCF temp-correction) are in that doc.
Rollout is **dual-run then retire** — the bots keep running (disable per-bot in
`../suite/bots.config.js`) until each module is adopted.

The original planning note is kept below for context.

**For the next session — do NOT start building the merge blind.** First:
1. **Inventory each existing bot** with the client: what it does, its stack, where it runs,
   how it's triggered, what data it owns, who uses it.
2. **Decide the integration shape** — most likely this app becomes a shell with additional
   role-gated tabs/modules, and the Node API gains endpoints (or proxies) for each bot's
   function; or a lightweight "apps" launcher. Keep the append-only/attributable spine
   where money or controls are involved.
3. **Reuse what's here:** the auth/roles/JWT model, the pm2 + Cloudflare-tunnel deploy
   pattern (one box, multiple named tunnels), the React shell + design system in
   `src/App.jsx` (CSS vars, `.card`/`.pill`/step-wizard patterns), and the Intelligence
   pattern (grounded Anthropic calls) are all directly extensible.
4. Confirm scope and cost with the client before large builds (Anthropic usage, any new
   infra), per the budget constraint in `CLAUDE.md` (~$3,200/yr).

---

## 9. Gotchas learned (save yourself the pain)

- **Append-only means rebuild, don't edit.** To change loaded data, rebuild the DB
  (`rebuild-real.sh`) — you cannot UPDATE/DELETE log rows (triggers + role both block it).
- **Windows/Git-Bash traps:** heredocs mangle Windows `\` paths and `$` — write helper
  scripts with the Write tool using forward-slash paths, not inline heredocs. `/tmp` isn't
  writable; use the project or the scratchpad.
- **pm2 + cloudflared:** pm2 mis-parses `-- tunnel run` args and `cloudflared service
  install` only manages one tunnel — hence `server/da-tunnel.js`, a tiny Node wrapper pm2
  runs cleanly (and it runs as the user, so cloudflared finds its config).
- **cloudflared as a Windows service runs as LocalSystem** and can't see the user's
  `~/.cloudflared` config — another reason for the pm2/user-wrapper approach.
- **`TEST_GPS` in `src/App.jsx` must stay `false`** for anything real (it lets you fake
  location).
- **Two litre concepts:** approvals (litres authorised, loaded from the WhatsApp/handover
  log — a *matched lower bound*) vs. draws (litres dispensed, from the card system —
  authoritative). Never present the gap, or efficiency spread, as "loss" (see CLAUDE.md).
- **Intelligence answers** must stay executive/plain, never name their data source, and
  estimate rather than refuse — tuned in the system prompt in `server/intelligence.js`.
