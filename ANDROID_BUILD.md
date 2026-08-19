# Building & installing the DA Fuel Android app

This produces a **test APK** you can install on a phone to try the app with real
GPS and camera, talking to the backend running on a laptop over office WiFi.
It is **not** a production build — see "Before a real pilot" at the end.

---

## What must be true first

- **Android Studio** installed (it brings its own Java and SDK manager).
- The **backend and web build are prepared** — already done in this project. If
  you change anything, re-run step 2.
- The **laptop and phone are on the same WiFi.** This laptop is `192.168.100.5`
  on that network; the app is built to talk to `http://192.168.100.5:4000`.
- The **backend is running** on the laptop (see "Running the backend" below).

---

## Step 0 — Firewall (once, needs Administrator)

The phone cannot reach the laptop's backend until port 4000 is allowed in.
Open **PowerShell as Administrator** (Start → type PowerShell → right-click →
Run as administrator) and run:

    New-NetFirewallRule -DisplayName 'DA Fuel API 4000' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4000 -Profile Private

---

## Step 1 — If the laptop's WiFi address ever changes

Find it: `ipconfig` → the Wi-Fi "IPv4 Address". If it is no longer
`192.168.100.5`, update it in **`.env.production`** and rebuild (step 2).

---

## Step 2 — Build the web app and copy it into Android

From the project root (`C:\DA-Bot\dafuel`):

    npm run build
    npx cap sync android

(`build` compiles the app with the backend URL baked in; `sync` copies it into
the Android project and refreshes the plugins.) Already done — repeat only after
changing the app or the IP.

---

## Step 3 — Open the project in Android Studio

    npx cap open android

or open Android Studio → **File → Open** → choose the `android` folder inside
the project.

---

## Step 4 — Let Gradle sync

Android Studio starts a **Gradle sync** automatically (first time: a few minutes,
it downloads build tools). Watch the bottom status bar.

- If a yellow banner offers **"Install missing SDK package(s)"** or asks to
  **accept a licence** — click it / Accept. That is it fetching the `android-36`
  platform.
- Wait until it says **"Sync finished"** / the spinner stops.

---

## Step 5 — Build the APK

Top menu: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

When it finishes, a popup appears bottom-right → click **locate**. The file is:

    android\app\build\outputs\apk\debug\app-debug.apk

---

## Step 6 — Put it on the phone

**Option A — cable (installs and launches directly):**
1. On the phone: Settings → About phone → tap **Build number** 7 times to unlock
   Developer options, then turn on **USB debugging**.
2. Plug the phone into the laptop by USB, allow the "Allow debugging?" prompt.
3. In Android Studio press the green **Run ▶** button.

**Option B — file transfer:**
1. Copy `app-debug.apk` to the phone (email/WhatsApp to yourself, or Google Drive).
2. Tap it on the phone; allow **"install unknown apps"** for whatever app opened it.
3. Install, then open **DA Fuel**.

The app will ask for **location** and **camera** permission the first time — allow both.

---

## Step 7 — Using it

Sign in:

| Who | Login | PIN |
|---|---|---|
| Approver | `approver` | `2468` |
| Admin (also sees Request) | `admin` | `1379` |
| A driver | card number, e.g. `1000002` | last 4 of card → `0002` |

On the **Request** screen there is a **"Testing only — pretend the phone is
standing at…"** bar. Pick a station so the geo-lock passes without you being at a
real forecourt. Leave it on "use the real GPS" for genuine behaviour.

---

## Running the backend

The phone talks to the backend on the laptop. It must be running:

    cd C:\DA-Bot\dafuel\server
    node index.js

Leave that window open. (For the browser version on the laptop, also
`npm run dev` from the project root and open http://localhost:5173.)

---

## If it will not connect on the phone

- Backend running on the laptop? (`node index.js`)
- Phone and laptop on the **same WiFi**?
- Firewall rule added (step 0)?
- Laptop IP still `192.168.100.5`? If not, step 1 then step 2, rebuild the APK.
- Quick test: open `http://192.168.100.5:4000/api/health` in the **phone's
  browser** — it should show `{"ok":true}`. If it doesn't, it's the network/
  firewall, not the app.

---

## Before a real pilot (production hardening)

This test build deliberately relaxes security for the office LAN. For a pilot:

1. **HTTPS backend.** Put the server behind https, set `VITE_API_BASE` in
   `.env.production` to the `https://…` address.
2. **Remove the cleartext allowances:** delete
   `android/app/src/main/res/xml/network_security_config.xml` and the
   `android:networkSecurityConfig` line in `AndroidManifest.xml`; set
   `"allowMixedContent": false` in `capacitor.config.json`.
3. **Turn off the GPS test toggle:** set `const TEST_GPS = false;` in
   `src/App.jsx` (removes the amber bar and the fake-location path).
4. **Change all PINs** — the seeded driver PINs (last 4 of card) and the staff
   PINs are temporary.
5. Rebuild (`npm run build && npx cap sync android`) and produce a **signed
   release** build (Build → Generate Signed Bundle / APK) rather than debug.

---

## Files involved in the Android build

| File | What it is |
|---|---|
| `.env.production` | the backend URL baked into the Android/production build |
| `capacitor.config.json` | app id, and (test build) `allowMixedContent: true` |
| `android/local.properties` | where the Android SDK lives on this machine |
| `android/app/src/main/AndroidManifest.xml` | permissions + the cleartext network config link |
| `android/app/src/main/res/xml/network_security_config.xml` | (test build) allows http to the laptop only |
| `src/device.js` | native GPS + camera (Capacitor) with a browser fallback |
| `src/App.jsx` | the app; `TEST_GPS` flag + `TestBar` live near the top |
| `android/app/build/outputs/apk/debug/app-debug.apk` | the built app (after step 5) |
