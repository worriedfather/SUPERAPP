import React, { useState, useEffect, useRef } from "react";
import { signIn } from "./api";
import { bioStatus, bioEnabled, bioUser, bioEnable, bioGet } from "./biometric";
import { isNative } from "./device";
import { APP_VERSION } from "./config";

/* PIN sign-in — branded to the DA fuel-card palette (navy + lime).
   Optional biometric (fingerprint/face) sign-in: after a PIN login the app offers
   to remember the credential in the device keystore; next time a fingerprint signs in. */
export default function Login({ onSignedIn }) {
  const [login, setLogin] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [bio, setBio] = useState({ native: isNative(), available: false, reason: "" });
  const [offer, setOffer] = useState(null);   // { me, username, pin } → offer to enable biometrics

  useEffect(() => { bioStatus().then(setBio).catch(() => {}); }, []);
  const bioAvail = bio.available;
  const canBio = bioAvail && bioEnabled();

  // When biometric sign-in is already set up, prompt it automatically on open —
  // the user just presents a fingerprint/face instead of tapping first.
  const autoTried = useRef(false);
  useEffect(() => {
    if (bioAvail && bioEnabled() && !autoTried.current && !offer && !busy) { autoTried.current = true; doBio(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bioAvail]);

  const finish = async (me, username, pinVal) => {
    // after a successful PIN login, offer to turn on biometric sign-in. We offer
    // whenever this is the native app and it isn't on yet — even if the device
    // currently reports "unavailable" — so the offer can explain the reason (e.g.
    // "enrol a fingerprint") instead of silently doing nothing.
    if (bio.native && !bioEnabled()) { setOffer({ me, username, pin: pinVal }); return; }
    onSignedIn(me);
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const me = await signIn(login.trim(), pin); await finish(me, login.trim(), pin); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };

  const doBio = async () => {
    setBusy(true); setErr(null);
    try { const c = await bioGet(); const me = await signIn(c.username, c.pin); onSignedIn(me); }
    catch (x) { setErr(x.message === "biometrics unavailable" ? "Biometric sign-in isn't set up" : (x.message || "Sign-in cancelled")); }
    finally { setBusy(false); }
  };

  const enableBio = async () => {
    setBusy(true); setErr(null);
    try {
      await bioEnable(offer.username, offer.pin);
    } catch (e) {
      // Surface the reason instead of silently signing in without enabling.
      setErr("Couldn't turn on biometrics: " + (e.message || e)); setBusy(false); return;
    }
    const me = offer.me; setOffer(null); setBusy(false); onSignedIn(me);
  };

  const C = { navy: "#14213D", ink: "#1B2A4A", blue: "#2B3990", lime: "#6BC048", line: "#E3E8F1", steel: "#5B6B84", red: "#D63B2E" };
  const lbl = { fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontSize: 12, letterSpacing: ".06em", color: C.steel, fontWeight: 600, display: "block", marginBottom: 7 };
  const input = { fontFamily: "'DM Mono','Roboto Mono',monospace", fontSize: 16, padding: "13px 14px", border: `1.5px solid ${C.line}`, borderRadius: 11, background: "#fff", width: "100%", color: C.ink, boxSizing: "border-box" };
  const canSubmit = !busy && login && pin;
  const Fingerprint = ({ color }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 11a2 2 0 0 1 2 2c0 3-1 5-2 6.5" /><path d="M8.5 8.5A5 5 0 0 1 17 12c0 2-.3 4-1 6" />
      <path d="M5.5 11a6.5 6.5 0 0 1 12-3.4" /><path d="M9 13c0 3-.7 5-1.5 6.3" /><path d="M12 7a5 5 0 0 0-2.4.6" />
    </svg>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(165deg,#1F2E52 0%,#0F1A31 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom))", fontFamily: "'Barlow',system-ui,sans-serif", color: "#EAF0FA" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .lgin:focus{border-color:${C.blue}!important;box-shadow:0 0 0 4px rgba(43,57,144,.18);outline:none}
        .lgin::placeholder{color:#9AA6B8}`}</style>

      <div style={{ width: "100%", maxWidth: 384, animation: "rise .3s ease both" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img src="/da-wordmark.png" alt="Daniel Aguiar Motors" style={{ width: "min(248px,74%)", height: "auto", filter: "drop-shadow(0 10px 24px rgba(0,0,0,.4))" }} />
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontSize: 26, fontWeight: 800, letterSpacing: ".2em", marginTop: 16, lineHeight: 1, color: "#EAF0FA" }}>
            <span style={{ color: C.lime }}>OPS</span>
          </div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontSize: 12.5, letterSpacing: ".14em", color: "#9FB0D0", marginTop: 10 }}>
            Retail · Logistics · Fleet · Workshop
          </div>
        </div>

        <form onSubmit={submit} style={{ background: "#fff", color: C.ink, borderRadius: 18, padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,.40)" }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontSize: 16, fontWeight: 700, letterSpacing: ".04em", marginBottom: 16 }}>Sign in</div>

          {canBio && (
            <>
              <button type="button" onClick={doBio} disabled={busy}
                style={{ width: "100%", padding: 13, marginBottom: 14, borderRadius: 12, border: `1.5px solid ${C.line}`, background: "#F7FAF4", color: C.navy, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 9, fontWeight: 700, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: ".04em", fontSize: 14.5 }}>
                <Fingerprint color={C.lime} /> Sign in as {bioUser()}
              </button>
              <div style={{ textAlign: "center", fontSize: 11, color: C.steel, marginBottom: 14 }}>or use your PIN</div>
            </>
          )}

          <label style={{ display: "block", marginBottom: 14 }}>
            <span style={lbl}>Username</span>
            <input className="lgin" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" placeholder="e.g. tsevera" style={input} />
          </label>
          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={lbl}>PIN</span>
            <input className="lgin" value={pin} onChange={(e) => setPin(e.target.value)} type="password" inputMode="numeric" autoComplete="current-password" placeholder="••••" style={input} />
          </label>

          {err && (
            <div style={{ background: "#FDECEA", border: `1px solid ${C.red}`, borderRadius: 11, padding: "10px 12px", marginBottom: 16, fontSize: 13, color: C.red }}>{err}</div>
          )}

          {bio.native && !bioAvail && !bioEnabled() && bio.reason && (
            <div style={{ fontSize: 11.5, color: C.steel, marginBottom: 14, lineHeight: 1.5, textAlign: "center" }}>
              Fingerprint sign-in off — {bio.reason}
            </div>
          )}

          <button type="submit" disabled={!canSubmit}
            style={{ width: "100%", padding: 15, fontSize: 15, fontWeight: 700, borderRadius: 12, border: "none", cursor: canSubmit ? "pointer" : "default",
              fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: ".05em",
              background: canSubmit ? C.blue : "#C7CEDC", color: "#fff", boxShadow: canSubmit ? "0 10px 22px rgba(43,57,144,.30)" : "none", transition: "background .15s, box-shadow .15s, transform .08s" }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div style={{ textAlign: "center", fontSize: 11, color: "#5E6F94", marginTop: 20, lineHeight: 1.7 }}>
          DA OPS v{APP_VERSION} · © 2026 Daniel Aguiar Motors
        </div>
      </div>

      {offer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,18,35,.6)", display: "grid", placeItems: "center", padding: 22, zIndex: 50 }}>
          <div style={{ background: "#fff", color: C.ink, borderRadius: 18, padding: 24, maxWidth: 360, width: "100%", textAlign: "center", boxShadow: "0 24px 60px rgba(0,0,0,.4)" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "#F0F7EA", display: "grid", placeItems: "center", margin: "0 auto 12px" }}><Fingerprint color={C.lime} /></div>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontSize: 18, fontWeight: 700 }}>Faster sign-in?</div>
            <div style={{ fontSize: 13.5, color: C.steel, margin: "8px 0 18px", lineHeight: 1.5 }}>Use your fingerprint or face next time instead of typing your PIN.</div>
            {!bioAvail && bio.reason && (
              <div style={{ background: "#FFF6E8", border: "1px solid #E5A93B", borderRadius: 10, padding: "9px 11px", marginBottom: 12, fontSize: 12.5, color: "#8A5A00", textAlign: "left" }}>{bio.reason}</div>
            )}
            {err && <div style={{ background: "#FDECEA", border: `1px solid ${C.red}`, borderRadius: 10, padding: "9px 11px", marginBottom: 12, fontSize: 12.5, color: C.red, textAlign: "left" }}>{err}</div>}
            <button onClick={enableBio} disabled={busy} style={{ width: "100%", padding: 14, borderRadius: 12, border: "none", background: C.blue, color: "#fff", fontWeight: 700, fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: ".04em", cursor: "pointer", marginBottom: 8 }}>{bioAvail ? "Turn on biometrics" : "Try anyway"}</button>
            <button onClick={() => { const me = offer.me; setOffer(null); onSignedIn(me); }} style={{ width: "100%", padding: 12, borderRadius: 12, border: "none", background: "none", color: C.steel, fontWeight: 600, cursor: "pointer" }}>Not now</button>
          </div>
        </div>
      )}
    </div>
  );
}
