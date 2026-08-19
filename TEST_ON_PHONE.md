# Testing the DA Super App on a phone

This test build talks to the **backend on this laptop** (`192.168.100.69:4000`),
which runs the local PostgreSQL with the real pilot history **plus** the new
modules. Phone and laptop must be on the **same WiFi**.

## One-time setup on the laptop

1. **Open the firewall** for port 4000 (needs an **Administrator** PowerShell — run once):
   ```powershell
   New-NetFirewallRule -DisplayName 'DA Fuel API 4000' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4000 -Profile Private,Public
   ```
2. **Start the backend** (leave it running while testing):
   ```powershell
   cd C:\DA-Bot\dafuel\server ; node index.js
   ```
   Check from the laptop: open `http://localhost:4000/api/health` → `{"ok":true}`.
   From the phone's browser: `http://192.168.100.69:4000/api/health` → same.
   (If the laptop's WiFi IP changed, run `ipconfig`, update `.env.production`,
   rebuild — or just set the server in-app: Login screen → server settings.)

## Install the APK

Phone connected by USB with **USB debugging allowed** (tap the prompt on the
phone — it currently shows "unauthorized"):
```powershell
C:\Users\tinas\AppData\Local\Android\Sdk\platform-tools\adb.exe install -r C:\DA-Bot\dafuel\android\app\build\outputs\apk\debug\app-debug.apk
```
Or copy `app-debug.apk` to the phone and tap it (allow "install from unknown
sources"). App name: **DA Fleet Manager**.

## Test logins

| Role | Login | PIN | What they get |
|---|---|---|---|
| Admin | `admin` | 4906 | Everything: Request, Approve, **Retail**, **Logistics**, Card, Efficiency, Intelligence, Master data |
| Approver | `approver` | 3594 | Approve, **Retail**, **Logistics**, Efficiency, Intelligence, Master data |
| Depot | `depot` | 3690 | **Delivery**, **Recon**, **Logistics** |
| Site manager | create one → | (you set) | **Submit** (Stock / Price / Sales) for their site only |
| Driver | see `PILOT_PINS.csv` | " | Home, Request, My Card, **Delivery** |

**Create a site manager first** (as admin/approver): Master data → *Retail site
managers* → pick a site (e.g. Avondale), name, login, PIN → Create. Then sign in
as that manager.

## What to try

- **Site manager** → *Submit*: enter Stock (Blend/Diesel), Sales, and a Price
  survey (add competitor lines). Each confirms on screen. Note the site is fixed
  to theirs — they can't submit for another site.
- **Depot** → *Delivery*: fill a delivery note; the loss % previews live and
  flags red above 0.3%. Optionally photograph the paper note. → *Recon*: enter
  opening/receipts/deliveries/closing; management sees the reconciliation.
- **Admin/Approver** → *Retail*: pick today's date → see per-site Stock / Price /
  Sales, "who hasn't submitted", totals, low-stock and price-gap analysis.
  **Export CSV** opens in Excel. → *Logistics*: deliveries with loss + depot
  reconciliation, also exportable.
- **Verify integrity**: everything is append-only + hash-chained like fuel;
  `GET /api/verify` (admin) walks all 12 chains including the new tables.

## Test notifications (no Firebase needed)

On a **site manager** or **depot** submit screen there's a **🔔 Reminders** bar:
- Tap **Test** → a notification appears in ~4 seconds (allow the permission
  prompt the first time). This proves push works on the phone.
- **On/Off** toggles the daily reminders (site managers: 08:00 / 08:30 / 20:00;
  depot: 12:30 / 17:00). These fire on schedule even with the app closed.

Cross-user "site X is late → management's phone" alerts are the next step and
need a Firebase/FCM project (see `SUPERAPP_MODULES.md`).

## Going to production later

When ready to serve all phones over the internet again (not just office WiFi):
apply `db/superapp.sql` + `db/superapp-roles.sql` on the **Harare box**, run the
seed there, set `.env.production` back to `https://fuel.dasuperapp.com`, rebuild,
and distribute the APK. The Cloudflare tunnel already fronts that URL.
