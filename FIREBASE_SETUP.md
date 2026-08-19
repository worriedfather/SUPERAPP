# Firebase / FCM push — activation steps

All the **code** is done (client + server). Push "lights up" once these **two files**
from your Firebase project are dropped in. Until then the app runs exactly as now
(in-app alerts + local reminders keep working; push is a silent no-op).

## 1. Create the Firebase project + Android app
1. Go to <https://console.firebase.google.com> → **Add project** (e.g. "DA OPS").
2. In the project, **Add app → Android**.
   - **Android package name:** `zw.co.damotors.fuel`  ← must match exactly.
   - Nickname/SHA-1 optional (not needed for FCM).
3. Download **`google-services.json`** and place it at:
   ```
   C:\DA-Bot\dafuel\android\app\google-services.json
   ```

## 2. Server service-account key
1. Firebase console → ⚙ **Project settings → Service accounts**.
2. **Generate new private key** → downloads a JSON file.
3. Save it as:
   ```
   C:\DA-Bot\dafuel\server\firebase-service-account.json
   ```
   (or set env `FIREBASE_SERVICE_ACCOUNT` to its path). **Never commit it** — it's a secret.

## 3. Tell me "done"
I'll then:
- Rebuild the app (v1.4.5) with `google-services.json` baked in and push it to the phone.
- Restart the API — it auto-detects the service-account and enables sending.
- Verify end-to-end: sign in on the phone → a device token registers → trigger an
  approval/decision → the phone gets a push even with the app closed, and tapping it
  opens the right screen.

## What's already wired (no action needed)
- **Client** (`src/push.js`): requests notification permission, registers the FCM
  token to `POST /api/push/register`, creates the high-priority `da-ops` channel, and
  deep-links a tapped push to its tab. Guarded so a missing config never crashes.
- **Server** (`server/push.js`): stores tokens in `device_token`, `sendToActors()`
  sends via `firebase-admin`, prunes dead tokens. Already called when a fuel request
  is raised (→ approvers) and when a decision is made (→ the driver).
- **Android** (`android/app/build.gradle`): applies the google-services plugin
  automatically **iff** `google-services.json` is present; `POST_NOTIFICATIONS`
  permission already in the manifest.
