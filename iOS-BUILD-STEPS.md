# Getting DA OPS onto your iPhone (real installable app, via TestFlight)

Your app is a **Capacitor** app — the UI ships *inside* a native shell, so the iOS
build is a genuine native app (with camera + GPS), not a webpage. It builds in the
**cloud (Codemagic)** — you do **not** need a Mac.

## Already done (build-ready)
- iOS platform dependency added (`@capacitor/ios`).
- Web UI builds and points at the live API (`https://fuel.dasuperapp.com`).
- Cloud build pipeline written: `codemagic.yaml` (builds iOS → submits to TestFlight).
- `.gitignore` protects the server secrets so they never reach a repo.
- App identity: **name** "DA OPS", **bundle id** `zw.co.damotors.fuel`.

## What YOU do (needs your accounts — I can't log in as you)

**1. Apple Developer Program** (in progress) — developer.apple.com/programs, ~$99/yr,
   Individual, approved in hours–2 days.

**2. Put the code in a Git repo** (once, free)
   - Create a **private** repo on GitHub.
   - I can prepare and push it, or you connect this folder — just say the word.

**3. Codemagic** (free tier, builds the app)
   - Sign up at codemagic.io with the GitHub account, add the repo.

**4. Connect Apple to Codemagic** (so it can sign + upload)
   - Apple → App Store Connect → Users and Access → **Integrations → App Store Connect API**
     → generate a key (App Manager role) → download the `.p8`.
   - Codemagic → Team settings → Integrations → App Store Connect → add it, name it
     exactly **`DA_OPS_ASC`**.

**5. Create the app record**
   - App Store Connect → Apps → **＋** → bundle id `zw.co.damotors.fuel`, name "DA OPS".
   - Copy its numeric **Apple ID** into `codemagic.yaml` → `APP_STORE_APP_ID`.

**6. Run it**
   - Codemagic → start the **`ios-testflight`** workflow. ~15–20 min → it lands in TestFlight.

## Installing it on the iPhone
   - Install Apple's free **TestFlight** app from the App Store.
   - You'll get an invite (or add yourself as an internal tester in App Store Connect).
   - Open TestFlight → install **DA OPS** → it appears as its own app icon. Done.

## Notes
- First cloud build sometimes needs a small tweak (Xcode/CocoaPods quirks) — I'll fix
  any hiccup when we run it.
- The old Expo attempt (`C:\DA-Bot\tsevera`) is **not** this path and can be ignored/deleted.
