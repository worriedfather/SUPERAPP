# DA Fuel Control — Android

Geo-locked fuel requests, calculated allocations and approval, for the DA Motors fleet.

## What is here

    src/App.jsx      the whole application — request, approve, card interface, efficiency, master data
    src/data.js      fleet master, trip history, measured consumption (Jan–Jun 2026 records)
    src/stations.js  service station coordinates — APPROXIMATE, must be surveyed
    src/device.js    location and camera, native on Android and browser elsewhere
    src/ocr.js       odometer reading from the photograph
    android/         the native Android project

## Backend

State is now persisted in PostgreSQL (append-only, tamper-evident) with a small
Node/Express API. It runs on one self-hosted server — no managed-cloud services.

    db/schema.sql     tables, the SHA-256 hash chain, append-only triggers, views
    db/roles.sql      the low-privilege da_app role (INSERT/SELECT on the log only)
    server/           the API, PIN sign-in, seed script — see server/README.md

Set it up once (`server/README.md` has the full walk-through), then the web app
talks to it. Drivers sign in with their card number + PIN; a request is tied to
whoever is signed in, not a dropdown (build item 2, done).

## Building it

You need Android Studio (which brings the SDK and Gradle) and JDK 21.

    npm install
    VITE_API_BASE=https://your-harare-server npm run build   # bake in the API URL, compile to dist/
    npx cap sync android   # copy it into the native project
    npx cap open android   # opens Android Studio

`VITE_API_BASE` is the address of the backend above. In `npm run dev` you can
omit it — Vite proxies `/api` to a local server on :4000. The Android app must
reach the API over **https** (`allowMixedContent` is off).

In Android Studio: Build > Build Bundle(s)/APK(s) > Build APK for a test build,
or Build > Generate Signed Bundle for the Play Store.

From the command line, once the SDK is installed:

    cd android && ./gradlew assembleDebug     # APK for testing
    cd android && ./gradlew bundleRelease     # AAB for Play

## Before it goes near a driver

1. **Survey every forecourt.** src/stations.js holds approximate coordinates. Stand at each of the 54
   sites, record a fix, and replace them. The 250 m geo-lock is only as good as these.
2. **Bind the driver to the handset.** The driver is picked from a dropdown. In production this must be
   tied to the device or a login, or anyone can request as anyone.
3. **Move OCR server-side.** Tesseract in the app is fine for a pilot. A control system needs the read
   done where the driver cannot influence it, with a confidence threshold.
4. ~~**Point it at a backend.**~~ **Done** — PostgreSQL, append-only and tamper-evident. See
   `db/` and `server/`. Requests, approvals, card loads and redemptions are persisted as an
   immutable, attributable log.
5. **Wire the DA card interface.** Approved litres must load automatically and redemptions must post back.
6. **Google Maps key.** Master data tab. Without it distances fall back to OpenStreetMap routing, then to
   a straight-line estimate. The app always states which one it used.

## Consumption

Town work and open road are costed separately: 1.70 km/L against 2.52 across 2,669 measured legs.
Seventeen horses have their own figures; the rest use fleet medians. A leg counts as town if it is
under 160 km and stays inside one city.
