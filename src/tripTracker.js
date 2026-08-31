// tripTracker.js — driver-side GPS breadcrumb streaming while a delivery trip is
// live. Once the driver confirms collection, location is recorded under an Android
// FOREGROUND SERVICE (a persistent "trip in progress" notification) and streamed to
// the server as evidence. Tracking auto-stops when the server reports the trip is
// no longer active (delivered / cancelled). If the driver kills the app, the gap in
// the breadcrumb is itself logged as a tracking gap — evidence, not a guess.
import { Capacitor } from "@capacitor/core";
import { BackgroundGeolocation } from "@capgo/background-geolocation";
import { postTripPing } from "./api";

const ACTIVE_KEY = "da_active_trip";     // { tripNo, since } — survives app restarts
const native = () => { try { return Capacitor.isNativePlatform(); } catch { return false; } };

let watching = false;
let buffer = [];
let flushTimer = null;

export function activeTrip() {
  try { return JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null"); } catch { return null; }
}

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
  try {
    await BackgroundGeolocation.start(
      {
        // BACKGROUND foreground-service: backgroundMessage/Title make @capgo run a
        // persistent "trip in progress" notification + location service, so the route
        // keeps recording while the driver DRIVES with the phone in a pocket / the app
        // backgrounded — the whole point of trip GPS. (Foreground-only recorded almost
        // nothing: drivers don't hold the app open while driving.) The earlier crash
        // was R8/minify stripping the plugin's metadata; minify is now disabled
        // (android/app/build.gradle), so the long-lived service is safe to re-enable.
        backgroundMessage: "Recording this delivery's route",
        backgroundTitle: "DA OPS — trip in progress",
        requestPermissions: true,
        distanceFilter: 50,        // a breadcrumb roughly every 50 m of movement…
        minIntervalMs: 30000,      // …and at most one every 30 s (lighter on battery)
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
    watching = true;
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = setInterval(() => flush(tripNo), 60000);   // also flush every minute
  } catch { /* permission denied / unavailable — the flag stays set, retry on next open */ }
}

export async function stopTracking() {
  const at = activeTrip();
  localStorage.removeItem(ACTIVE_KEY);
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  if (at) { try { await flush(at.tripNo); } catch { /* ignore */ } }
  if (native() && watching) { try { await BackgroundGeolocation.stop(); } catch { /* ignore */ } }
  watching = false; buffer = [];
}

// Call on app open: if a trip is still marked active, resume recording.
export async function resumeTracking() {
  const at = activeTrip();
  if (at && at.tripNo) await startTracking(at.tripNo);
}
