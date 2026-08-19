# DA OPS — Release Notes

Package: `zw.co.damotors.fuel` · Backend: `https://fuel.dasuperapp.com`

---

## v1.2.0 (versionCode 4) — current

**Play Console "What's new" (paste this):**
> Lubricants point-of-sale for site staff, plus a live Fleet/Yard workshop board.
> New role-based access: Logistics, Managers, Executives, Yard, Supervisors and
> Drivers each see only what they need. Dashboards now refresh with the latest
> stock, sales, price and delivery data automatically.

**Full changelog**
- **Lubricants POS** — till screen (catalogue → cart → payment → receipt), lube-sales report, ZIMRA fiscal field ready for later VFD integration.
- **Live data sync** — dashboards auto-refresh from the source data every few minutes (new records only).
- **Yard / workshop** — log a truck in for repair, post morning & evening updates, close when ready; full history kept.
- **Fleet status** — at-a-glance board: trucks active vs in workshop, days in workshop, and the major fault (managers & executives).
- **Roles** — Logistics, Managers, Executive (full access except raising fuel requests), Yard, Supervisors, Drivers, Admin.

---

## v1.1.0 (versionCode 3)
- Added the **Yard workshop** and **Fleet status** modules.
- Introduced the **Manager**, **Executive** and **Yard** roles mapped to the org structure.

## v1.0.1 (versionCode 2)
- Renamed the app to **DA OPS**.

## v1.0.0 (versionCode 1) — first build
- **Fuel**: driver requests, geo-locked at the station, approvals, card ledger, redemptions.
- **Retail sites**: tank-level stock, price surveys (per-site competitors, preload yesterday), sales — one submission, auto shift.
- **Deliveries**: tank-level delivery notes with ASTM D1250 temperature-corrected loss.
- **Warehouse & Inventory**: yard stock, goods-in-transit, daily reconciliation, firm-wide inventory (warehouse + trucks + sites).
- **Executive summary**: sales, revenue, delivered, distance, stock cover, delivery loss, stock-out risk, period-over-period deltas, gross-margin input.
- **Intelligence**: grounded AI Q&A over the data.
- Everything is append-only and cryptographically hash-chained (tamper-evident); every action is attributable.
- Adaptive UI: phone (menu → module → back) and tablet/desktop (side rail); daily submission reminders.

---

### Notes for testers
- Sign in with the username/PIN issued to you. If the app can't connect, check you have internet (it works on WiFi or mobile data).
- This is an internal pilot build — please report anything that looks wrong (wrong number, screen, or access) to the admin.
