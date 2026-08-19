/* Fingerprint / face sign-in via @aparajita/capacitor-biometric-auth.

   Why this plugin: the previous one (@capgo/capacitor-native-biometric) showed its
   prompt from a separate TRANSPARENT activity launched "for result". On the test
   Samsung that helper activity never displayed, leaving the main app paused and the
   whole WebView frozen (verifyIdentity() never returned). This plugin runs Android's
   BiometricPrompt INSIDE the main activity — no helper activity, no freeze.

   This plugin only does the biometric CHECK; it doesn't store secrets. So we keep the
   username + app-PIN in localStorage and only read them back AFTER a successful
   authenticate(). Threat model: convenience sign-in on the owner's own handset. */
import { isNative } from "./device.js";
import { BiometricAuth } from "@aparajita/capacitor-biometric-auth";

// Full status so the UI can explain why biometrics are off instead of hiding it.
export async function bioStatus() {
  if (!isNative()) return { native: false, available: false, reason: "Only on the installed app.", raw: "web" };
  try {
    const r = await BiometricAuth.checkBiometry();
    const raw = (() => { try { return JSON.stringify({ isAvailable: r.isAvailable, type: r.biometryType, strong: r.strongBiometryIsAvailable, code: r.code }); } catch { return String(r); } })();
    if (r.isAvailable) return { native: true, available: true, type: r.biometryType, reason: "ok", raw };
    return { native: true, available: false, type: r.biometryType, reason: r.reason || explain(r.code), raw };
  } catch (e) {
    return { native: true, available: false, reason: (e && e.message) || String(e), raw: "THREW: " + ((e && e.message) || e) };
  }
}

function explain(code) {
  const c = String(code || "").toLowerCase();
  if (c.includes("notenrolled")) return "No fingerprint or face is set up on this phone — add one in Settings › Security, then reopen the app.";
  if (c.includes("notavailable") || c.includes("nohardware")) return "This phone can't use biometrics right now.";
  if (c.includes("lockout")) return "Too many attempts — unlock the phone with your PIN, then try again.";
  return "Biometrics aren't available on this phone.";
}

// Back-compat shim (a couple of callers use this shape).
export async function bioAvailable() {
  const s = await bioStatus();
  return { available: s.available, type: s.type };
}

export const bioEnabled = () => { try { return localStorage.getItem("da_bio") === "1"; } catch { return false; } };
export const bioUser = () => { try { return localStorage.getItem("da_bio_user") || ""; } catch { return ""; } };

const AUTH_OPTS = {
  androidTitle: "DA OPS",
  cancelTitle: "Use PIN",
  // fall back to the device PIN/pattern if the fingerprint won't read — more robust,
  // and it still gates access to the stored app-PIN.
  allowDeviceCredential: true,
};

// Confirm identity, then remember the credential (called right after a PIN login).
export async function bioEnable(username, pin) {
  if (!isNative()) throw new Error("biometrics unavailable");
  await BiometricAuth.authenticate({ ...AUTH_OPTS, reason: "Confirm it's you to turn on quick sign-in", androidSubtitle: "Confirm your fingerprint" });
  try {
    localStorage.setItem("da_bio", "1");
    localStorage.setItem("da_bio_user", username);
    localStorage.setItem("da_bio_pin", String(pin));
  } catch { throw new Error("couldn't save the sign-in on this device"); }
}

// Prompt the fingerprint/face check, then return the stored username + PIN.
export async function bioGet() {
  if (!isNative()) throw new Error("biometrics unavailable");
  await BiometricAuth.authenticate({ ...AUTH_OPTS, reason: "Sign in to DA OPS", androidSubtitle: "Sign in with your fingerprint" });
  let u, p;
  try { u = localStorage.getItem("da_bio_user"); p = localStorage.getItem("da_bio_pin"); } catch { /* ignore */ }
  if (!u || !p) throw new Error("no saved sign-in — set it up again");
  return { username: u, pin: p };
}

export async function bioDisable() {
  try {
    localStorage.removeItem("da_bio");
    localStorage.removeItem("da_bio_user");
    localStorage.removeItem("da_bio_pin");
  } catch { /* ignore */ }
}
