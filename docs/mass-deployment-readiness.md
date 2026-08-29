# DA OPS — Mass-Deployment Readiness

Test battery for declaring the app ready for full-fleet rollout. Automated parts
run as the deploy gate; manual parts are per-release-candidate checklists.
First full execution: **2026-08-29**. Update the results column on every run.

## 1. Automated deploy gate  —  `cd server && npm test`

Runs `test/smoke.mjs` (DB invariants) + `tests/readiness.mjs` (API-level, read-only:
money identities, hero==drill consistency, authz matrix, ledger append-only +
hash chains, notification deep links, platform health). **A deploy does not ship
on red.** Deploy loop: build → `npm test` → reload → verify login.

| Area | Checks | 2026-08-29 |
|---|---|---|
| Money math (identities, trading-day, negatives) | 4 | ✅ |
| Hero == drill cross-endpoint consistency | 7 | ✅ |
| Authz matrix (role lanes, site binding, fail-safe rejects) | 8 | ✅ |
| Ledger (no UPDATE/DELETE, hash chains verify) | 6 | ✅ (sales_survey chain repaired — recorded re-sign in audit_log after build-out column additions broke serialisation) |
| Notification deep links | 1 | ✅ 14 tabs |
| Platform health / login hardening | 3 | ✅ |
| Smoke suite (append-only, v_sales_daily, margin, throttle) | 6 | ✅ |

## 2. Tamper-evidence drill  (quarterly + after schema changes)

Restore latest dump to `dafuel_tamper_test`, verify chains, alter one ledger row
as superuser, verify again — the checker must name the exact row. Then drop the DB.
**2026-08-29: PASS** — +$1000 on one cash_collection row detected at its exact seq.

## 3. Disaster-recovery rehearsal  (quarterly)

Timed restore of the latest hourly dump. Target: < 15 min to a verified copy.
**2026-08-29: 8 seconds** to restore + chains verify. Loss window: ≤ 1 hour
(hourly dumps); drops to ≤ 1 min once WAL archiving is activated
(**pending: elevated `Restart-Service postgresql-x64-18`**).

## 4. Load test  (before rollout + when site count grows)

`npm run test:load [concurrency] [seconds]` — morning-peak read mix, one client
IP per simulated user (matches production; the limiter is per `cf-connecting-ip`).
Pass: 0 errors, p95 < 500 ms at 3× current site count. Never run 08:00–09:30.
**2026-08-29: PASS** — 46 real accounts, 60 concurrent, 528 req/s of 200s for
30 s, 0 errors (incl. 429s). p95: expected-cash 219 ms, deliveries-due 120 ms,
dashboards ≤ 24 ms warm; executive p99 1.2 s on a cold cache rebuild. That is
~10× the true 54-site morning peak.

## 5. Manual per-release checklists

**Version skew** — keep one phone on the previous APK; run login, stock submit,
cash submit, trip flow against the new API before shipping. Gweru's legacy
`usd_cash` incident is the canonical failure. Raise MIN_BUILD when an old form
writes data the new model can't interpret.

**Offline / network chaos** — airplane-mode submit → reconnect → exactly one
row; 2G throttle on the submit flows; device clock ±1h; app killed mid-sync.

**Device / OEM matrix** — cheapest real handsets (Samsung A-series, Tecno,
Xiaomi): background GPS through battery saver, push with app closed AND killed,
GPS-off gate reaches the right settings screen, camera on low-end sensors.

**Push delivery** — for each push type: arrives open/closed/killed; deep link
lands on the right screen per role; no duplicate storm after an API restart.

**Usability (frontline)** — 5 supervisors + 5 drivers, watched not helped:
submit a shift, split cash (watch for the Sent-to-HQ vs Banked confusion),
request an unlock, confirm offload, file the note after settling. Repeat in
Shona/Ndebele once i18n lands.

## 6. External

- Penetration test by an outside party before public-facing scale-up.
- Secrets scan on the repo (history has held credentials before — rotate on any find).

## 7. Exit criteria for "mass deployment ready"

- [ ] Deploy gate green on every deploy for 14 consecutive days
- [x] Tamper drill passes (2026-08-29)
- [x] DR rehearsal under target (8 s on 2026-08-29) — re-run quarterly
- [ ] WAL archiving live (≤ 1-minute loss window)
- [x] Load test: 0 errors, p95 < 500 ms at ~10× sites (2026-08-29)
- [ ] Push delivery ≥ 95% across the device matrix
- [ ] 14 consecutive days of sites reconciling within $50 tolerance
- [ ] Version-skew pass on the previous APK, MIN_BUILD policy decided
- [ ] Frontline usability round completed, top-3 stalls fixed
- [ ] External pen test: no criticals open
- [ ] Rollback plan tested: previous APK hosted, MIN_BUILD unbumped, `git revert` + reload rehearsed

## Rollback plan (one page)

1. Web: `git revert <commit>` → `npm run build` → reload API (dist serves instantly).
2. Server: revert server file(s) → reload via `/api/admin/reload` (or kill node; the
   supervisor loop respawns).
3. APK: previous release kept at `server/apk/` — repoint `latest.apk`, do NOT raise
   MIN_BUILD, push notice to affected roles.
4. DB: never roll back the ledger — corrections are compensating rows (CLAUDE.md
   policy). For catastrophic loss: restore latest hourly dump (rehearsed, 8 s) +
   WAL once active.
