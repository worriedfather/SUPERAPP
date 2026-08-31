/* Local scheduled reminders — the in-app replacement for the WhatsApp bots'
   cron nudges ("submit your stock", "recon due"). These are scheduled ON the
   device (Capacitor LocalNotifications), so they fire at the set time even with
   the app closed, and need NO server and NO Firebase.

   Cross-user "site X is late" alerts to management are a separate feature that
   needs FCM (a Firebase project) — see SUPERAPP_MODULES.md. This module covers
   the high-frequency submitter reminders, which is where the daily value is. */
import { isNative } from "./device.js";
import { getAlerts } from "./api.js";

let LN = null;
async function ln() {
  if (!isNative()) return null;
  try {
    if (!LN) LN = (await import("@capacitor/local-notifications")).LocalNotifications;
    return LN;
  } catch { return null; }   // plugin missing / failed to load → degrade, never throw
}

const REMEMBER = "da_reminders"; // "on" | "off"
export const remindersOn = () => localStorage.getItem(REMEMBER) !== "off";
export const setRemindersOn = (on) => localStorage.setItem(REMEMBER, on ? "on" : "off");

// Reminder set per role. Ids are stable so we can cancel/reschedule cleanly.
function planFor(kind, site) {
  const who = site ? ` for ${site}` : "";
  // `tab` deep-links a TAPPED reminder straight to the screen where the person acts,
  // so a reminder never dead-ends on tap.
  if (kind === "site_manager" || kind === "retail_supervisor") return [
    { id: 101, hour: 8,  minute: 0,  title: "DA price survey", body: `Submit today's price survey${who}.`, tab: "submit" },
    { id: 102, hour: 8,  minute: 30, title: "DA night-shift figures", body: `Submit night-shift stock & sales${who}.`, tab: "submit" },
    { id: 103, hour: 20, minute: 0,  title: "DA day-shift figures", body: `Submit day-shift stock & sales${who}.`, tab: "submit" },
  ];
  if (kind === "depot" || kind === "logistics") return [
    { id: 111, hour: 12, minute: 30, title: "DA reconciliation", body: "Submit today's warehouse reconciliation (Msasa / Feruka / Bulawayo).", tab: "recon" },
    { id: 112, hour: 17, minute: 0,  title: "DA delivery notes", body: "Log today's delivery notes.", tab: "deliver" },
  ];
  if (kind === "yard") return [
    { id: 121, hour: 8,  minute: 0,  title: "DA workshop — morning update", body: "Log the morning status on trucks in the workshop.", tab: "yardwork" },
    { id: 122, hour: 17, minute: 0,  title: "DA workshop — evening update", body: "Log the end-of-day status on trucks in the workshop.", tab: "yardwork" },
  ];
  return [];
}

// ---- actionable alerts: foreground/resume poll → local notification + badge ----
// Compares the current alert set to what was last seen on this device; anything
// NEW (or grown) raises a local notification so the person knows to act. Returns
// { count, items } for the in-app badge. Push (FCM) covers the app-closed case
// once Firebase is configured; this covers open/resumed and needs no server push.
const SEEN = "da_alerts_seen";
export async function checkAlerts({ notify = true } = {}) {
  let a;
  try { a = await getAlerts(); } catch { return null; }
  const items = (a && a.items) || [];
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(SEEN) || "{}"); } catch { seen = {}; }
  const fresh = items.filter((it) => (it.count || 0) > (seen[it.type] || 0));
  if (notify && fresh.length) {
    const L = await ln();
    if (L) {
      try {
        const perm = await L.requestPermissions();
        if (perm.display === "granted") {
          await L.schedule({ notifications: fresh.map((it, i) => ({
            id: 200 + (typeof it.type === "string" ? it.type.length + i : i),
            title: it.title, body: it.body,
            schedule: { at: new Date(Date.now() + 800 + i * 400) },
            extra: { tab: it.tab, ref: it.ref, trip: it.trip, dn: it.dn, site: it.site },
          })) });
        }
      } catch { /* ignore */ }
    } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      fresh.forEach((it) => new Notification(it.title, { body: it.body }));
    }
  }
  const next = {}; items.forEach((it) => { next[it.type] = it.count || 0; });
  try { localStorage.setItem(SEEN, JSON.stringify(next)); } catch { /* ignore */ }
  return { count: a?.count || 0, items };
}

// Deep-link a TAPPED local reminder to its screen + item (mirrors the FCM push tap
// handler in push.js). Without this, tapping a scheduled reminder does nothing.
let lnTapWired = false;
export async function initLocalNotificationTaps(onOpenTab) {
  if (lnTapWired) return;
  const L = await ln();
  if (!L) return;
  lnTapWired = true;
  try {
    L.addListener("localNotificationActionPerformed", (e) => {
      const extra = (e && e.notification && e.notification.extra) || {};
      // ALWAYS navigate — even a tab-less/stale notification opens the app to a real
      // screen (goFocus falls back to home/inbox) instead of dead-ending on tap.
      if (typeof onOpenTab === "function") onOpenTab(extra.tab || null, extra);
    });
  } catch { /* plugin without the listener API → no-op */ }
}

// Clear notifications already sitting in the tray — call on app open/resume so
// stale ones (from an earlier session/build, or already acted on in-app) don't
// linger and dead-end when tapped. Best-effort across local + push plugins.
export async function clearDeliveredNotifications() {
  const L = await ln();
  if (L) { try { await L.removeAllDeliveredNotifications(); } catch { /* ignore */ } }
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.removeAllDeliveredNotifications();
  } catch { /* plugin absent / web → nothing to clear */ }
}

export async function requestPermission() {
  const L = await ln();
  if (!L) return "web";
  try { const r = await L.requestPermissions(); return r.display; } // 'granted' | 'denied' | 'prompt'
  catch { return "unavailable"; }
}

// Cancel then (re)schedule this role's daily reminders. Safe to call on every
// sign-in. Honours the on/off toggle.
export async function syncReminders(kind, site) {
  const L = await ln();
  const plan = planFor(kind, site);
  if (!L) return { scheduled: 0, native: false };
  const ids = plan.map((p) => ({ id: p.id }));
  try {
    try { await L.cancel({ notifications: ids }); } catch { /* nothing pending */ }
    if (!remindersOn() || plan.length === 0) return { scheduled: 0, native: true };
    const perm = await L.requestPermissions();
    if (perm.display !== "granted") return { scheduled: 0, native: true, denied: true };
    await L.schedule({
      notifications: plan.map((p) => ({
        id: p.id, title: p.title, body: p.body,
        schedule: { on: { hour: p.hour, minute: p.minute }, allowWhileIdle: true },
        extra: { tab: p.tab },   // so a tapped reminder deep-links to its screen
      })),
    });
    return { scheduled: plan.length, native: true };
  } catch (e) {
    // e.g. exact-alarm permission not granted, or an OEM notification quirk.
    return { scheduled: 0, native: true, error: e?.message || "couldn't schedule reminders" };
  }
}

export async function cancelReminders(kind) {
  const L = await ln();
  if (!L) return;
  try { await L.cancel({ notifications: planFor(kind).map((p) => ({ id: p.id })) }); } catch { /* none */ }
}

// Fire a notification a few seconds from now so the user can SEE it work.
// Native → LocalNotifications; browser (npm run dev) → Web Notification API.
export async function sendTestNotification() {
  const L = await ln();
  if (L) {
    try {
      const perm = await L.requestPermissions();
      if (perm.display !== "granted") return { ok: false, reason: "allow notifications in Settings first" };
      await L.schedule({
        notifications: [{
          id: 999, title: "DA OPS", body: "Test reminder — notifications are working.",
          schedule: { at: new Date(Date.now() + 4000) },
        }],
      });
      return { ok: true, in: 4 };
    } catch (e) {
      return { ok: false, reason: e?.message || "this device blocked the reminder" };
    }
  }
  // browser fallback (npm run dev)
  try {
    if (typeof Notification === "undefined") return { ok: false, reason: "notifications aren't supported here — install the app to use them" };
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: "allow notifications in your browser first" };
    new Notification("DA OPS", { body: "Test reminder — notifications are working." });
    return { ok: true, in: 0 };
  } catch (e) {
    return { ok: false, reason: e?.message || "couldn't send a test notification" };
  }
}
