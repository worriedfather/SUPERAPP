import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { IOS_TESTFLIGHT_URL, PLAY_MARKET_URL } from "./config.js";

export const isNative = () => Capacitor.isNativePlatform();
export const isIOS = () => { try { return Capacitor.getPlatform() === "ios"; } catch { return false; } };

/* Send the user to UPDATE through the store the app came from — TestFlight on iPhone,
   Google Play on Android — never the browser / APK (the app is on both stores now).
   A custom scheme (itms-beta:// / market://) is handed to the OS by the WebView, which
   opens the store APP on our listing while our WebView stays put; an https link would
   navigate the app itself away (Android) or fail to hand off (iOS universal links don't
   fire from inside an app). Web builds just reload to pick up the new bundle. */
export const openStoreForUpdate = () => {
  try {
    if (!isNative()) { window.location.reload(); return; }
    window.location.href = isIOS() ? IOS_TESTFLIGHT_URL : PLAY_MARKET_URL;
  } catch { /* ignore */ }
};

// True in any packaged MOBILE app — the Capacitor build (Android) OR the iOS
// WebView shell (which tags its user-agent "DAOPSMobile" and sets window
// .__DAOPS_SHELL). Used to hide desktop-only screens (e.g. Master data) on phones.
export const isMobileApp = () => {
  try {
    if (Capacitor.isNativePlatform()) return true;
    if (typeof window !== "undefined" && window.__DAOPS_SHELL) return true;
    if (typeof navigator !== "undefined" && /DAOPSMobile/i.test(navigator.userAgent || "")) return true;
  } catch { /* ignore */ }
  return false;
};

/* One position fix. Uses the native provider on Android, the browser elsewhere.
   Error codes: 1 = permission denied · 3 = LOCATION SERVICES OFF (GPS switched off
   in the phone's settings — a different problem from a weak signal) · else no fix. */
export async function getFix({ timeout = 15000 } = {}) {
  if (isNative()) {
    // the WHOLE native flow classifies — Android throws "location disabled" from
    // checkPermissions() itself when GPS is off, not just from getCurrentPosition
    try {
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== "granted") {
        const asked = await Geolocation.requestPermissions();
        if (asked.location !== "granted") throw Object.assign(new Error("denied"), { code: 1 });
      }
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout });
      return { lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
    } catch (e) {
      if (/disabled|not enabled|turned off|location services|unavailable/i.test(String(e && e.message))) throw Object.assign(new Error("gps off"), { code: 3 });
      throw e;
    }
  }
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(Object.assign(new Error("unsupported"), { code: 2 }));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (e) => rej(e && e.code === 2 ? Object.assign(new Error("gps off"), { code: 3 }) : e),
      { enableHighAccuracy: true, timeout, maximumAge: 0 });
  });
}

/* Open the phone's own Location settings screen so the driver can flip GPS on.
   Returns true if the settings screen was opened (needs the native plugin, so
   only on an app build that carries it — callers show instructions otherwise). */
export async function openLocationSettings() {
  try {
    if (!isNative()) return false;
    const mod = await import("capacitor-native-settings");
    const { NativeSettings, AndroidSettings, IOSSettings } = mod;
    if (Capacitor.getPlatform() === "ios") await NativeSettings.openIOS({ option: IOSSettings.App });
    else await NativeSettings.openAndroid({ option: AndroidSettings.Location });
    return true;
  } catch { return false; }
}

/* Cheap probe: are the phone's location services ON? (Android rejects the
   permission check itself when GPS is off — no fix attempt, no battery cost.) */
export async function gpsEnabled() {
  if (!isNative()) return true;
  try { await Geolocation.checkPermissions(); return true; }
  catch (e) { return !/disabled|not enabled|turned off|location services/i.test(String(e && e.message)); }
}

/* Ask for location the moment the app opens, so the driver is never stopped at the pump. */
export async function primeLocation() {
  try {
    if (isNative()) {
      const p = await Geolocation.checkPermissions();
      if (p.location === "denied") return "blocked";
      if (p.location !== "granted") {
        const a = await Geolocation.requestPermissions();
        return a.location === "granted" ? "ok" : "blocked";
      }
      return "ok";
    }
    if (!navigator.permissions) return "unknown";
    const p = await navigator.permissions.query({ name: "geolocation" });
    if (p.state === "denied") return "blocked";
    if (p.state === "prompt") navigator.geolocation.getCurrentPosition(() => {}, () => {}, { timeout: 8000 });
    return "ok";
  } catch { return "unknown"; }
}

/* Photograph of the odometer. Returns { dataUrl, blob } for OCR and upload. */
export async function takeOdometerPhoto() {
  if (isNative()) {
    const photo = await Camera.getPhoto({
      quality: 70, allowEditing: false, resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera, correctOrientation: true, width: 1600,
    });
    const blob = await (await fetch(photo.dataUrl)).blob();
    return { dataUrl: photo.dataUrl, blob };
  }
  return new Promise((res, rej) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = "image/*"; i.capture = "environment";
    i.onchange = () => {
      const f = i.files && i.files[0];
      if (!f) return rej(new Error("no file"));
      // read as a base64 data URL so the photo can be both shown and uploaded
      const r = new FileReader();
      r.onload = () => res({ dataUrl: r.result, blob: f });
      r.onerror = () => rej(new Error("could not read the photo"));
      r.readAsDataURL(f);
    };
    i.click();
  });
}
