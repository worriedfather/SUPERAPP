# DA Super App — bot consolidation modules

This is the record of merging the six DA WhatsApp bots into the app, so site
staff and drivers **submit through the app** instead of posting to WhatsApp
groups. Read `CLAUDE.md` (domain rules) and `HANDOVER.md` (build state) first —
this file covers only the new modules.

## The idea

Each bot did the same thing: a person posts messy free text / a photo to a
WhatsApp group → a bot uses Claude to *guess* the structure → writes an Excel
file → cron posts a daily PDF and a "who hasn't submitted" reminder. The app
replaces the fragile gufrom-chat parsing with **structured forms**, so the data
is clean at source, attributable to a signed-in user, and lands in the same
append-only, hash-chained Postgres spine as fuel.

| WhatsApp bot | WhatsApp group | New in-app module | New table(s) |
|---|---|---|---|
| Stock | STOCK DA SITES | Site manager → **Submit → Stock** | `site_stock` |
| Price Survey | DA $ PRICE SURVEYS | Site manager → **Submit → Price** | `price_survey` |
| Sales Survey | DA SALES SITES | Site manager → **Submit → Sales** | `sales_survey` |
| Delivery Notes | DA MOTORS DELIVERIES. | Driver/Depot → **Delivery** | `delivery_note`, `delivery_photo` |
| Recon | LOGISTICS DELIVERIES | Depot → **Recon** | `recon_day` |
| Fuel Allocation | DA Driver Fuel allocation | *already the app* (request/decision/redemption) | — |

## Roles

Two new `actor.kind` values (see `db/superapp.sql`):

- **`site_manager`** — a retail forecourt manager. Bound to **one site** (like a
  driver is bound to a card). Sees only the **Submit** screen; deliberately no
  cross-site dashboard, so a franchisee can't see other sites' numbers.
- **`depot`** — logistics/depot. Submits delivery notes and reconciliation, and
  sees the **Logistics** dashboard.

`approver`/`admin` gain **Retail** and **Logistics** dashboards (live status +
CSV export). Identity binding is enforced server-side: a `site_manager` may only
submit for their own site (`superapp.js` → `resolveSite`).

## What was added

**Database** (`db/`)
- `superapp.sql` — idempotent migration: `site` master, the five log tables +
  `delivery_photo`, hash-chain triggers (reuses `da_append_only`), the audit
  trigger on `site`, three "latest row wins" views, and the widened
  `actor.kind` constraint. **Only adds objects — never touches loaded data.**
- `superapp-roles.sql` — grants for `da_app` (INSERT/SELECT on the logs, no
  UPDATE/DELETE — same lock as the fuel tables).

**Backend** (`server/`)
- `superapp.js` — an Express router (mounted at `/api` in `index.js`) with the
  submission + dashboard + site-manager-creation endpoints.
- `superapp-state.js` — read-model projections with the **derived** analytics
  the bots computed: missing-site lists, totals, low-stock flags, price gap vs
  market min/avg/max, delivery transit/discharge/combined loss, and depot
  reconciliation (opening + receipts − issued vs closing).
- `da-sites.js` — added `regionFor()` and `SITES_WITH_REGION` for seeding.
- `auth.js` — a `site_manager`'s bound site is added to their JWT claims.
- `seed.js` — seeds the 58 retail sites and a `depot` staff login.
- `index.js` — mounts the router; `/api/verify` now covers the new hash chains.

**Frontend** (`src/`)
- `superapp.jsx` — all new screens (SiteSubmit with Stock/Price/Sales, Delivery,
  Recon, Retail + Logistics dashboards with CSV export, SiteManagerCreate).
- `App.jsx` — new nav icons, `ROLE_TABS` for the new roles + dashboards, render
  cases, and the site-manager creator inside Master data.
- `api.js` — the new API calls.

### Endpoints (all under `/api`, all require a signed-in actor)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET  | `/sites` | any | active retail sites (dropdowns) |
| POST | `/stock` | site_manager, admin, approver | submit closing stock |
| POST | `/price` | site_manager, admin, approver | submit price survey |
| POST | `/sales` | site_manager, admin, approver | submit sales + stock |
| POST | `/deliveries` | driver, depot, admin, approver | submit a delivery note (+photo) |
| POST | `/recon` | depot, admin, approver | submit depot reconciliation |
| GET  | `/retail?date=` | admin, approver | stock/price/sales board for a date |
| GET  | `/haulage?days=` | admin, approver, depot | deliveries + recon |
| POST | `/site-managers` | admin, approver | create a site_manager bound to a site |

## Applying it (on the DB box)

```bash
psql -d dafuel -f db/superapp.sql          # as the owner (postgres)
psql -d dafuel -f db/superapp-roles.sql    # grants for da_app
npm --prefix server run seed               # seeds the 58 sites + depot login (idempotent)
```

Then create a site manager per forecourt from the app (admin/approver →
**Master data → Retail site managers**), hand out their login + PIN, and they can
submit. `depot` login PIN is printed by the seed (default `3690` — change it).

## Rollout (dual-run, then retire — as agreed)

Keep the WhatsApp bots running while sites are trained. Retire a bot only once
its module is adopted, by disabling it in `../suite/bots.config.js`
(`enabled: false`) — the suite launcher already supports this and the other bots
keep running. Nothing in the bot folders is modified by this work.

## Notifications (built)

**Daily submission reminders** are live via device-scheduled local notifications
(`@capacitor/local-notifications`, `src/notify.js`) — no server, no Firebase.
They fire even with the app closed:

- **site_manager** — 08:00 price survey, 08:30 night figures, 20:00 day figures.
- **depot** — 12:30 reconciliation, 17:00 delivery notes.

Scheduled automatically on sign-in (`App.jsx` effect). Each submit screen has a
**Reminders On/Off** toggle and a **Test** button (fires a notification in ~4s,
so you can confirm it works on the phone immediately). Browser (`npm run dev`)
falls back to the Web Notification API so the Test button still demonstrates.

## Not built yet (clearly scoped next steps)

- **Cross-user push alerts** ("site X is late" → management's phone). Unlike the
  submitter reminders above, telling one user about another's non-submission
  needs a server→phone channel = **FCM (a Firebase project + `google-services.json`
  + a service-account key)**. Scaffold once creds exist: a `push_token` table +
  `/api/push/register`, and a nightly `node-cron` job that reads the same
  `buildRetail(date).*.missing` arrays and sends via FCM HTTP v1. The live
  dashboards already surface the same "who's missing" information in-app.
- **Scheduled PDF** (vs the current on-demand CSV export). The CSV opens in
  Excel and covers the daily-report need; a server-rendered PDF is optional.
- **Delivery-note temperature correction** (ASTM D1250 VCF). The temps and
  density are captured on `delivery_note`; the read-model currently reports raw
  (uncorrected) loss. Fold VCF into `superapp-state.js → buildHaulage` when the
  finance team confirms the correction table to use.
- **Photograph OCR** for delivery notes is intentionally dropped — the driver
  types the figures (clean at source). The paper photo is still stored as
  evidence, hash-chained like the odometer photo.

## Verify

- Web build: `npm run build` (compiles).
- Server wiring: `cd server && node index.js`, then `GET /api/health` → ok,
  and `GET /api/sites` without a token → 401 (router mounted behind auth).
- Chains: after some submissions, `GET /api/verify` (admin) walks every chain
  including the five new tables.
