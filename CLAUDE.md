# DA Fuel Control

Fuel requisition and approval for the DA Motors haulage fleet, Zimbabwe. Replaces a WhatsApp
group where drivers photograph a fuel tank and a manager replies "350 litres approved".

You are continuing a build, not starting one. Read this before changing anything.

---

## Why this exists

Six months of fuel records were reconstructed forensically before this was written. The finding
matters because it shapes what the app is for:

- WhatsApp approvals, the operations tracker and the DA card system agree to **0.04%** over
  490,586 litres, January to June 2026.
- **There is no material fuel loss.** Do not build this as a loss-detection tool and do not put
  "estimated pilferage" on a dashboard as if it were an established number.

What is actually wrong, and what this app fixes:

1. **No usable evidence.** An approval is a photograph and a chat line. Reconstructing six months
   of it took repeated passes, two chat exports and a corrected tracker, and several apparent
   findings collapsed when tested.
2. **Allocations are wrong.** Town work runs at 1.70 km/L against 2.52 on the open road — a 49%
   gap measured across 2,669 fill-to-fill legs. A single fleet rate under-allocates town
   deliveries by roughly a third. Drivers doing Harare runs have been quietly short.
3. **No segregation of duties.** One person raised 3,631 of 3,643 card loads and dispensed all
   1,822 yard fills.

---

## Current state

Vite + React + Capacitor. The web build compiles and the Android platform is added. Nothing is
persisted — all state is React state and dies when the app closes.

    src/App.jsx      every screen: request, approve, card interface, efficiency, master data
    src/data.js      fleet master, per-horse trip history, measured consumption
    src/stations.js  54 service stations — COORDINATES ARE APPROXIMATE
    src/device.js    location and camera; native on Android, browser fallback for `npm run dev`
    src/ocr.js       odometer read from the photograph (Tesseract, client-side)
    android/         Capacitor native project, appId zw.co.damotors.fuel

Build: `npm run build && npx cap sync android && npx cap open android`

---

## Domain rules — do not change these without asking

**Geo-lock.** The driver picks the station he is standing at, then the app verifies it. 250 m
radius. If the fix puts him elsewhere it names the site he appears to be at. The check is
automatic on selection; there is no confirm button.

**Journey.** Start point is always the fuelling station, fixed and not editable — he cannot claim
to have started somewhere else. Then ordered drops, then an end point.

**Consumption.** Each leg is costed separately. A leg is *town* if under 160 km and both ends sit
in the same city zone, otherwise *road*. 17 horses have their own measured town and road figures
in `EFF.horse`; the rest fall back to fleet medians of 1.70 and 2.52. Litres round up to the
nearest 10.

**Odometer.** Typed and photographed. OCR compares the two; more than 5 km apart raises a flag on
the request and on the approval card. The request is not blocked — blocking teaches drivers to
retake photographs until the reader gives up.

**Fleet versus retail.** Fleet drivers state a route and the allocation is calculated. Retail
drivers request a quantity for general use. A driver cannot be created without this being set.

**Approval is two-stage.** Review against the history, then confirm. Changing the litres resets it
to review so the comparison always reflects what is actually being approved.

**Distance source is always stated on screen** — Google Directions, OpenStreetMap routing, or a
straight-line estimate. Never present a distance without saying where it came from.

---

## Build order

1. **Backend.** PostgreSQL. Requests, approvals, card loads, redemptions, efficiency legs, audit
   log, master data. Every state change is append-only and attributable — this is the whole point
   of the system.
2. **Driver identity bound to the handset.** Currently a dropdown, so anyone can request as
   anyone. This undoes the entire control and must go before any pilot.
3. **Server-side OCR** with a confidence threshold. Client-side Tesseract is a prototype, not a
   control.
4. **Offline queue.** A request raised with no signal must hold and sync. Bulawayo and Feruka
   forecourts will need it.
5. **DA card interface.** Push approved litres as a load, receive the redemption postback.
   **Blocked until someone confirms the card platform has an API** — ask before designing around it.
6. **Station coordinate survey.** Field work, not code, but the geo-lock is worthless without it.

---

## Constraints

- **Self-hosted PostgreSQL** on a server in Harare, with a cloud hot standby, WAL archiving and
  nightly offsite backup. Load shedding is the failure mode that matters, not disk failure.
- Budget is roughly **$3,200 a year** all in. Do not reach for services that bill per seat.
- 46 drivers, ~500 requests a month. This will not scale to thousands and does not need to.
- Android first. iOS only for approvers, and the approver console works in any browser anyway.

---

## Things that went wrong the first time

Written down so they do not happen again.

- **Test a metric's sensitivity before reporting it.** Several findings in the forensic work
  collapsed when the arbitrary parameters behind them were varied — a FIFO matching rule, a
  dollars-to-litres conversion, a lookback window, a median benchmark. Every figure that needed an
  invented rule fell over. The figures that survived were the ones you get by adding two columns.
- **A benchmark set at the median makes half the population an exception.** An "unexplained fuel"
  total that sums only the positive side of a distribution centred on zero is measuring spread,
  not loss.
- **State which source produced a number.** Three records existed and disagreed until each was
  labelled and cut to the same window.
- **Do not let a total stand without its denominator.** 54,490 litres sounded alarming until it was
  set against 490,586 drawn.
