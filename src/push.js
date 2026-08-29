/* Firebase Cloud Messaging (FCM) push — the closed-app half of notifications.
   Local reminders (notify.js) and the in-app alert poll cover the app while it's
   open/backgrounded; this delivers "someone needs your action" even when the app
   is fully closed.

   Native only, and fully degrades: on web, when the plugin isn't present, or
   before Firebase is configured (no android/app/google-services.json), every call
   is a silent no-op — the app runs exactly as before. It "lights up" the moment
   the google-services.json is in the build and the server has its service-account.

   The server sends to channelId "da-ops" with data.tab, so a tapped notification
   deep-links to the relevant screen. */
import { isNative } from "./device.js";
import { registerPush } from "./api.js";

let started = false;

// Call once after sign-in. `onOpenTab(tab)` deep-links a tapped notification.
export async function initPush(onOpenTab) {
  if (started || !isNative()) return;
  started = true;
  let PN;
  try { PN = (await import("@capacitor/push-notifications")).PushNotifications; }
  catch { return; }   // plugin/native layer unavailable → no-op
  try {
    // high-importance channel matching the server's channelId (Android 8+)
    try {
      await PN.createChannel({ id: "da-ops", name: "DA OPS alerts",
        description: "Actionable operations alerts", importance: 5, visibility: 1, vibration: true });
    } catch { /* channels unsupported / already exists */ }

    let perm = await PN.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PN.requestPermissions();
    if (perm.receive !== "granted") return;

    PN.addListener("registration", (t) => { if (t?.value) registerPush(t.value, "android").catch(() => {}); });
    PN.addListener("registrationError", () => { /* Firebase not configured yet — silent */ });
    PN.addListener("pushNotificationActionPerformed", (a) => {
      const data = a?.notification?.data || {};
      // Forward the WHOLE payload, not just the tab — data.ref/trip/dn identify the
      // specific request / trip / delivery note so the tap lands on THAT item, not a
      // generic list. (See App.jsx: it focuses the item from these fields.)
      if (data.tab && typeof onOpenTab === "function") onOpenTab(data.tab, data);
    });
    // FOREGROUND pushes: Android does NOT display an FCM notification while the app
    // is open — mirror it as an immediate local notification so nothing is missed.
    PN.addListener("pushNotificationReceived", async (n) => {
      try {
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        await LocalNotifications.schedule({ notifications: [{
          id: Math.floor(Date.now() % 2147483647),
          title: n?.title || "DA OPS",
          body: n?.body || "",
          channelId: "da-ops",
          extra: n?.data || {},
        }] });
      } catch { /* display is best-effort — the in-app inbox still carries the task */ }
    });
    // Tapping a MIRRORED (local) notification must deep-link exactly like a real
    // push tap — without this listener every foreground-mirrored notification
    // dead-ends on the home screen (the payload rides in `extra`).
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      LocalNotifications.addListener("localNotificationActionPerformed", (a) => {
        const data = a?.notification?.extra || {};
        if (data.tab && typeof onOpenTab === "function") onOpenTab(data.tab, data);
      });
    } catch { /* plugin unavailable → mirrored taps just open the app */ }

    await PN.register();   // throws if google-services.json/FCM isn't set up — caught below
  } catch { /* Firebase not configured → degrade to no-op */ }
}
