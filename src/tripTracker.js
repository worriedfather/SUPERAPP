// tripTracker.js — driver-side GPS breadcrumb streaming while a delivery trip is
// live. From the fuel request (or collection) until the last offload, location is
// recorded under an Android FOREGROUND SERVICE (a persistent "trip in progress"
// notification) and streamed to the server as evidence. Tracking auto-stops when
// the server reports the trip is no longer active (delivered / cancelled).
//
// WHY NATIVE DELIVERY (2026-10-15): until build 210 the service handed every fix to
// THIS JavaScript, which buffered and POSTed it. @capgo treats that mode as "the
// service must not outlive the app": START_NOT_STICKY, stopped when the driver
// swipes the app away, stopped when Android recycles the WebView activity to
// free memory (which low-RAM phones do within minutes of backgrounding). So the
// route recorded only while the app was open — 178 trips, 6 usable tracks.
// Giving the plugin a `url` + auth headers switches it to NATIVE delivery: the
// service POSTs each fix itself from Java, is START_STICKY (the OS restarts it),
// survives task-removal and the WebView being killed, and persists its config so
// a restarted service keeps going without any JS. The JS callback still runs when
// the app is open (offline outbox + instant "trip done" detection); the server
// de-duplicates the fix that arrives by both paths.
import { Capacitor } from "@capacitor/core";
import { BackgroundGeolocation } from "@capgo/background-geolocation";
import { postTripPing, getServer, nativeAuthHeaders } from "./api";

const ACTIVE_KEY = "da_active_trip";     // { tripNo, since } — survives app restarts
const native = () => { try { return Capacitor.isNativePlatform(); } catch { return false; } };

let watching = false;
let buffer = [];
let flushTimer = null;
let lastError = null;   // why the last start failed (permission / service), for the driver's home screen

// What the driver's home shows: is a trip marked active, and is the location service actually running?
export function trackingState() { return { active: activeTrip(), watching, lastError }; }

export function activeTrip() {
  try { return JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null"); } catch { return null; }
}

const pingUrl = (tripNo) => `${getServer()}/api/trip/${encodeURIComponent(tripNo)}/ping`;

async function flush(tripNo) {
  if (!buffer.length) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    const r = await postTripPing(tripNo, batch);
    if (r && r.ignored) await stopTracking();   // server says the trip is done → stop
  } catch { /* offline: the api outbox queued it; drop from our buffer either way */ }
}

export async function startTracking(tripNo) {
  if (!tripNo) return;
  localStorage.setItem(ACTIVE_KEY, JSON.stringify({ tripNo, since: Date.now() }));
  if (!native() || watching) return;           // on web we only persist the flag
  const headers = nativeAuthHeaders();
  try {
    await BackgroundGeolocation.start(
      {
        // Foreground service: persistent notification + location updates while the
        // driver DRIVES with the phone in a pocket / the app backgrounded.
        backgroundMessage: "Recording this delivery's route",
        backgroundTitle: "DA OPS — trip in progress",
        requestPermissions: true,
        // HEARTBEAT, not movement-only (build 212, owner 2026-10-21 "we can't have silence"): with a
        // distance filter the plugin suppresses fixes while the vehicle is parked, so a truck
        // offloading or queuing at the gantry looked exactly like a dead phone. distanceFilter 0 +
        // a 60 s interval = a position every minute whether moving or not; silence now means
        // the phone really stopped. The service already holds the GPS, so the extra cost is small.
        distanceFilter: 0,
        minIntervalMs: 60000,
        // NATIVE delivery (see header): the service itself POSTs every fix here, with
        // the driver's bearer token + app headers (X-DA-App passes the bot filter).
        // The 30-day token outlives any trip; a sign-in refreshes it on the next start.
        ...(headers ? { url: pingUrl(tripNo), headers } : {}),
      },
      (loc, err) => {
        if (err || !loc) return;
        buffer.push({
          lat: loc.latitude, lon: loc.longitude,
          accuracy: loc.accuracy != null ? loc.accuracy : null,
          speed: loc.speed != null ? loc.speed : null,
          at: new Date(loc.time || loc.timestamp || Date.now()).toISOString(),
        });
        if (buffer.length >= 5) flush(tripNo);
      }
    );
    watching = true; lastError = null;
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = setInterval(() => flush(tripNo), 60000);   // also flush every minute
  } catch (e) {
    const msg = (e && e.message) || String(e);
    // The native service is already running (e.g. the WebView was recycled and this is a
    // fresh JS world): that is success, not failure — keep the flag, refresh its headers.
    if (/already started/i.test(msg) || (e && e.code === "ALREADY_STARTED")) {
      watching = true; lastError = null;
      if (headers) { try { await BackgroundGeolocation.updateHeaders({ headers }); } catch { /* ignore */ } }
      return;
    }
    lastError = msg;   /* permission denied / location off — the flag stays set, retry on next open */
  }
}

export async function stopTracking() {
  const at = activeTrip();
  localStorage.removeItem(ACTIVE_KEY);
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  if (at) { try { await flush(at.tripNo); } catch { /* ignore */ } }
  // Stop the native service UNCONDITIONALLY (not only when this JS world started it):
  // after a WebView recycle `watching` is false here while the service is still running.
  if (native()) { try { await BackgroundGeolocation.stop(); } catch { /* not running — fine */ } }
  watching = false; buffer = [];
}

// Call on app open: if a trip is still marked active, resume recording; if none is,
// make sure no orphaned native service keeps posting for a trip that already ended.
export async function resumeTracking() {
  const at = activeTrip();
  if (at && at.tripNo) return startTracking(at.tripNo);
  if (native()) { try { await BackgroundGeolocation.stop(); } catch { /* ignore */ } }
}
