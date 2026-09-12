/* App-activity telemetry — the client half. Answers "which screen, how long, how
   often" (owner, 2026-09-12): 'open' when the app becomes visible, 'screen' on every
   tab change, 'heartbeat' once a minute while visible (carrying the CURRENT screen),
   'close' when hidden. Events are buffered and posted in batches (every 60 s, on a
   screen change, and on hide) so the app never waits on it; a failed post is dropped —
   this is evidence of use, not a control. A new session id each time the app comes
   back to the foreground, so "sessions per day" ≈ times opened.
   Server: POST /api/activity → app_activity; read via /api/activity/user/:id. */
import { Capacitor } from "@capacitor/core";
import { postActivity } from "./api.js";
import { APP_BUILD } from "./config.js";

let buf = [], screen = null, sessionId = null, started = false, hb = null, tick = null, onVis = null;
const newSession = () => { sessionId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); };
const platform = () => { try { return Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web"; } catch { return "web"; } };
const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

async function flush() {
  if (!buf.length) return;
  const events = buf; buf = [];
  try { await postActivity({ events, platform: platform(), appBuild: APP_BUILD, sessionId }); }
  catch { /* never block or nag the app for telemetry */ }
}
const push = (event) => { buf.push({ event, screen, at: new Date().toISOString() }); if (buf.length >= 40) flush(); };

// Call on every tab change. Ignored until startActivity() has run.
export function trackScreen(tab) {
  if (!started || !tab || tab === screen) return;
  screen = String(tab);
  push("screen");
  flush();
}

// Call once after sign-in. Returns a stop function (call it on sign-out).
export function startActivity(initialTab) {
  if (started) return () => {};
  started = true;
  screen = initialTab ? String(initialTab) : null;
  newSession();
  push("open");
  hb = setInterval(() => { if (visible()) push("heartbeat"); }, 60000);
  tick = setInterval(flush, 60000);
  onVis = () => {
    if (visible()) { newSession(); push("open"); }
    else { push("close"); flush(); }
  };
  try { document.addEventListener("visibilitychange", onVis); window.addEventListener("pagehide", flush); } catch { /* non-browser */ }
  return () => {
    started = false;
    clearInterval(hb); clearInterval(tick);
    try { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", flush); } catch { /* ignore */ }
    push("close"); flush();
  };
}
