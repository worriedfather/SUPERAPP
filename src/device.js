import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

export const isNative = () => Capacitor.isNativePlatform();

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

/* One position fix. Uses the native provider on Android, the browser elsewhere. */
export async function getFix({ timeout = 15000 } = {}) {
  if (isNative()) {
    const perm = await Geolocation.checkPermissions();
    if (perm.location !== "granted") {
      const asked = await Geolocation.requestPermissions();
      if (asked.location !== "granted") throw Object.assign(new Error("denied"), { code: 1 });
    }
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout });
    return { lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
  }
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(Object.assign(new Error("unsupported"), { code: 2 }));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      rej, { enableHighAccuracy: true, timeout, maximumAge: 0 });
  });
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
