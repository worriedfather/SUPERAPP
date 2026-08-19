# DA Fleet Manager — Pilot Go-Live Runbook

A small-group pilot: a handful of drivers + the approver, reachable from any forecourt
over a Cloudflare Tunnel, on your existing Harare/office box. Data stays in-country.

Everything in **Part A** is already done in code/config. **Parts B–E** are the steps
you run on the server box and the phones.

---

## A. Already hardened (done)

- **GPS test-spoofer OFF** (`TEST_GPS=false`). The location check now uses the real
  phone GPS only.
- **Secrets rotated** — the `da_app` database password and the JWT signing secret are
  now strong random values (in `server/.env`; not printed anywhere). The old
  `change-me-before-go-live` values are gone.
- **Driver + staff PINs reset** to fresh random 4-digit codes. The handout list is
  `PILOT_PINS.csv` in the project root. **Give each pilot driver their PIN, then delete
  that file.** The database only stores hashes — there is no other copy.
- New pilot APK built and **pointed at `https://fuel.dasuperapp.com`** — drivers do
  not need to set a server address.
- **Cloudflare Tunnel is live** (`fuel.dasuperapp.com` → local API) and the API +
  tunnel both run under **pm2**, set to resume on reboot. (Your existing CCTV tunnel
  is untouched.) Manage with: `pm2 status`, `pm2 restart da-fuel-api`, `pm2 logs`.

> Known pilot limitations (accepted for now): no offline queue (a request needs signal
> when sent); geo-lock is loose (25 km) until the 53 stations are surveyed; OCR is
> on-device. None block the pilot — just brief the drivers.

---

## B. Put the server on the internet — Cloudflare Tunnel

Runs on the same Windows box as Postgres + the Node server. No port-forwarding, no
static IP, free, and gives HTTPS. **A stable hostname needs a domain on your Cloudflare
account** (free plan is fine).

1. **Install cloudflared** (PowerShell as admin):
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
2. **Log in** (opens a browser; pick the domain you'll use):
   ```powershell
   cloudflared tunnel login
   ```
3. **Create the tunnel** and note the tunnel ID it prints:
   ```powershell
   cloudflared tunnel create da-fuel
   ```
4. **Give it a hostname** (replace `example.com` with your domain):
   ```powershell
   cloudflared tunnel route dns da-fuel fuel.example.com
   ```
5. **Point it at the local server.** Create `C:\Users\tinas\.cloudflared\config.yml`:
   ```yaml
   tunnel: da-fuel
   credentials-file: C:\Users\tinas\.cloudflared\<TUNNEL-ID>.json
   ingress:
     - hostname: fuel.example.com
       service: http://localhost:4000
     - service: http_status:404
   ```
6. **Run it as a service** so it survives reboots:
   ```powershell
   cloudflared service install
   ```
   The API is now live at `https://fuel.example.com` (test it: open
   `https://fuel.example.com/api/health` → should show `{"ok":true}`).

> No domain yet? A quick tunnel works for a same-day test —
> `cloudflared tunnel --url http://localhost:4000` — but its URL changes every restart,
> so you'd re-enter it on each phone each time. Get a domain for the real pilot.

**Once you have the stable `https://fuel.example.com`, send it to me and I'll bake it
into a final APK** so drivers never touch the server setting. Until then, use step D.

---

## C. Keep the server running through reboots & load-shedding

- **PostgreSQL** already runs as a Windows service — nothing to do.
- **The Node API** must auto-start. Simplest reliable option — `pm2`:
  ```powershell
  npm install -g pm2 pm2-windows-startup
  pm2-startup install
  cd C:\DA-Bot\dafuel\server
  pm2 start index.js --name da-fuel-api
  pm2 save
  ```
  (Whenever you change `server/.env` or server code: `pm2 restart da-fuel-api`.)
- **UPS on the box.** Load-shedding is the failure mode that matters. A small UPS that
  carries the box + router for a shedding window keeps the pilot alive. When power is
  fully out, requests just fail to send until it's back — acceptable for a pilot.

---

## D. Set up the phones (pilot group only)

For each pilot phone:

1. **Install the app.** Copy `app-debug.apk` to the phone (USB, or `adb install`), tap
   to install. Samsung: turn **Auto Blocker OFF** (Settings → Security & privacy) or it
   refuses the sideload.
2. **Point it at the server.** Open the app → on the sign-in screen tap
   **"Can't connect? Server settings"** → paste `https://fuel.example.com` → **Save**.
   (Skip this step once I've baked the URL into the final APK.)
3. **Sign in** with the driver's username + new PIN from `PILOT_PINS.csv`
   (e.g. `amudzingwa`). The approver signs in with the `approver` username + its new PIN.

---

## E. Go / no-go checklist

- [ ] `https://fuel.example.com/api/health` returns `{"ok":true}` from a phone on mobile data
- [ ] `da-fuel-api` shows **online** in `pm2 status`; survives a reboot
- [ ] Postgres service is running
- [ ] One test request end-to-end: driver raises → approver confirms → shows on the card
- [ ] Each pilot driver has their PIN; **`PILOT_PINS.csv` deleted afterwards**
- [ ] A nightly backup is scheduled (below)
- [ ] UPS on the server box

**Nightly backup** (Task Scheduler → daily). Full architecture (hot standby + WAL +
offsite) comes later; the pilot minimum is a nightly dump copied off the box:
```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U postgres -Fc dafuel `
  -f "D:\backups\dafuel-$(Get-Date -Format yyyyMMdd).dump"
```
Then copy that file somewhere off the box (OneDrive/USB). This is the append-only
ledger — it is the whole point of the system, so protect it.

---

## When the pilot widens

- Send me the final tunnel hostname → I bake it into the APK (no per-phone setup).
- Re-run `server/import/reset-pins.mjs` if you want fresh PINs for the wider group.
- Survey the station coordinates so the 25 km geo-lock can be tightened to 250 m.
- Then: offline queue, server-side OCR, and the hot-standby/WAL backup architecture.
