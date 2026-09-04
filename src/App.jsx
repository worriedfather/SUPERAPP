import React, { useState, useEffect, useCallback, useRef } from "react";
import { STATIONS } from "./stations";
import { DRIVERS_SEED, HORSES_SEED, TRAILERS, RETAIL_VEH, FLEET_MEDIAN, HISTORY, DEST_NORM, EFF, ROUTE_PRIOR, LOCAL_KM, ZONES } from "./data";
import { resumeTracking, startTracking } from "./tripTracker.js";
import { getFix, primeLocation, takeOdometerPhoto, isNative, isMobileApp, isIOS, openLocationSettings, gpsEnabled } from "./device";
import { readOdometer } from "./ocr";
import Login from "./Login";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { currentUser, signedIn, signOut, getState, postRequest, postDecision, addDriver as apiAddDriver, getEfficiency, askIntelligence, getMyTrips, routeGoogle, outboxCount, flushOutbox, getHealth, getTripFuelContext } from "./api";
import { SiteSubmit, RetailDashboard, DeliverySubmit, DeliveryApprovals, WarehouseImports, ScheduleDelivery, LogisticsDashboard, SiteManagerCreate, ExecutiveDashboard, InventoryView, RetailRequest, YardWorkshop, TruckStatus, DetailSheet, Cockpit, WetstockView, CashView, CashInflows, SiteDeposit, CashOffice, CashflowView, OwnerDigest, RadarView, ApprovalsHistory, CashOutflows, DeliveriesDue, DriverPerformance, DriverLeague, ManagerBirdsEye, DeliveriesInProgress, ApprovedDeliveries, DeliveryFlow, TripMap, StaffAssignment, UnlockRequests, DeviceRequests, JourneyTracking, FeedbackView, ReleaseNotesModal, fmtD } from "./superapp.jsx";
import { syncReminders, checkAlerts, initLocalNotificationTaps, clearDeliveredNotifications } from "./notify.js";
import { initPush } from "./push.js";
import { GOOGLE_MAPS_KEY, APP_BUILD, APP_VERSION, PLAY_URL, APK_URL, IOS_URL } from "./config.js";
import { internalKm } from "./mileage.js";
import { Picker } from "./Picker.jsx";


/* -------- consumption split between town work and open road -------- */
const zoneOf = (n) => {
  const exact = Object.keys(ZONES).find((z) => ZONES[z].includes(n));
  if (exact) return exact;
  // Master-data names carry a city prefix ("Bulawayo Fort Street") that the seed ZONES
  // lists don't all have — infer the zone from the city word so a short intra-city hop
  // is costed as town, not highway.
  const s = String(n || "").toLowerCase();
  if (s.startsWith("bulawayo") || s.includes("cowdray")) return "BYO";
  if (s.startsWith("mutare") || s.includes("feruka")) return "MUT";
  if (s.startsWith("harare")) return "HRE";
  return "OTHER";
};
const effFor = (horse) => {
  const h = EFF.horse[horse];
  return { loc: h ? h.loc : EFF.local, hwy: h ? h.hwy : EFF.hwy, own: !!h, n: h ? h.nl + h.nh : 0 };
};
const routePrior = (a, b) => ROUTE_PRIOR[[a, b].sort().join("|")] || null;

/* TOLERANT station lookup. Site/depot names come from MASTER DATA (the site table,
   the trips logistics schedule) — drivers never type them — but the bundled station
   list can differ in FORMAT: case ("Zvishavane CBD" vs "Zvishavane Cbd"), punctuation,
   or a city prefix ("Bulawayo Cowdray Park" vs "Cowdray Park", "Gweru" vs "Gweru Amtec").
   An exact === match silently dropped the point and zeroed the fuel estimate, so the
   driver couldn't submit. Resolve by NORMALISED name, then by dropping/adding a leading
   city word, so any master-data spelling maps to the right coordinates. */
const _stnNorm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const _stnByNorm = new Map(STATIONS.map((s) => [_stnNorm(s.name), s]));
function findStation(name) {
  if (!name) return undefined;
  const n = _stnNorm(name);
  if (_stnByNorm.has(n)) return _stnByNorm.get(n);
  const w = n.split(" ");
  if (w.length > 1 && _stnByNorm.has(w.slice(1).join(" "))) return _stnByNorm.get(w.slice(1).join(" ")); // drop leading city
  for (const [k, v] of _stnByNorm) { if (k.startsWith(n + " ") || n.startsWith(k + " ") || k.endsWith(" " + n) || n.endsWith(" " + k)) return v; }
  return undefined;
}

/* Split a journey into town legs and highway legs and cost each properly. */
function estimate(names, legs, horse) {
  const e = effFor(horse);
  if (!legs || legs.length !== names.length - 1) return null;
  let locKm = 0, hwyKm = 0;
  const detail = [];
  for (let i = 0; i < legs.length; i++) {
    const a = names[i], b = names[i + 1], km = legs[i];
    const town = km < LOCAL_KM && zoneOf(a) === zoneOf(b) && zoneOf(a) !== "OTHER";
    if (town) locKm += km; else hwyKm += km;
    detail.push({ a, b, km, town, prior: routePrior(a, b) });
  }
  const litres = locKm / e.loc + hwyKm / e.hwy;
  return { locKm, hwyKm, litres, rounded: Math.ceil(litres / 10) * 10, e, detail,
           blended: (locKm + hwyKm) / litres };
}

function SplitPanel({ est, horse }) {
  if (!est) return null;
  const { locKm, hwyKm, e, detail } = est;
  return (
    <div style={{ background: "#fff", border: "1.5px solid var(--line)", borderRadius: 11, padding: 12, marginBottom: 10 }}>
      <span className="lbl">How the estimate is built</span>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div style={{ background: "#EFEDE4", borderRadius: 2, padding: "8px 10px" }}>
          <div className="lbl" style={{ marginBottom: 2 }}>Town work</div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{L(locKm)} km @ {e.loc.toFixed(2)}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--steel)" }}>{L(locKm / e.loc)} L</div>
        </div>
        <div style={{ background: "#EFEDE4", borderRadius: 2, padding: "8px 10px" }}>
          <div className="lbl" style={{ marginBottom: 2 }}>Open road</div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{L(hwyKm)} km @ {e.hwy.toFixed(2)}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--steel)" }}>{L(hwyKm / e.hwy)} L</div>
        </div>
      </div>
      <div className="mono" style={{ fontSize: 11, color: "var(--steel)", marginBottom: 8 }}>
        {e.own ? `${horse}'s own measured consumption, ${e.n} legs on record` : `fleet figures — ${horse} has too few measured legs of its own`}
        {" · blended "}{est.blended.toFixed(2)} km/L
      </div>
      <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <tbody>{detail.map((d, i) => (
          <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
            <td style={{ padding: "4px 2px", fontFamily: "Barlow" }}>{d.a} → {d.b}</td>
            <td style={{ padding: "4px 2px", textAlign: "right" }}>{L(d.km)} km</td>
            <td style={{ padding: "4px 2px", textAlign: "right", color: d.town ? "var(--amber)" : "var(--green)", fontWeight: 600 }}>
              {d.town ? "town" : "road"}</td>
            <td style={{ padding: "4px 2px", textAlign: "right", color: "var(--steel)" }}>
              {d.prior ? `${d.prior.kmpl.toFixed(2)} on ${d.prior.n} past runs` : "no prior"}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}


/* ---------------- routing ----------------
   Distance comes from Google Directions when a key is present, otherwise
   from the public OSRM road network, otherwise a straight-line estimate.
   Whichever was used is always stated on screen.                        */
let gmapsPromise = null;
const loadGoogle = (key) => {
  if (window.google && window.google.maps) return Promise.resolve();
  if (gmapsPromise) return gmapsPromise;
  gmapsPromise = new Promise((res, rej) => {
    const t = document.createElement("script");
    t.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=geometry`;
    t.async = true; t.onload = res; t.onerror = () => rej(new Error("Google Maps could not load — check the key."));
    document.head.appendChild(t);
  });
  return gmapsPromise;
};

// --- three independent distance sources; we triangulate and take the HIGHEST.
// Picking the max is deliberate: under-allocating a route quietly shorts the
// driver (see CLAUDE.md), so we err on the generous side of the three methods.
async function googleDist(pts) {
  // Google Directions via our server proxy (the JS SDK can't auth from the
  // WebView). The server geocodes each stop's street address to the exact
  // forecourt. Returns null so triangulation falls back to OSM/table on failure.
  try {
    const r = await routeGoogle(pts.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, address: p.address })));
    if (r && r.ok && r.km > 0) return { source: "Google Maps", km: r.km, legs: r.legs, poly: r.poly || null };
  } catch { /* fall through */ }
  return null;
}
async function osmDist(pts) {
  try {
    const c = pts.map((p) => `${p.lon},${p.lat}`).join(";");
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${c}?overview=false`);
    if (r.ok) {
      const d = await r.json();
      if (d.routes && d.routes[0]) {
        const legs = d.routes[0].legs.map((l) => Math.round(l.distance / 1000));
        return { source: "OpenStreetMap", km: Math.round(d.routes[0].distance / 1000), legs };
      }
    }
  } catch { /* ignore */ }
  return null;
}
// The "distance table": geodesic (great-circle) distance between surveyed site
// coordinates, scaled by a road-winding factor. No network, always available.
function tableDist(pts) {
  const legs = [];
  for (let i = 1; i < pts.length; i++) legs.push(Math.round(hav(pts[i - 1], pts[i]) * ROAD_FACTOR));
  return { source: "Distance table", km: legs.reduce((a, b) => a + b, 0), legs };
}

async function roadDistance(names, key) {
  const pts = names.map((n) => findStation(n)).filter(Boolean);
  if (pts.length < 2) return null;
  const [g, o] = await Promise.all([googleDist(pts), osmDist(pts)]);
  const iv = internalKm(names);
  // The internal lookup gives a single round-trip TOTAL. Spread it across the resolved
  // per-leg geodesic proportions so estimate() gets one leg per hop (names.length-1) and can
  // classify town vs road — a single [iv] lump made estimate() bail (null litres, "— — —"),
  // which blocked multi-stop routes like depot→drop→depot from submitting.
  const internal = iv ? (() => {
    const tl = tableDist(pts).legs, sum = tl.reduce((a, b) => a + b, 0);
    const legs = (tl.length === names.length - 1 && sum > 0) ? tl.map((l) => Math.round(l * iv / sum)) : [iv];
    return { source: "Internal estimate", km: iv, legs };
  })() : null;
  // triangulate across Google, OpenStreetMap and the internal estimate.
  const sources = [g, o, internal].filter((s) => s && s.km > 0);
  // last-resort only (all three unavailable) — a geodesic guess so a distance
  // still shows; not presented as one of the three sources.
  if (!sources.length) { const t = tableDist(pts); if (t.km > 0) sources.push(t); }
  // the estimate used for allocation is the HIGHEST of the sources
  const chosen = sources.reduce((a, b) => (b.km > a.km ? b : a), sources[0]);
  return {
    km: chosen.km, legs: chosen.legs, source: chosen.source, result: chosen.result,
    sources, picked: chosen.source,
  };
}

function useRoute(names, key) {
  const [r, setR] = useState(null);
  const sig = names.join("|");
  useEffect(() => {
    let dead = false;
    if (names.length < 2) { setR(null); return; }
    setR({ loading: true });
    roadDistance(names, key).then((x) => { if (!dead) setR(x); });
    return () => { dead = true; };
  }, [sig, key]);
  return r;
}

/* Google embed needs no key for the classic output=embed form */
const embedUrl = (names) => {
  const pts = names.map((n) => findStation(n)).filter(Boolean);
  if (pts.length < 2) return null;
  const ll = (p) => `${p.lat},${p.lon}`;
  const mid = pts.slice(1, -1).map((p) => "+to:" + ll(p)).join("");
  return `https://maps.google.com/maps?saddr=${ll(pts[0])}&daddr=${mid ? mid.slice(4) + "+to:" : ""}${ll(pts[pts.length - 1])}&output=embed`;
};


const gmapsUrl = (names) => {
  const pts = names.map((n) => findStation(n)).filter(Boolean);
  if (pts.length < 2) return null;
  const ll = (p) => `${p.lat},${p.lon}`;
  const mid = pts.slice(1, -1).map(ll).join("|");
  return "https://www.google.com/maps/dir/?api=1&origin=" + ll(pts[0]) +
    "&destination=" + ll(pts[pts.length - 1]) + (mid ? "&waypoints=" + encodeURIComponent(mid) : "") + "&travelmode=driving";
};

function RouteMap({ names, route, height = 300 }) {
  const pts = names.map((n) => findStation(n)).filter(Boolean);
  if (pts.length < 2) return null;
  const link = gmapsUrl(names);
  return (
    <div style={{ border: "1.5px solid var(--line)", borderRadius: 11, overflow: "hidden", background: "#E7E4D8" }}>
      <TripMap points={pts} poly={route && route.poly} height={height} />
      <div style={{ padding: "7px 10px", background: "#FBFAF6" }}>
        {route && !route.loading ? (
          route.sources && route.sources.length ? (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                {route.sources.map((s) => {
                  const on = s.source === route.picked;
                  return (
                    <span key={s.source} className="mono" style={{
                      fontSize: 11, padding: "2px 8px", borderRadius: 100,
                      background: on ? "var(--navy)" : "#fff", color: on ? "#fff" : "var(--steel)",
                      border: `1px solid ${on ? "var(--navy)" : "var(--line)"}`, fontWeight: on ? 700 : 500,
                    }}>{s.source} {L(s.km)}km{on ? " ✓" : ""}</span>
                  );
                })}
              </div>
              <span className="mono" style={{ fontSize: 11, color: "var(--steel)" }}>
                Triangulated across {route.sources.length} source{route.sources.length === 1 ? "" : "s"} — using the highest ({route.picked}).
              </span>
            </>
          ) : (
            <span className="mono" style={{ fontSize: 11, color: "var(--steel)" }}>Distance from <strong>{route.source}</strong></span>
          )
        ) : <span className="mono" style={{ fontSize: 11, color: "var(--steel)" }}>Working out the road distance…</span>}
        {link && <div style={{ marginTop: 5 }}><a href={link} target="_blank" rel="noreferrer" className="disp"
          style={{ fontSize: 12, fontWeight: 700, color: "var(--green)", textDecoration: "underline" }}>Open in Google Maps</a></div>}
      </div>
    </div>
  );
}
/* ---- history helpers ---- */
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const destMatch = (names) => {
  const tail = norm(names[names.length - 1]).split(" ")[0];
  const hits = Object.entries(DEST_NORM).filter(([k]) => k.includes(tail) && tail.length > 3);
  if (!hits.length) return null;
  const best = hits.sort((a, b) => b[1].n - a[1].n)[0];
  return { key: best[0], ...best[1] };
};




const ON_SITE_RADIUS_M = 250;
// Station coordinates are still APPROXIMATE (see stations.js) — some are km off.
// PILOT behaviour: capture the driver's real GPS and let them proceed, recording
// how far it is from the recorded point, rather than blocking a driver who really
// is at the station. Only a wildly-off fix (beyond this) is treated as wrong.
// Once the 53 forecourts are surveyed, drop this back to strict 250 m enforcement.
const SURVEY_TOLERANCE_M = 25000;
const ROAD_FACTOR = 1.25;
const PILFERAGE_TOLERANCE = 0.12;
const OCR_TOLERANCE = 5; // km difference allowed between typed and photographed reading

// TESTING ONLY — lets you fake the GPS to a chosen station so the driver flow
// can be exercised away from a real forecourt. MUST be false for the pilot —
// with it on, anyone could fake standing at a station.
const TEST_GPS = false;

const hav = (a, b) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const routeKm = (names) => {
  const p = names.map((n) => findStation(n)).filter(Boolean);
  let d = 0; for (let i = 1; i < p.length; i++) d += hav(p[i - 1], p[i]);
  return Math.round(d * ROAD_FACTOR);
};
// Format a litre/km figure. Guards against missing data so nothing ever renders
// as "NaN" — a blank value shows an em-dash instead.
// Accounting format: 0 dp, thousands separators, negatives in parentheses.
const L = (n) => {
  if (!Number.isFinite(Number(n))) return "—";
  const x = Math.round(Number(n));
  return x < 0 ? "(" + Math.abs(x).toLocaleString() + ")" : x.toLocaleString();
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
.da *{box-sizing:border-box}
.da{--navy:#14213D;--ink:#1B2A4A;--blue:#2B3990;--lime:#6BC048;
    --paper:#F2F1EC;--card:#FFFFFF;--green:#2B3990;--line:#E7E6DF;
    --steel:#5B6B84;--amber:#C07A00;--red:#D63B2E;--ok:#4C9E2A;
    --r:18px;--sh:0 1px 2px rgba(20,33,61,.04),0 10px 30px rgba(20,33,61,.06);
    --shlg:0 2px 6px rgba(20,33,61,.08),0 18px 40px rgba(20,33,61,.10);
    font-family:'Barlow',system-ui,sans-serif;color:var(--ink);background:var(--paper);min-height:100%;
    -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.da h1,.da h2,.da h3,.da .disp{font-family:'Barlow Condensed',sans-serif;letter-spacing:.01em;text-transform:uppercase}
.da .mono{font-family:'DM Mono','Roboto Mono',monospace;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.da button{font-family:inherit;cursor:pointer;border:none;transition:transform .08s ease,box-shadow .15s ease,background .15s ease,opacity .15s}
.da button:active:not(:disabled){transform:translateY(1px)}
.da button:disabled{cursor:not-allowed}
.da button:focus-visible,.da select:focus-visible,.da input:focus-visible{outline:3px solid rgba(43,57,144,.35);outline-offset:2px}
.da input,.da select,.da textarea{font-family:'Barlow',system-ui,sans-serif;font-size:14px;font-weight:500;padding:10px 12px;
   border:1.5px solid var(--line);border-radius:10px;background:#fff;width:100%;color:var(--ink);line-height:1.3;
   font-variant-numeric:tabular-nums;transition:border-color .15s,box-shadow .15s;-webkit-appearance:none;appearance:none}
.da input:focus,.da select:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(43,57,144,.10);outline:none}
.da input::placeholder{color:#9AA6B8}
.da select{background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='%235B6B84' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");background-repeat:no-repeat;background-position:right 11px center;padding-right:34px;text-overflow:ellipsis}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.da .lbl{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;font-size:11px;
   letter-spacing:.05em;color:var(--steel);font-weight:600;display:block;margin-bottom:5px}
.da .card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh)}
.da .appbar{background:linear-gradient(160deg,#1B2A4A,#14213D);color:#EAF0FA;position:sticky;top:0;z-index:20;
   padding:calc(10px + env(safe-area-inset-top)) 16px 13px;box-shadow:0 2px 16px rgba(20,33,61,.20)}
.da .bnav{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;justify-content:space-around;
   background:rgba(255,255,255,.92);backdrop-filter:blur(10px);border-top:1px solid var(--line);
   box-shadow:0 -2px 16px rgba(20,33,61,.08);padding:7px 6px calc(7px + env(safe-area-inset-bottom))}
.da .bnav button{background:none;display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px 8px;
   color:var(--steel);flex:1;min-width:0}
.da .bnav button.on{color:var(--blue)}
.da .bnav .bnl{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;font-size:10.5px;letter-spacing:.03em;font-weight:600}
.da .rise{animation:rise .22s ease both}
.da .cta{width:100%;padding:16px;font-size:15px;font-weight:700;border-radius:12px;letter-spacing:.03em;
   box-shadow:0 6px 16px rgba(43,57,144,.22)}
/* Tiimo-style pill buttons */
.da .pill{border-radius:100px;padding:13px 20px;font-weight:700;letter-spacing:.03em;font-size:14px;flex:1;
   background:var(--blue);color:#fff;box-shadow:0 8px 16px rgba(43,57,144,.22)}
.da .pill:disabled{background:#CDD3DE;color:#fff;box-shadow:none}
.da .pill-lime{background:var(--lime);color:#14213D;box-shadow:0 8px 16px rgba(107,192,72,.28)}
.da .pill-ghost{border-radius:100px;padding:13px 20px;font-weight:700;font-size:14px;background:#fff;color:var(--ink);border:1.5px solid var(--line);box-shadow:none}
/* ---- adaptive shell: bottom-nav on phones, a side rail on tablet/desktop ---- */
.da.shell{display:flex;min-height:100vh;align-items:stretch}
.da .side{width:240px;flex-shrink:0;background:linear-gradient(180deg,#1B2A4A,#14213D);color:#EAF0FA;
   position:sticky;top:0;height:100vh;display:flex;flex-direction:column;padding:16px 12px;box-shadow:2px 0 20px rgba(20,33,61,.14);z-index:10}
.da .side .brand{display:flex;align-items:center;gap:10px;padding:6px 8px 14px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,.10)}
.da .side .snav{display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:12px;background:none;color:#C4D0E8;
   font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.03em;font-weight:600;font-size:14.5px;text-align:left;width:100%;margin-bottom:2px}
.da .side .snav:hover{background:rgba(255,255,255,.07);color:#fff}
.da .side .snav.on{background:rgba(107,192,72,.16);color:#fff}
.da .side .snav.on svg{color:var(--lime)}
.da .side .snavsec{margin-top:14px}
.da .side .snavgroup{display:flex;align-items:center;gap:7px;margin:0 6px 6px;font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.07em;font-weight:700;font-size:11px;color:#8595B2}
.da .side .snavgroup .dot{width:7px;height:7px;border-radius:2px;flex-shrink:0}
.da .side .sfoot{margin-top:auto;padding-top:12px;border-top:1px solid rgba(255,255,255,.10);display:flex;align-items:center;gap:10px}
.da .wmain{flex:1;min-width:0;background:var(--paper)}
.da .wmain-inner{max-width:1080px;margin:0 auto;padding:26px 32px 64px}
.da .wrap{max-width:600px;margin:0 auto;padding:10px 14px 96px}
@media (min-width:900px){ .da .wrap{max-width:1000px;padding:6px 4px 40px} }
/* ---- Tiimo-style hub: colour-coded, tactile module cards ---- */
.da .hubgroup{display:flex;align-items:center;gap:8px;margin:0 4px 12px;font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.06em;font-weight:700;font-size:12.5px;color:var(--steel)}
.da .hubgroup .dot{width:9px;height:9px;border-radius:3px}
.da .hubgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:13px}
.da .hubcard{position:relative;overflow:hidden;text-align:left;padding:16px;border-radius:22px;background:#fff;border:1px solid var(--line);box-shadow:0 1px 2px rgba(20,33,61,.04),0 8px 22px rgba(20,33,61,.06);display:flex;flex-direction:column;gap:13px;align-items:flex-start;transition:transform .14s cubic-bezier(.2,.8,.2,1),box-shadow .2s}
.da .hubcard::after{content:"";position:absolute;right:-30px;top:-30px;width:90px;height:90px;border-radius:50%;opacity:.10;background:var(--hue);transition:transform .3s}
.da .hubcard:hover{transform:translateY(-4px);box-shadow:0 6px 14px rgba(20,33,61,.10),0 22px 44px rgba(20,33,61,.14)}
.da .hubcard:hover::after{transform:scale(1.25)}
.da .hubcard:active{transform:translateY(-1px)}
.da .hubicon{width:50px;height:50px;border-radius:16px;display:grid;place-items:center;color:#fff;position:relative;z-index:1;box-shadow:0 8px 18px var(--hueShadow)}
.da .hubtitle{display:block;font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;font-weight:700;font-size:15.5px;color:var(--navy);letter-spacing:.01em;line-height:1.05}
.da .hubdesc{font-size:11.5px;color:var(--steel);margin-top:2px;display:block}
/* richer primary buttons */
.da .pill{background:linear-gradient(135deg,#3A49B8,#26327E)}
.da .pill-lime{background:linear-gradient(135deg,#7BD457,#5CB33C)}
/* side-rail icon chips */
.da .side .snav svg{flex-shrink:0}
/* ---- depth: a soft mesh behind everything, glass surfaces over it ---- */
.da{background:
   radial-gradient(1100px 560px at 100% -12%, rgba(107,192,72,.07), transparent 60%),
   radial-gradient(820px 460px at -8% 8%, rgba(43,57,144,.07), transparent 55%),
   var(--paper);background-attachment:fixed}
.da .card{background:rgba(255,255,255,.90)}
.da .hubcard{background:rgba(255,255,255,.92)}
/* glassmorphism: frosted app bar + side rail float over the mesh */
.da .appbar{background:linear-gradient(160deg,rgba(27,42,74,.86),rgba(20,33,61,.92));backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3)}
.da .side{background:linear-gradient(180deg,rgba(27,42,74,.90),rgba(20,33,61,.94));backdrop-filter:blur(16px) saturate(1.3);-webkit-backdrop-filter:blur(16px) saturate(1.3);transition:width .18s cubic-bezier(.2,.8,.2,1)}
/* collapsible 64px icon rail (desktop) */
.da .side.rail{width:74px}
.da .side.rail .brand .disp,.da .side.rail .snav span,.da .side.rail .sfoot .who,.da .side.rail .snavgroup{display:none}
.da .side.rail .snavsec{margin-top:8px;border-top:1px solid rgba(255,255,255,.08);padding-top:8px}
.da .side.rail .snav{justify-content:center;padding:12px 0}
.da .side.rail .sfoot{justify-content:center}
.da .railbtn{position:absolute;top:14px;right:-11px;width:22px;height:22px;border-radius:50%;background:var(--blue);color:#fff;display:grid;place-items:center;box-shadow:0 3px 8px rgba(43,57,144,.4);z-index:20}
/* container queries: components respond to their container, not just the viewport */
.da .wmain-inner{container-type:inline-size}
@container (max-width:540px){ .da .hubgrid{grid-template-columns:1fr 1fr} }
@container (min-width:820px){ .da .hubgrid{grid-template-columns:repeat(auto-fill,minmax(180px,1fr))} }
`;

const Panel = ({ children, style }) => (
  <div className="card" style={{ padding: 16, ...style }}>{children}</div>
);

/* ---- icons for the app bar and bottom navigation ---- */
const NAV_PATHS = {
  driver: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  dhome: <><path d="M4 11.5L12 4l8 7.5" /><path d="M6 10v10h12V10" /></>,
  drequest: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  rrequest: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  dcard: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3 10h18" /></>,
  approver: <><circle cx="12" cy="12" r="9" /><path d="M8.3 12.4l2.6 2.6L15.8 10" /></>,
  cardsys: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3 10h18" /></>,
  fleet: <><path d="M4 20V11" /><path d="M10 20V5" /><path d="M16 20v-6" /><path d="M2.5 20h19" /></>,
  intel: <><path d="M12 3l1.5 3.6L17 8l-3.5 1.4L12 13l-1.5-3.6L7 8l3.5-1.4z" /><path d="M18 14l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z" /></>,
  master: <><ellipse cx="12" cy="5.5" rx="7.5" ry="3" /><path d="M4.5 5.5v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6" /><path d="M4.5 11.5v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6" /></>,
  // super-app modules
  exec: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
  birdseye: <><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="9" width="3" height="8" /></>,
  hub: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  submit: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  retail: <><path d="M3 9l1.5-5h15L21 9" /><path d="M4 9h16v11H4z" /><path d="M9 20v-6h6v6" /></>,
  deliver: <><rect x="1" y="6" width="13" height="10" rx="1.4" /><path d="M14 9h4l3 3v4h-7z" /><circle cx="6.5" cy="18" r="1.6" /><circle cx="17.5" cy="18" r="1.6" /></>,
  dapprove: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  deliverynotes: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15l1.8 1.8L15 13" /></>,
  recon: <><path d="M3 21V8l9-5 9 5v13" /><path d="M3 21h18" /><rect x="9" y="13" width="6" height="8" /></>,
  inventory: <><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
  schedule: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M8 14h4" /></>,
  yardwork: <><path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2-2 2.3-2.3z" /></>,
  fleetstatus: <><rect x="1" y="7" width="13" height="9" rx="1.4" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="6" cy="18" r="1.6" /><circle cx="17.5" cy="18" r="1.6" /></>,
  lube: <><path d="M9 3h6v3l-2 2v3H11V8L9 6z" /><path d="M11 11h2a4 4 0 0 1 4 4v5a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-5a4 4 0 0 1 4-4z" /></>,
  lubesales: <><rect x="4" y="3" width="16" height="18" rx="1.6" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  logistics: <><path d="M4 20V11" /><path d="M10 20V5" /><path d="M16 20v-6" /><path d="M2.5 20h19" /></>,
  flow: <><circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="12" r="2" /><path d="M7 6h6a4 4 0 0 1 4 4M7 18h6a4 4 0 0 0 4-4" /></>,
  cockpit: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="M12 1v3M12 20v3M1 12h3M20 12h3" /></>,
  radar: <><path d="M12 21a9 9 0 1 0-9-9" /><path d="M12 16a4 4 0 1 0-4-4" /><path d="M12 12l6-6" /></>,
  cashflow: <><path d="M2 19h20" /><path d="M4 19v-6" /><path d="M20 19v-6" /><path d="M4 13a8 8 0 0 1 16 0" /></>,
  wetstock: <><path d="M5 5l11 11" /><path d="M16 8v8h-8" /></>,
  cash: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6 9.5v5M18 9.5v5" /></>,
  deposit: <><path d="M3 10l9-6 9 6" /><path d="M5 10v9M12 10v9M19 10v9" /><path d="M3 20h18" /></>,
  cashoffice: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="12" cy="12" r="3.6" /><path d="M12 8.4v1.2M12 14.4v1.2" /></>,
  approvals: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v4.7l3 1.8" /></>,
  outflows: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M12 8.5v5M9.6 11.4l2.4 2.4 2.4-2.4" /></>,
  inflows: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M12 13.5v-5M9.6 10.6l2.4-2.4 2.4 2.4" /></>,
  devices: <><rect x="7" y="2" width="10" height="20" rx="2.4" /><path d="M10.5 18.5h3" /></>,
  digest: <><rect x="4" y="3" width="16" height="18" rx="1.6" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  incoming: <><path d="M3 15v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4" /><path d="M12 3v9M8.5 8.5l3.5 3.5 3.5-3.5" /></>,
  league: <><path d="M6 4h12v3a6 6 0 0 1-12 0z" /><path d="M6 5H3v1.5a3 3 0 0 0 3 3M18 5h3v1.5a3 3 0 0 1-3 3" /><path d="M12 13v4M9 21h6M10 17h4" /></>,
  staff: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><circle cx="17.6" cy="9" r="2.2" /><path d="M16.6 15.3a4.7 4.7 0 0 1 4 4.7" /></>,
  tracking: <><path d="M9 20l-5 2V6l5-2 6 2 5-2v12l-5 2z" /><path d="M9 4v16M15 6v14" /></>,
  unlocks: <><rect x="5" y="11" width="14" height="9" rx="1.6" /><path d="M8 11V7a4 4 0 0 1 7.9-.9" /><circle cx="12" cy="15.4" r="1.3" /></>,
};
const NavIcon = ({ k, on }) => (
  <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
    {NAV_PATHS[k]}
  </svg>
);
const IconExit = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M9 12h11" /><path d="M16 8l4 4-4 4" />
  </svg>
);

/* ---- colourful step icons for the driver wizard (Tiimo-style) ---- */
const STEP_ICON_PATHS = {
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></>,
  truck: <><rect x="2" y="7" width="12" height="9" rx="1.6" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="7" cy="18.3" r="1.7" /><circle cx="17.4" cy="18.3" r="1.7" /></>,
  pin: <><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  gauge: <><path d="M4 19a8 8 0 1 1 16 0" /><path d="M12 19l3.6-4.6" /></>,
  route: <><circle cx="6" cy="6.5" r="2.3" /><circle cx="18" cy="17.5" r="2.3" /><path d="M8.3 6.5H14a3 3 0 0 1 0 6h-4a3 3 0 0 0 0 6h5.4" /></>,
  drop: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  check: <path d="M20 6.5L9.5 17 4.5 12" />,
};
const StepIcon = ({ k }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    {STEP_ICON_PATHS[k]}
  </svg>
);
const Field = ({ label, children }) => (
  <label style={{ display: "block", marginBottom: 11 }}><span className="lbl">{label}</span>{children}</label>
);
const Step = ({ n, title, done, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span className="mono" style={{ width: 26, height: 26, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700,
        background: done ? "var(--ok)" : "#fff", color: done ? "#fff" : "var(--steel)",
        border: `1.5px solid ${done ? "var(--ok)" : "var(--line)"}`, borderRadius: "50%",
        boxShadow: done ? "0 2px 6px rgba(76,158,42,.35)" : "none", transition: "all .2s" }}>{done ? "✓" : n}</span>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h3>
    </div>
    <div style={{ paddingLeft: 34 }}>{children}</div>
  </div>
);
const PumpHead = ({ litres, km, kmpl, caption }) => (
  <div style={{ background: "linear-gradient(150deg,#22345C,#14213D)", borderRadius: 16, padding: "18px 20px", color: "#EAF0FA", boxShadow: "0 10px 26px rgba(20,33,61,.28)" }}>
    <div className="disp" style={{ fontSize: 11, letterSpacing: ".14em", color: "#8FA0C4", marginBottom: 6 }}>{caption}</div>
    <div className="mono" style={{ fontSize: 48, lineHeight: 1, fontWeight: 500, color: "var(--lime)", letterSpacing: "-.02em" }}>
      {litres == null ? "– – –" : L(litres)}<span style={{ fontSize: 16, marginLeft: 8, color: "#8FA0C4" }}>L</span>
    </div>
    {km != null && kmpl != null && <div className="mono" style={{ fontSize: 12, color: "#9FB0D0", marginTop: 9 }}>
      {L(km)} km · needs ~{L(Math.ceil(km / kmpl / 10) * 10)} L at {kmpl.toFixed(2)} km/L
      {litres != null && Math.abs(litres - km / kmpl) / (km / kmpl) > 0.12 && <span style={{ color: "#E0B24A" }}> · this fill differs — see the trip breakdown below</span>}</div>}
  </div>
);
const Flag = ({ tone, title, children }) => {
  const c = { red: ["var(--red)", "#FDECEA"], amber: ["var(--amber)", "#FEF4E6"], ok: ["var(--ok)", "#EBF6E7"] }[tone];
  return (
    <div style={{ background: c[1], border: `1px solid ${c[0]}`, borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
      <div className="disp" style={{ color: c[0], fontSize: 13, fontWeight: 700 }}>{title}</div>
      {children && <div style={{ fontSize: 13, marginTop: 4 }}>{children}</div>}
    </div>
  );
};

// Accounting-table cells (numbers right-aligned with tabular figures so columns line up).
const Th = ({ children, right }) => <th style={{ padding: "9px 11px", textAlign: right ? "right" : "left", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, letterSpacing: ".04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{children}</th>;
const Td = ({ children, right, style, colSpan }) => <td colSpan={colSpan} style={{ padding: "8px 11px", textAlign: right ? "right" : "left", ...(right ? { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } : null), ...style }}>{children}</td>;
const AcctTable = ({ head, children, note }) => (
  <div className="card" style={{ padding: 0, overflow: "hidden" }}>
    <div style={{ overflowX: "auto" }}>
      <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr style={{ background: "var(--navy)", color: "#fff" }}>{head}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
    {note && <div style={{ fontSize: 11, color: "var(--steel)", padding: "8px 14px 12px" }}>{note}</div>}
  </div>
);

/* TESTING ONLY — a bar to fake the phone's location to a chosen station, so the
   geo-lock can be exercised away from a real forecourt. Gated by TEST_GPS. */
function TestBar() {
  const [site, setSite] = useState("");
  const set = (v) => { setSite(v); if (typeof window !== "undefined") window.__DA_TEST_SITE = v || null; };
  return (
    <div style={{ background: "#FDF3E7", borderBottom: "1.5px solid var(--amber)", padding: "8px 14px" }}>
      <div style={{ maxWidth: 940, margin: "0 auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span className="disp" style={{ fontSize: 11, fontWeight: 700, color: "var(--amber)", letterSpacing: ".08em" }}>
          Testing only — pretend the phone is standing at:</span>
        <select value={site} onChange={(e) => set(e.target.value)} style={{ width: "auto", padding: "5px 8px", fontSize: 13 }}>
          <option value="">use the real GPS</option>
          {STATIONS.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <span style={{ fontSize: 12, color: "var(--steel)" }}>Remove this bar before the app goes near a driver.</span>
      </div>
    </div>
  );
}

/* ============================== APP =============================== */
/* ACCESS: every module a role can open (drives the Home hub + the guard that
   keeps you on an allowed screen). Multi-module roles get a "hub" launcher so
   the app scales past a phone's bottom bar. Focused roles keep a simple bar. */
const ROLE_TABS = {
  // Fleet driver: one home screen (balance, card, trips, pending status) with
  // buttons into the request wizard and the delivery-note form.
  driver: [["dhome", "Home"], ["drequest", "Request"], ["dapprove", "Approve"]],   // filing delivery notes is the SITE's job — the driver approves
  // Retail supervisor (site-bound): loads their site's stock/price/sales + delivery
  // notes, and raises fuel requests for the site's cars.
  retail_supervisor: [["hub", "Home"], ["submit", "Site submit"], ["incoming", "Deliveries"], ["deposit", "Deposit"], ["deliver", "Delivery"], ["dapprove", "Approve"], ["rrequest", "Fuel request"], ["cash", "Cash"], ["wetstock", "Losses"]],
  site_manager: [["hub", "Home"], ["submit", "Site submit"], ["incoming", "Deliveries"], ["deposit", "Deposit"], ["deliver", "Delivery"], ["dapprove", "Approve"], ["rrequest", "Fuel request"], ["cash", "Cash"], ["wetstock", "Losses"]], // legacy alias
  // Cash office: confirms site deposits, records cash received, closes each day.
  cash_office: [["hub", "Home"], ["cashoffice", "Cash office"], ["cash", "Cash"]],
  // Operations manager: the full retail manager view (all sites).
  operations_manager: [["cockpit", "Watchlist"], ["radar", "Radar"], ["hub", "Home"], ["birdseye", "Birds-eye"], ["submit", "Site submit"], ["retail", "Retail"], ["inflows", "Cash inflows"], ["wetstock", "Losses"], ["cash", "Cash"], ["logistics", "Logistics"], ["flow", "Delivery flow"], ["league", "Driver league"], ["fleetstatus", "Fleet status"], ["intel", "Intelligence"], ["staff", "Staff assignment"], ["unlocks", "Unlock requests"], ["devices", "Device requests"], ["tracking", "Journey tracking"]],
  // Fleet manager / fleet approver: fleet data + approves fleet fuel requests.
  // No warehouse — that's the logistics role.
  fleet_manager: [["cockpit", "Watchlist"], ["hub", "Home"], ["approver", "Approve"], ["approvals", "My approvals"], ["fleet", "Efficiency"], ["league", "Driver league"], ["fleetstatus", "Fleet status"], ["logistics", "Deliveries"],
                  ["cardsys", "Fuel drawn"], ["staff", "Staff assignment"], ["intel", "Intelligence"], ["tracking", "Journey tracking"]],
  approver: [["hub", "Home"], ["approver", "Approve"], ["approvals", "My approvals"], ["fleet", "Efficiency"], ["logistics", "Deliveries"],
             ["cardsys", "Fuel drawn"], ["intel", "Intelligence"]],
  // Logistics: runs the warehouses. Submits warehouse + in-transit stock, logs
  // deliveries, and sees the full inventory plus what the sites hold.
  logistics: [["cockpit", "Watchlist"], ["hub", "Home"], ["recon", "Warehouse"], ["schedule", "Schedule"], ["deliver", "Delivery"], ["flow", "Delivery flow"], ["inventory", "Inventory"], ["logistics", "Deliveries"], ["deliverynotes", "Delivery notes"], ["retail", "Sites"], ["staff", "Staff assignment"], ["tracking", "Journey tracking"]],
  logistics_manager: [["birdseye", "Bird's-eye"], ["hub", "Home"], ["recon", "Warehouse"], ["schedule", "Schedule"], ["deliver", "Delivery"], ["flow", "Delivery flow"], ["inventory", "Inventory"], ["logistics", "Deliveries"], ["retail", "Sites"], ["staff", "Staff assignment"], ["tracking", "Journey tracking"]],
  depot: [["cockpit", "Watchlist"], ["hub", "Home"], ["recon", "Warehouse"], ["schedule", "Schedule"], ["deliver", "Delivery"], ["flow", "Delivery flow"], ["inventory", "Inventory"], ["logistics", "Deliveries"], ["retail", "Sites"], ["tracking", "Journey tracking"]],
  // Logistics lead (Dave): the full logistics role PLUS driver management —
  // approves fuel requests and sees truck/driver efficiency.
  logistics_lead: [["cockpit", "Watchlist"], ["hub", "Home"], ["recon", "Warehouse"], ["schedule", "Schedule"], ["deliver", "Delivery"], ["flow", "Delivery flow"], ["inventory", "Inventory"], ["logistics", "Deliveries"], ["retail", "Sites"], ["approver", "Approve fuel"], ["approvals", "My approvals"], ["fleet", "Efficiency"], ["fleetstatus", "Fleet status"], ["staff", "Staff assignment"], ["tracking", "Journey tracking"]],
  // Executive: full access to everything EXCEPT raising fuel requests.
  // Executive: VIEW-ONLY — every dashboard/report, but no submitting, no approving,
  // and no master data (master data is the admin role's alone).
  executive: [["hub", "Home"], ["exec", "Summary"], ["radar", "Radar"], ["cockpit", "Watchlist"], ["fleetstatus", "Fleet status"], ["retail", "Retail"], ["inflows", "Cash inflows"],
              ["inventory", "Inventory"], ["logistics", "Deliveries"], ["flow", "Delivery flow"], ["deliverynotes", "Delivery notes"],
              ["wetstock", "Losses"], ["cash", "Cash"], ["cardsys", "Fuel drawn"], ["fleet", "Efficiency"], ["intel", "Intelligence"], ["tracking", "Journey tracking"]],
  // Managers: day-end summary, fleet status, deliveries/losses, sales & cash.
  manager: [["hub", "Home"], ["birdseye", "Birds-eye"], ["radar", "Radar"], ["cockpit", "Watchlist"], ["fleetstatus", "Fleet status"], ["logistics", "Deliveries"], ["flow", "Delivery flow"], ["deliverynotes", "Delivery notes"], ["league", "Driver league"], ["dapprove", "Approve deliveries"], ["submit", "Site submit"], ["retail", "Sales & cash"], ["inflows", "Cash inflows"], ["wetstock", "Losses"], ["cash", "Cash"], ["intel", "Intelligence"], ["staff", "Staff assignment"], ["unlocks", "Unlock requests"], ["devices", "Device requests"], ["tracking", "Journey tracking"]],
  // Manager who ALSO receives cash (Adventure): manager view + the Cash office.
  manager_cashier: [["hub", "Home"], ["birdseye", "Birds-eye"], ["radar", "Radar"], ["cockpit", "Watchlist"], ["fleetstatus", "Fleet status"], ["logistics", "Deliveries"], ["flow", "Delivery flow"], ["league", "Driver league"], ["dapprove", "Approve deliveries"], ["submit", "Site submit"], ["retail", "Sales & cash"], ["inflows", "Cash inflows"], ["wetstock", "Losses"], ["cash", "Cash"], ["cashoffice", "Cash office"], ["intel", "Intelligence"], ["staff", "Staff assignment"], ["unlocks", "Unlock requests"], ["devices", "Device requests"]],
  // Site supervisor who ALSO receives cash (Donald): supervisor tools + the Cash office.
  supervisor_cashier: [["hub", "Home"], ["submit", "Site submit"], ["incoming", "Deliveries"], ["deposit", "Deposit"], ["deliver", "Delivery"], ["dapprove", "Approve"], ["rrequest", "Fuel request"], ["cashoffice", "Cash office"], ["cash", "Cash"], ["wetstock", "Losses"]],
  // Retail approver (Adam): the full manager view PLUS approving SITE fuel requests.
  retail_approver: [["hub", "Home"], ["approver", "Approve fuel"], ["approvals", "My approvals"], ["birdseye", "Birds-eye"], ["radar", "Radar"], ["cockpit", "Watchlist"], ["fleetstatus", "Fleet status"], ["logistics", "Deliveries"], ["flow", "Delivery flow"], ["dapprove", "Approve deliveries"], ["submit", "Site submit"], ["retail", "Sales & cash"], ["inflows", "Cash inflows"], ["wetstock", "Losses"], ["cash", "Cash"], ["cashoffice", "Cash office"], ["intel", "Intelligence"], ["staff", "Staff assignment"], ["unlocks", "Unlock requests"], ["devices", "Device requests"]],
  // Yard: log trucks into the workshop, post daily updates, close cases.
  yard: [["hub", "Home"], ["yardwork", "Workshop"], ["fleetstatus", "Fleet status"]],
  // Yard lead (Shaahid): the yard role PLUS driver management — approves fuel
  // requests and sees truck/driver efficiency.
  yard_lead: [["hub", "Home"], ["yardwork", "Workshop"], ["fleetstatus", "Fleet status"], ["approver", "Approve fuel"], ["approvals", "My approvals"], ["fleet", "Efficiency"]],
  // Reporting accountant (Madhvi): retail manager + cash office + the executive Bird's-eye.
  reporting_accountant: [["hub", "Home"], ["exec", "Summary"], ["birdseye", "Birds-eye"], ["radar", "Radar"], ["cockpit", "Watchlist"], ["cashoffice", "Cash office"], ["cash", "Cash"], ["wetstock", "Losses"], ["retail", "Sales & cash"], ["inflows", "Cash inflows"], ["dapprove", "Approve deliveries"], ["fleetstatus", "Fleet status"], ["logistics", "Deliveries"], ["flow", "Delivery flow"], ["intel", "Intelligence"], ["unlocks", "Unlock requests"], ["devices", "Device requests"]],
  // Accounting & logistics manager (Aalia): cash office + logistics ops + manager view.
  accounts_logistics: [["hub", "Home"], ["birdseye", "Birds-eye"], ["cockpit", "Watchlist"], ["radar", "Radar"], ["cashoffice", "Cash office"], ["cash", "Cash"], ["wetstock", "Losses"], ["recon", "Warehouse"], ["schedule", "Schedule"], ["inventory", "Inventory"], ["logistics", "Deliveries"], ["flow", "Delivery flow"], ["staff", "Staff assignment"], ["retail", "Retail"], ["inflows", "Cash inflows"], ["intel", "Intelligence"], ["unlocks", "Unlock requests"], ["devices", "Device requests"], ["tracking", "Journey tracking"]],
  // admin: full access (superuser).
  admin: [["exec", "Summary"], ["radar", "Radar"], ["cockpit", "Watchlist"], ["hub", "Home"], ["driver", "Request"], ["approver", "Approve"], ["approvals", "My approvals"], ["submit", "Site submit"], ["retail", "Retail"], ["inflows", "Cash inflows"],
          ["recon", "Warehouse"], ["schedule", "Schedule"], ["deliver", "Delivery"], ["dapprove", "Approve deliveries"], ["inventory", "Inventory"], ["logistics", "Deliveries"], ["flow", "Delivery flow"], ["wetstock", "Losses"], ["cash", "Cash"], ["cashoffice", "Cash office"], ["deposit", "Deposit"], ["fleetstatus", "Fleet status"], ["yardwork", "Yard"],
          ["cardsys", "Fuel drawn"], ["fleet", "Efficiency"], ["intel", "Intelligence"], ["master", "Master data"], ["staff", "Staff assignment"], ["unlocks", "Unlock requests"], ["devices", "Device requests"], ["tracking", "Journey tracking"]],
};

/* Module cards on the Home hub, grouped. Keyed by tab key. */
const MODULE_META = {
  cockpit:   { label: "Watchlist", group: "Executive", desc: "Your watchlist" },
  wetstock:  { label: "Losses", group: "Retail sites", desc: "Delivery + site losses" },
  cash:      { label: "Cash", group: "Retail sites", desc: "Banked vs expected" },
  deposit:   { label: "Record a deposit", group: "Retail sites", desc: "Log a bank deposit + slip" },
  cashoffice:{ label: "Cash office", group: "Retail sites", desc: "Confirm deposits · close days" },
  digest:    { label: "Cash & fuel digest", group: "Executive", desc: "The few things worth flagging" },
  radar:     { label: "Radar", group: "Executive", desc: "Cash & fuel tripwires" },
  exec:      { label: "Bird's-eye view", group: "Executive", desc: "" },
  birdseye:  { label: "Birds-eye", group: "Executive", desc: "Site analytics — scorecard, day-end, trends, deliveries" },
  dhome:     { label: "My balance", group: "Fuel", desc: "Card & requests" },
  dcard:     { label: "My card", group: "Fuel", desc: "Balance & history" },
  fleet:     { label: "Efficiency", group: "Logistics", desc: "km/L analytics" },
  intel:     { label: "Intelligence", group: "Executive", desc: "Ask the data" },
  driver:    { label: "Raise request", group: "Fuel", desc: "New fuel request" },
  drequest:  { label: "Raise request", group: "Fuel", desc: "New fuel request" },
  rrequest:  { label: "Fuel request", group: "Fuel", desc: "For your site cars" },
  approver:  { label: "Approve fuel", group: "Fuel", desc: "Review & approve" },
  approvals: { label: "My approvals", group: "Fuel", desc: "History · search · export" },
  cardsys:   { label: "Fuel drawn", group: "Fuel", desc: "Drawn by driver · truck · site" },
  submit:    { label: "Site submit", group: "Retail sites", desc: "Stock · Price · Sales" },
  incoming:  { label: "Deliveries", group: "Retail sites", desc: "Incoming to your site" },
  retail:    { label: "Retail board", group: "Retail sites", desc: "Live site status" },
  inflows:   { label: "Cash inflows", group: "Retail sites", desc: "Expected cash vs what sites submitted" },
  deliver:   { label: "Delivery note", group: "Retail sites", desc: "Log a delivery" },
  dapprove:  { label: "Approve deliveries", group: "Retail sites", desc: "Sign off delivery notes" },
  deliverynotes: { label: "Delivery notes", group: "Logistics", desc: "Approved notes — view, print, download" },
  recon:     { label: "Warehouse", group: "Logistics", desc: "Imports & running balance" },
  schedule:  { label: "Schedule", group: "Logistics", desc: "Plan a delivery trip" },
  logistics: { label: "Deliveries", group: "Logistics", desc: "Delivery performance" },
  flow: { label: "Delivery flow", group: "Logistics", desc: "Where each drop is stuck · who owes the next action" },
  league: { label: "Driver league", group: "Logistics", desc: "Driver performance, ranked" },
  staff:  { label: "Staff assignment", group: "Logistics", desc: "Supervisors → sites · drivers → trucks" },
  unlocks:{ label: "Unlock requests", group: "Retail sites", desc: "Sites asking to correct a locked submission" },
  devices:{ label: "Device requests", group: "Logistics", desc: "Approve a driver signing in on a new phone" },
  tracking:{ label: "Journey tracking", group: "Logistics", desc: "Live GPS trail per trip" },
  inventory: { label: "Inventory", group: "Logistics", desc: "Warehouse · trucks · sites" },
  yardwork:  { label: "Yard workshop", group: "Yard", desc: "Log repairs & updates" },
  fleetstatus:{ label: "Fleet status", group: "Yard", desc: "Active / in workshop" },
  master:    { label: "Master data", group: "Admin", desc: "Drivers · sites · managers" },
};
const MODULE_GROUPS = ["Executive", "Fuel", "Retail sites", "Logistics", "Yard", "Admin"];
// Colour-coded module groups (Tiimo-style: distinct, warm, legible).
const GROUP_COLOR = {
  "Executive":    { a: "#7A5AF0", b: "#9B7BFF" },
  "Fuel":         { a: "#2B3990", b: "#4453B8" },
  "Retail sites": { a: "#2E9E5B", b: "#57C57E" },
  "Logistics":    { a: "#E0860E", b: "#F5A62E" },
  "Admin":        { a: "#5B6B84", b: "#7C8CA6" },
};

function Hub({ me, modules, onOpen }) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const byGroup = MODULE_GROUPS.map((g) => [g, modules.filter(([k]) => MODULE_META[k]?.group === g)]).filter(([, m]) => m.length);
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "6px 4px 90px" }}>
      <div style={{ margin: "2px 4px 20px" }}>
        <div className="disp" style={{ fontSize: 12, letterSpacing: ".08em", color: "var(--steel)" }}>{greet.toUpperCase()}</div>
        <h2 style={{ margin: "2px 0 0", fontSize: 24, color: "var(--navy)", lineHeight: 1.05 }}>{me.name.split(" ")[0]}</h2>
      </div>
      {byGroup.map(([group, mods]) => {
        const c = GROUP_COLOR[group] || GROUP_COLOR.Admin;
        return (
          <div key={group} style={{ marginBottom: 22 }}>
            <div className="hubgroup"><span className="dot" style={{ background: c.a }} />{group}</div>
            <div className="hubgrid">
              {mods.map(([k]) => (
                <button key={k} onClick={() => onOpen(k)} className="hubcard"
                  style={{ "--hue": c.a, "--hueShadow": `${c.a}55` }}>
                  <span className="hubicon" style={{ background: `linear-gradient(145deg,${c.b},${c.a})` }}>
                    <NavIcon k={k} on />
                  </span>
                  <span>
                    <span className="hubtitle">{MODULE_META[k].label}</span>
                    <span className="hubdesc">{MODULE_META[k].desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---- About ---- */
const RELEASE_DATE = "July 2026";
function About({ onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,33,61,.55)", zIndex: 100, display: "grid", placeItems: "center", padding: 20, backdropFilter: "blur(4px)" }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, width: "100%", padding: 24, position: "relative" }}>
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 10, right: 12, background: "none", color: "var(--steel)", fontSize: 24, lineHeight: 1 }}>×</button>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <img src="/da-logo.png" width="44" height="44" alt="DA" style={{ filter: "drop-shadow(0 1px 2px rgba(20,33,61,.2))" }} />
          <div>
            <div className="disp" style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)", lineHeight: 1 }}>DA <span style={{ color: "var(--lime)" }}>OPS</span></div>
            <div className="mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 3 }}>v{APP_VERSION} · {RELEASE_DATE}</div>
          </div>
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink)", margin: "0 0 8px" }}>
          DA OPS is Daniel Aguiar Motors' operations app — built with every department, one system from order to banked cash.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink)", margin: "0 0 8px" }}>
          <b style={{ color: "var(--navy)" }}>Fuel &amp; fleet</b> — requisition and approval with geo-lock and measured consumption, DA card loads, scheduled trips with live GPS and per-leg delivery confirmation, and the fleet workshop.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink)", margin: "0 0 8px" }}>
          <b style={{ color: "var(--navy)" }}>Sites &amp; stock</b> — retail site stock, prices, sales and lubricants; warehouse inventory and outflows; staff assignment.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink)", margin: "0 0 8px" }}>
          <b style={{ color: "var(--navy)" }}>Cash &amp; reporting</b> — the full cash cycle from expected cash to banked-and-confirmed at HQ, with executive reporting on margins, losses and compliance.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink)", margin: "0 0 4px" }}>
          Every entry is attributable and tamper-evident on an append-only ledger — protecting staff, sites and the company alike. DA OPS replaced the WhatsApp groups it grew out of: informal messages became structured, auditable records.
        </p>
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 14, fontSize: 12, color: "var(--steel)", lineHeight: 1.7 }}>
          <div><b style={{ color: "var(--navy)" }}>Developer</b> · Tinashe Severa</div>
          <div><b style={{ color: "var(--navy)" }}>Released</b> · {RELEASE_DATE}</div>
          <div><b style={{ color: "var(--navy)" }}>Version</b> · {APP_VERSION}</div>
          <div style={{ marginTop: 8 }}>© 2026 Daniel Aguiar Motors · <a href="https://fuel.dasuperapp.com/privacy" target="_blank" rel="noreferrer" style={{ color: "var(--blue)" }}>Privacy policy</a></div>
        </div>
      </div>
    </div>
  );
}
const IconInfo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.5v.5" />
  </svg>
);
const IconBell = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);
// Header bell → Inbox, with the live actionable-item count as a badge.
const BellButton = ({ count, onClick }) => (
  <button onClick={onClick} aria-label={`Inbox${count ? ` — ${count} pending` : ""}`}
    style={{ position: "relative", background: "rgba(255,255,255,.12)", color: "#EAF0FA", padding: 9, borderRadius: 11, display: "grid", placeItems: "center" }}>
    <IconBell />
    {count > 0 && <span style={{ position: "absolute", top: -5, right: -5, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 100, background: "#E0860E", color: "#fff", fontSize: 11, fontWeight: 800, display: "grid", placeItems: "center", border: "2px solid #14213D", boxSizing: "border-box" }}>{count > 99 ? "99+" : count}</span>}
  </button>
);

/* Blocking "update required" screen — shown when the server's minimum build is
   newer than this app. Mirrors the Login page (DA wordmark, navy gradient, white
   card) so it feels like part of the app; the only way forward is to update. */
function UpdateGate() {
  const C = { navy: "#14213D", ink: "#1B2A4A", blue: "#2B3990", lime: "#6BC048", steel: "#5B6B84" };
  // iOS can't install an APK — send iPhone users to the always-current web app.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const link = isIOS ? IOS_URL : APK_URL;
  const cta = isIOS ? "Open the latest version" : "Download update";
  const help = isIOS
    ? "Open DA OPS on the web to keep going. Tap Share → Add to Home Screen for the full-screen app."
    : "Tap below to download it, then open the file to install.";
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(165deg,#1F2E52 0%,#0F1A31 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom))", fontFamily: "'Barlow',system-ui,sans-serif", color: "#EAF0FA" }}>
      <div style={{ width: "100%", maxWidth: 384, textAlign: "center" }}>
        <img src="/da-wordmark.png" alt="Daniel Aguiar Motors" style={{ width: "min(248px,74%)", height: "auto", filter: "drop-shadow(0 10px 24px rgba(0,0,0,.4))" }} />
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontSize: 26, fontWeight: 800, letterSpacing: ".2em", marginTop: 16, lineHeight: 1 }}>
          <span style={{ color: C.lime }}>OPS</span>
        </div>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontSize: 12.5, letterSpacing: ".14em", color: "#9FB0D0", marginTop: 10, marginBottom: 24 }}>
          Retail · Logistics · Fleet · Workshop
        </div>

        <div style={{ background: "#fff", color: C.ink, borderRadius: 18, padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,.40)", textAlign: "center" }}>
          <div style={{ width: 58, height: 58, borderRadius: 16, background: "#F0F7EA", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.lime} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
          </div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontSize: 20, fontWeight: 800, letterSpacing: ".03em", color: C.navy }}>Update required</div>
          <div style={{ fontSize: 13.5, color: C.steel, margin: "9px 0 20px", lineHeight: 1.55 }}>
            A newer version of DA OPS is out. {help}
          </div>
          <button type="button"
            onClick={() => {
              // Android: navigate the MAIN WebView to the APK — it's served as an
              // attachment, so the native DownloadListener (MainActivity) hands it to
              // Android's DownloadManager and the user installs from the notification.
              // A WebView can't download via a plain <a>/new tab, which is why the old
              // button did nothing. iOS/web: just open the link.
              if (isIOS) window.open(link, "_blank", "noreferrer");
              else window.location.href = link;
            }}
            style={{ display: "block", width: "100%", boxSizing: "border-box", padding: 15, fontSize: 15, fontWeight: 700, borderRadius: 12, border: "none", cursor: "pointer",
              fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: ".05em",
              background: C.blue, color: "#fff", boxShadow: "0 10px 22px rgba(43,57,144,.30)" }}>
            {cta}
          </button>
          <div style={{ fontSize: 11, color: C.steel, marginTop: 12 }}>Not downloading? Open <b>fuel.dasuperapp.com/download/latest.apk</b> in Chrome.</div>
        </div>
        <div style={{ fontSize: 11, color: "#5E6F94", marginTop: 20 }}>This device: DA OPS v{APP_VERSION} (build {APP_BUILD})</div>
      </div>
    </div>
  );
}

/* Inbox — one place for everything that needs this person's action. Fed by the
   live actionable-item feed (buildAlerts), so an item disappears the moment the
   underlying task is resolved — nothing to mark-read or clear by hand. Tapping a
   row jumps to the screen where it gets handled. */
function Inbox({ items, onOpen }) {
  return (
    <div>
      <h2 style={{ margin: "2px 0 6px", fontSize: 24 }}>Inbox</h2>
      <div style={{ fontSize: 13, color: "var(--steel)", marginBottom: 16 }}>
        Everything that needs your action. Items clear on their own once resolved.
      </div>
      {items.length === 0 ? (
        <div className="card" style={{ padding: 26, textAlign: "center", color: "var(--steel)" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>✓</div>
          <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: 2 }}>You’re all caught up</div>
          <div style={{ fontSize: 13 }}>Nothing needs your attention right now.</div>
        </div>
      ) : items.map((it) => (
        <button key={it.type} onClick={() => onOpen(it.tab)} className="card"
          style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", border: "1px solid var(--line)" }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "#E0860E", color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, flexShrink: 0 }}>{it.count}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="disp" style={{ fontWeight: 700, color: "var(--navy)", fontSize: 15 }}>{it.title}</div>
            <div style={{ fontSize: 13, color: "var(--steel)" }}>{it.body}</div>
          </div>
          <div style={{ color: "#E0860E", fontSize: 22, flexShrink: 0 }}>›</div>
        </button>
      ))}
      <button onClick={() => onOpen("feedback")} className="card"
        style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", marginTop: 6, cursor: "pointer", border: "1px dashed var(--line)", background: "transparent" }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: "#EAEEFB", color: "#2B3990", display: "grid", placeItems: "center", fontSize: 18, flexShrink: 0 }}>🛠️</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="disp" style={{ fontWeight: 700, color: "var(--navy)", fontSize: 14 }}>Report a problem</div>
          <div style={{ fontSize: 12.5, color: "var(--steel)" }}>Something broken, or an idea? Tell the team.</div>
        </div>
        <div style={{ color: "var(--steel)", fontSize: 20, flexShrink: 0 }}>›</div>
      </button>
    </div>
  );
}

// True on tablet/desktop widths, so the app can swap the phone bottom-nav for a
// side rail and wider, multi-column content. Updates live on resize/rotate.
function useWide() {
  const [wide, setWide] = useState(typeof window !== "undefined" && window.innerWidth >= 900);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= 900);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return wide;
}

function App() {
  const wide = useWide();
  const [me, setMe] = useState(currentUser());
  const [state, setState] = useState(null);   // { drivers, horses, requests, cards } from the server
  const [tab, setTab] = useState(null);
  // Google Maps key: a saved override wins, else the built-in project key so
  // Google Directions is the default distance source out of the box.
  const [gkey, setGkeyState] = useState(() => localStorage.getItem("da_gkey") || GOOGLE_MAPS_KEY);
  const setGkey = (v) => { setGkeyState(v); try { v ? localStorage.setItem("da_gkey", v) : localStorage.removeItem("da_gkey"); } catch { /* ignore */ } };
  const [err, setErr] = useState(null);
  const [prefill, setPrefill] = useState(null); // a declined request the driver is editing & resending
  const [deliverPrefill, setDeliverPrefill] = useState(null); // deep-link: {tripNo,site} from "Deliveries due" → pre-select the delivery note
  const goDeliver = (t, ctx) => { setDeliverPrefill(ctx || null); setTab(t); };
  const [focus, setFocus] = useState(null); // deep-link target from a tapped notification: {tab,ref,trip,dn,site}
  // Route a tapped notification to its SPECIFIC item, not just the tab. data.ref opens
  // that request; data.trip/dn/site pre-select that delivery note (see push.js).
  // A tapped notification must NEVER dead-end on the home screen. If this role
  // doesn't have the target tab, route to the container that holds that content;
  // the Inbox (always reachable) is the last resort — it lists the same task.
  const TAB_HOMES = {
    nightshift: ["birdseye", "exec"], dayshift: ["birdseye", "exec"], midday: ["birdseye", "exec"],
    inflows: ["birdseye", "retail", "exec"], outflows: ["birdseye", "exec"],
    deliver: ["incoming", "dhome"], incoming: ["logistics", "retail"], submit: ["birdseye", "retail"],
    yardwork: ["fleetstatus"], yard: ["yardwork", "fleetstatus"], cash: ["cashoffice", "birdseye"], cashoffice: ["cash"],
    dapprove: ["dhome"], approver: ["approvals"], dhome: ["hub"], deposit: ["cashoffice", "birdseye"], unlocks: ["birdseye"],
    // a manager 'birdseye' push reaching an admin/exec (no birdseye tab) lands on
    // their equivalent dashboard; feedback pushes land on the Inbox triage list.
    birdseye: ["exec", "retail"], feedback: ["inbox"], collections: ["exec", "birdseye"],
  };
  const goFocus = (t, d) => {
    const have = (k) => tabs.some(([x]) => x === k);
    const target = have(t) ? t : ((TAB_HOMES[t] || []).find(have) || "inbox");
    setTab(target); setFocus(d || null);
    if (d && (d.trip || d.dn || d.site)) setDeliverPrefill({ tripNo: d.trip || null, site: d.site || null, dn: d.dn || null });
  };
  const [rail, setRail] = useState(() => { try { return localStorage.getItem("da_rail") === "1"; } catch { return false; } });
  const [showAbout, setShowAbout] = useState(false);
  const [alerts, setAlerts] = useState(null);   // { count, items } — actionable items for this user
  const [toast, setToast] = useState(null);      // last-resort notice for any unhandled failure
  const [net, setNet] = useState(() => ({ online: typeof navigator === "undefined" || navigator.onLine, pending: outboxCount() }));
  const [mustUpdate, setMustUpdate] = useState(false);   // server requires a newer build (rare hard gate)
  const [updateReady, setUpdateReady] = useState(false); // a newer build exists — soft, dismissible nudge
  // TINDER-STYLE GPS GATE (drivers, native app): with location OFF the app is a
  // brick — geo-lock, tracking and evidence all need it. Poll cheaply; the gate
  // lifts ITSELF the moment GPS comes back on (no "check again" tap needed).
  const [gpsOk, setGpsOk] = useState(true);
  useEffect(() => {
    if (!me || me.kind !== "driver" || !isNative()) { setGpsOk(true); return; }
    let live = true;
    const probe = async () => { const ok = await gpsEnabled(); if (live) setGpsOk(ok); };
    probe();
    const iv = setInterval(probe, 4000);
    const onVis = () => { if (document.visibilityState === "visible") probe(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { live = false; clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [me]);

  // Force-update gate: ask the server for the minimum build it accepts. If this
  // app is older, block with an "update required" screen. Skipped silently when
  // offline (never trap someone who just can't reach the server).
  useEffect(() => {
    let cancelled = false;
    const check = () => getHealth().then((h) => {
      if (cancelled || !h || h.__offline) return;
      const build = Number(h.build) || 0, minB = Number(h.minBuild) || 0;
      if (build <= APP_BUILD) return;   // already on the latest — nothing to prompt
      // HARD gate is kept ONLY as an emergency escape hatch: it fires when the server
      // raises MIN_BUILD ABOVE the field (Android only; iOS never). Normally MIN_BUILD
      // sits at/below field builds, so this stays dormant and users get the soft,
      // NON-BLOCKING nudge below instead — request an update, don't trap them (owner,
      // 2026-09-01: "request an update but don't block, on iOS and Android").
      if (isNative() && !isIOS() && minB > APP_BUILD) { setMustUpdate(true); return; }
      // SOFT nudge: a newer build exists. Dismissible; re-appears on a later poll until
      // they act. Android downloads the APK; the iOS shell + web just reload to the
      // latest. sessionStorage remembers a dismissal so it doesn't nag within a session.
      try { if (sessionStorage.getItem("da_update_dismissed") === String(build)) return; } catch { /* ignore */ }
      setUpdateReady(build);
    }).catch(() => {});
    // POLL, don't just check once: a tab/app left open must notice a new deploy on
    // its own (was one-shot on launch → an open tab never updated). Check on load,
    // every 60s while visible, and the moment the tab is refocused.
    check();
    const iv = setInterval(() => { if (document.visibilityState === "visible") check(); }, 60000);
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  // Track real API reachability (from api.js) + the offline write queue, and
  // drain the queue when the box comes back.
  useEffect(() => {
    const onNet = (e) => setNet((n) => { const online = !!(e && e.detail); if (online) flushOutbox(); return { ...n, online }; });
    const onOutbox = (e) => setNet((n) => ({ ...n, pending: (e && e.detail) ?? outboxCount() }));
    const onBrowserOffline = () => setNet((n) => ({ ...n, online: false }));
    const onBrowserOnline = () => flushOutbox();
    window.addEventListener("da-net", onNet);
    window.addEventListener("da-outbox", onOutbox);
    window.addEventListener("offline", onBrowserOffline);
    window.addEventListener("online", onBrowserOnline);
    return () => { window.removeEventListener("da-net", onNet); window.removeEventListener("da-outbox", onOutbox); window.removeEventListener("offline", onBrowserOffline); window.removeEventListener("online", onBrowserOnline); };
  }, []);

  // Safety net: nothing should ever fail completely silently. If an async action
  // rejects without being handled by its own screen, surface a transient toast.
  useEffect(() => {
    const onRej = (e) => {
      const m = (e && e.reason && (e.reason.message || e.reason)) || "";
      const s = String(m);
      // Ignore aborts, auth blips, and low-level native-plugin platform noise
      // (e.g. a Capacitor "not implemented on <platform>" rejection) — those are
      // developer/platform concerns, never a user-actionable error.
      if (!s || /abort|not signed in|session expired|not implemented|implemented on|unimplemented|no such module|plugin is not/i.test(s)) return;
      setToast(s.slice(0, 160)); setTimeout(() => setToast(null), 6000);
    };
    const onQuiet = (e) => { const s = String((e && e.detail) || ""); if (s) { setToast(s.slice(0, 160)); setTimeout(() => setToast(null), 6000); } };
    // Session expired / invalid token (any 401): api.js signOut() fires this →
    // drop to the login screen instead of leaving the user on a broken screen.
    const onSignout = () => { setMe(null); setState(null); };
    window.addEventListener("unhandledrejection", onRej);
    window.addEventListener("da-load-error", onQuiet);
    window.addEventListener("da-signout", onSignout);
    return () => { window.removeEventListener("unhandledrejection", onRej); window.removeEventListener("da-load-error", onQuiet); window.removeEventListener("da-signout", onSignout); };
  }, []);

  // Reload the whole read-model from the server. Called after every change, so
  // the screen always reflects the append-only log, never a local guess.
  const load = useCallback(async () => {
    try { setState(await getState()); setErr(null); }
    catch (e) {
      if (!signedIn()) { setMe(null); setErr(e.message); return; }
      // Offline and no full state to show (it's too big to cache) → still render
      // the app from `me` alone, so the menu + per-screen cached data work
      // instead of a dead-end error. The offline banner (not a red error) explains it.
      if (e.offline) { setState((s) => s || { drivers: [], horses: [], requests: [], cards: {} }); setErr(null); }
      else setErr(e.message);
    }
  }, []);

  useEffect(() => { if (me) load(); }, [me, load]);

  // When the offline outbox finishes draining, refresh so the user sees their queued
  // submission actually land (no manual pull-to-refresh).
  useEffect(() => {
    const onSynced = () => { if (me) load(); };
    window.addEventListener("da-synced", onSynced);
    return () => window.removeEventListener("da-synced", onSynced);
  }, [me, load]);

  // An offline submission that the server later REJECTED must never vanish
  // silently — surface it so the operator knows their "Saved offline" write did
  // not land, with the reason, and can redo it (audit findings #5/#8).
  const [outboxFail, setOutboxFail] = useState(null);
  useEffect(() => {
    const onFail = (e) => { const items = (e && e.detail) || []; if (items.length) setOutboxFail(items); };
    window.addEventListener("da-outbox-failed", onFail);
    return () => window.removeEventListener("da-outbox-failed", onFail);
  }, []);

  // Schedule this person's daily submission reminders on the device. Fires even
  // with the app closed; no server/Firebase.
  useEffect(() => {
    const REMIND = ["site_manager", "retail_supervisor", "depot", "logistics", "yard"];
    if (me && REMIND.includes(me.kind)) syncReminders(me.kind, me.site).catch(() => {});
  }, [me]);

  // Resume GPS trip tracking if a trip was left active (app reopened mid-trip).
  useEffect(() => { if (me && me.kind === "driver") resumeTracking().catch(() => {}); }, [me]);

  // Register for FCM push (closed-app "needs your action" alerts). No-op on web
  // and until Firebase is configured; a tapped push deep-links to its tab.
  useEffect(() => {
    if (me) { initPush((t, d) => goFocus(t, d)).catch(() => {}); initLocalNotificationTaps((t, d) => goFocus(t, d)).catch(() => {}); }
  }, [me]);

  // Poll for actionable items (approvals waiting, request sent back, figures due,
  // workshop updates). New items raise a local notification; the count drives the
  // in-app banner. Runs on sign-in, on app resume, and every few minutes.
  useEffect(() => {
    if (!me) return;
    let alive = true;
    const tick = () => checkAlerts().then((a) => { if (alive && a) setAlerts(a); }).catch(() => {});
    tick();
    // Clear any notifications sitting in the tray when the app opens/resumes — the
    // in-app inbox carries the actual tasks, so stale tray notifications (old build,
    // already-actioned, or tab-less) don't linger and dead-end when tapped.
    clearDeliveredNotifications();
    const iv = setInterval(tick, 3 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === "visible") { tick(); clearDeliveredNotifications(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [me, state]);

  // access = every module this role may open. Navigation is a menu → module →
  // back flow: the Home hub (icon grid) is the menu, each module opens over it,
  // and a Back control returns to the hub. Master data is web/desktop-only.
  const hideOnNative = ([k]) => !(k === "master" && isMobileApp());
  const rawTabs = me ? (ROLE_TABS[me.kind] || []).filter(hideOnNative) : [];
  const homeTab = rawTabs.some(([k]) => k === "hub") ? "hub" : (rawTabs.some(([k]) => k === "dhome") ? "dhome" : (rawTabs[0]?.[0] || null));
  // Home always sits at the very top of the side nav.
  const tabs = homeTab ? [...rawTabs].sort((a, b) => (a[0] === homeTab ? -1 : b[0] === homeTab ? 1 : 0)) : rawTabs;
  useEffect(() => {
    // "inbox" and "feedback" are role-agnostic pseudo-tabs — always reachable.
    if (me && tabs.length && tab !== "inbox" && tab !== "feedback" && !tabs.some(([k]) => k === tab)) setTab(homeTab);
  }, [me, tab, tabs, homeTab]);
  // remember the screen the user was on before opening feedback, for triage context
  const prevTabRef = useRef(null);
  useEffect(() => { if (tab && tab !== "feedback") prevTabRef.current = tab; }, [tab]);

  if (mustUpdate) return <UpdateGate />;
  // Driver features need a handset (geo-lock, GPS evidence, the camera). The native
  // app is best (background GPS + device binding), but a driver struggling to install
  // it can work on the PHONE web browser — geolocation and the camera both work there.
  // Only a laptop/desktop browser is blocked (no GPS/camera for the pump controls).
  const driverOnDesktop = me && me.kind === "driver" && !isNative()
    && !/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || "");
  if (driverOnDesktop) return <DriverMobileOnlyGate onSignOut={() => { signOut(); setMe(null); }} />;
  if (me && me.kind === "driver" && !gpsOk) return <GpsGate />;
  if (!me) return <Login onSignedIn={setMe} />;

  const leave = () => { signOut(); setMe(null); setState(null); };

  if (!state) {
    return (
      <div className="da" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <style>{CSS}</style>
        <div style={{ color: "var(--steel)", fontSize: 14, padding: 24, textAlign: "center" }}>{err || "Loading…"}</div>
      </div>
    );
  }

  const { drivers, horses, requests, cards } = state;

  // Every mutation calls the API, then reloads the projection from the log.
  // a fuel request that names a scheduled trip STARTS the journey → GPS on now,
  // and stays on until every drop is offloaded (the trip auto-completes).
  const submit = async (r) => { await postRequest(r); if (r.tripNo) { try { await startTracking(r.tripNo); } catch { /* ignore */ } } await load(); };
  const approve = async (id, litres, note) => {
    await postDecision(id, { outcome: "approved", litres, note });
    const r = requests.find((x) => x.id === id);
    setToast({ tone: "ok", text: `Approved — ${litres} L loaded${r ? ` to ${r.driverName || r.driver || r.card}` : ""}.` }); setTimeout(() => setToast(null), 5000);
    await load();
  };
  const decline = async (id, note) => {
    await postDecision(id, { outcome: "declined", note });
    setToast({ tone: "ok", text: "Request sent back to the driver." }); setTimeout(() => setToast(null), 5000);
    await load();
  };
  const onAddDriver = async (d) => { await apiAddDriver(d); await load(); };

  const inModule = tab !== homeTab;           // showing a module over the menu
  const activeLabel = tab === "inbox" ? "Inbox" : (tabs.find(([k]) => k === tab) || [null, "Signed in"])[1];

  // The screen for the current tab — shared by both the phone and desktop shells.
  const content = (
    <>
      {err && <Flag tone="amber" title="Something went wrong">{err}</Flag>}
      {(!net.online || net.pending > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "9px 13px", borderRadius: 12,
          background: net.online ? "#EAF4FF" : "#FFF6E6", border: `1px solid ${net.online ? "#9CC3F0" : "var(--amber)"}` }}>
          <span style={{ fontSize: 16 }}>{net.online ? "🔄" : "📴"}</span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--navy)" }}>
            {!net.online
              ? <><b>Offline</b> — showing the last synced data.{net.pending > 0 ? ` ${net.pending} change${net.pending === 1 ? "" : "s"} will send when you're back online.` : ""}</>
              : <><b>{net.pending} change{net.pending === 1 ? "" : "s"} waiting to sync</b> — syncing now…</>}
          </div>
          {net.online && net.pending > 0 && <button className="disp" onClick={() => flushOutbox()} style={{ flexShrink: 0, border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Sync now</button>}
        </div>
      )}
      {/* Actionable items live ONLY in the Inbox (the bell + its badge) — they are
          no longer duplicated as separate cards on the home/module screens. */}
      {toast && (() => {
        const tv = typeof toast === "string" ? { text: toast, tone: "err" } : toast;
        const ok = tv.tone === "ok";
        return (
          <div onClick={() => setToast(null)} style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(78px + env(safe-area-inset-bottom))", zIndex: 400, maxWidth: 420, width: "calc(100% - 28px)",
            background: ok ? "#0F2A1B" : "#3A1212", color: ok ? "#DBF5E5" : "#FFE7E0", border: `1px solid ${ok ? "#2E7D5B" : "#B4442E"}`, borderRadius: 12, padding: "11px 14px", fontSize: 13, boxShadow: "0 8px 30px rgba(0,0,0,.35)", cursor: "pointer" }}>
            <span style={{ fontWeight: 700, marginRight: 6 }}>{ok ? "✓" : "⚠"}</span>{tv.text}
          </div>
        );
      })()}
      <ReleaseNotesModal />
      {updateReady && !mustUpdate && (
        <div style={{ position: "fixed", top: "calc(env(safe-area-inset-top) + 8px)", left: "50%", transform: "translateX(-50%)", zIndex: 500, maxWidth: 460, width: "calc(100% - 24px)",
          background: "#22345C", color: "#fff", borderRadius: 12, padding: "10px 12px", boxShadow: "0 8px 30px rgba(0,0,0,.35)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 17, lineHeight: 1 }}>🔄</span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>A new version is available.</span>
          <button onClick={() => { try { if (isNative()) window.location.href = APK_URL; else window.location.reload(); } catch { /* ignore */ } }}
            style={{ border: "none", background: "#6BC048", color: "#08260F", fontWeight: 800, borderRadius: 8, padding: "7px 13px", fontSize: 13, cursor: "pointer" }}>
            {isNative() ? "Update" : "Refresh"}
          </button>
          <button onClick={() => { try { sessionStorage.setItem("da_update_dismissed", String(updateReady)); } catch { /* ignore */ } setUpdateReady(false); }}
            aria-label="Dismiss" style={{ border: "none", background: "none", color: "#fff", fontSize: 19, cursor: "pointer", lineHeight: 1, opacity: .85 }}>×</button>
        </div>
      )}
      {outboxFail && (
        <div style={{ background: "#FDECEA", border: "1px solid #E4A79E", borderLeft: "4px solid #C0563A", borderRadius: 12, padding: "12px 14px", margin: "0 0 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontWeight: 800, color: "#8A2E1E" }}>⚠ {outboxFail.length} offline submission{outboxFail.length === 1 ? "" : "s"} didn’t go through</span>
            <button onClick={() => setOutboxFail(null)} style={{ border: "none", background: "none", color: "#8A2E1E", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
          <div style={{ fontSize: 12.5, color: "#7A3527", marginTop: 4, lineHeight: 1.5 }}>
            The server rejected {outboxFail.length === 1 ? "it" : "them"} when your connection came back — please redo {outboxFail.length === 1 ? "it" : "them"}:
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {outboxFail.slice(0, 5).map((f, i) => <li key={i} style={{ marginBottom: 2 }}><b>{(f.path || "").replace("/api/", "")}</b> — {f.error}</li>)}
            </ul>
          </div>
        </div>
      )}
      <ErrorBoundary key={tab}><div className="rise">
        {tab === "dhome" && <><DeliveriesDue onGo={goDeliver} /><DriverHome me={me} cards={cards} requests={requests} onRequest={() => { setPrefill(null); setTab("drequest"); }} onEdit={(req) => { setPrefill(req); setTab("drequest"); }} onDelivery={() => goDeliver("deliver", null)} onApprove={() => setTab("dapprove")} onTrip={(t) => { setPrefill({ id: t.tripNo, tripNo: t.tripNo, mode: "delivery" }); setTab("drequest"); }} /></>}
        {tab === "dcard" && <DriverCard me={me} cards={cards} requests={requests} />}
        {(tab === "driver" || tab === "drequest") && <DriverMode key={prefill ? prefill.id : "new"} initial={prefill} me={me} drivers={drivers} horses={horses} onSubmit={submit} cards={cards} requests={requests} gkey={gkey} onSent={() => { setPrefill(null); if (me.kind === "driver") setTab("dhome"); }} />}
        {tab === "approver" && <ApproverMode drivers={drivers} requests={requests} cards={cards} onApprove={approve} onDecline={decline} gkey={gkey} focusRef={focus && focus.tab === "approver" ? focus.ref : null} onFocused={() => setFocus(null)} />}
        {tab === "cardsys" && <CardSystem requests={requests} />}
        {tab === "fleet" && <FleetEfficiency horses={horses} />}
        {tab === "approvals" && <ApprovalsHistory />}
        {tab === "intel" && <IntelligenceMode />}
        {tab === "cockpit" && <Cockpit me={me} tabs={tabs.map(([k]) => k)} />}
        {tab === "wetstock" && <WetstockView />}
        {tab === "cash" && <CashView />}
        {tab === "staff" && <StaffAssignment />}
        {tab === "unlocks" && <UnlockRequests />}
        {tab === "devices" && <DeviceRequests />}
        {tab === "tracking" && <JourneyTracking />}
        {tab === "deposit" && <SiteDeposit me={me} />}
        {tab === "cashoffice" && <CashOffice />}
        {(tab === "digest" || tab === "radar") && <RadarView />}
        {tab === "exec" && <ExecutiveDashboard />}
        {tab === "birdseye" && <ManagerBirdsEye me={me} />}
        {tab === "hub" && <><DeliveriesDue onGo={goDeliver} /><Hub me={me} modules={tabs.filter(([k]) => k !== "hub")} onOpen={setTab} /></>}
        {tab === "inbox" && <Inbox items={alerts?.items || []} onOpen={setTab} />}
        {tab === "feedback" && <FeedbackView me={me} currentTab={prevTabRef.current} />}
        {tab === "master" && !isMobileApp() && <MasterData drivers={drivers} horses={horses} onAddDriver={onAddDriver} gkey={gkey} setGkey={setGkey} />}
        {/* super-app modules */}
        {tab === "submit" && <SiteSubmit me={me} />}
        {tab === "retail" && <RetailDashboard />}
        {tab === "inflows" && <CashInflows />}
        {tab === "deliver" && <DeliverySubmit me={me} initial={deliverPrefill} onLeave={() => setDeliverPrefill(null)} />}
        {tab === "recon" && <WarehouseImports me={me} />}
        {tab === "schedule" && <ScheduleDelivery me={me} drivers={drivers} horses={horses} />}
        {tab === "dapprove" && <DeliveryApprovals me={me} initial={deliverPrefill} onLeave={() => setDeliverPrefill(null)} />}
        {tab === "incoming" && <DeliveriesInProgress />}
        {tab === "deliverynotes" && <ApprovedDeliveries onCapture={(tripNo, site) => { setDeliverPrefill({ tripNo, site }); setTab("deliver"); }} />}
        {tab === "flow" && <DeliveryFlow />}
        {tab === "logistics" && <LogisticsDashboard />}
        {tab === "league" && <DriverLeague />}
        {tab === "inventory" && <InventoryView />}
        {tab === "rrequest" && <RetailRequest me={me} />}
        {tab === "yardwork" && <YardWorkshop me={me} />}
        {tab === "fleetstatus" && <TruckStatus />}
      </div></ErrorBoundary>
    </>
  );

  // ---- Tablet / desktop: a persistent side rail with the full module list ----
  if (wide && tabs.length > 1) {
    return (
      <div className="da shell">
        <style>{CSS}</style>
        <aside className={"side" + (rail ? " rail" : "")} style={{ position: "relative" }}>
          <button className="railbtn" onClick={() => { const n = !rail; setRail(n); try { localStorage.setItem("da_rail", n ? "1" : "0"); } catch { /* ignore */ } }} aria-label={rail ? "Expand menu" : "Collapse menu"}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d={rail ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} /></svg>
          </button>
          <div className="brand" onClick={() => homeTab && setTab(homeTab)} style={{ cursor: "pointer" }} title="Home" role="button">
            <img src="/da-logo.png" alt="DA" width="30" height="30" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.35))" }} />
            <div className="disp" style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>DA <span style={{ color: "var(--lime)" }}>OPS</span></div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", paddingRight: 2 }}>
            {(() => {
              // Sidebar labels + grouping come from the SAME source as the Home cards
              // (MODULE_META) so the two views read 100% identically. Home sits at the
              // top; the rest fall under the same section headers as the icon grid.
              const lbl = (k, fb) => MODULE_META[k]?.label || fb;
              const navBtn = ([k, t]) => (
                <button key={k} className={"snav" + (tab === k ? " on" : "")} onClick={() => setTab(k)} aria-current={tab === k} title={lbl(k, t)}>
                  <NavIcon k={k} on={tab === k} /><span>{lbl(k, t)}</span>
                </button>
              );
              const home = tabs.filter(([k]) => k === homeTab);
              const rest = tabs.filter(([k]) => k !== homeTab);
              const groups = MODULE_GROUPS.map((g) => [g, rest.filter(([k]) => MODULE_META[k]?.group === g)]).filter(([, m]) => m.length);
              const ungrouped = rest.filter(([k]) => !MODULE_META[k]?.group);
              return (<>
                {home.map(navBtn)}
                {groups.map(([g, mods]) => (
                  <div key={g} className="snavsec">
                    <div className="snavgroup"><span className="dot" style={{ background: (GROUP_COLOR[g] || GROUP_COLOR.Admin).a }} />{g}</div>
                    {mods.map(navBtn)}
                  </div>
                ))}
                {ungrouped.map(navBtn)}
              </>);
            })()}
          </div>
          <div className="sfoot">
            <div className="who" style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.name}</div>
              <div className="disp" style={{ fontSize: 11, letterSpacing: ".06em", color: "var(--lime)" }}>{me.kind}</div>
            </div>
            <BellButton count={alerts?.count || 0} onClick={() => setTab("inbox")} />
            <button onClick={() => setShowAbout(true)} aria-label="About" style={{ background: "rgba(255,255,255,.12)", color: "#EAF0FA", padding: 9, borderRadius: 11, display: "grid", placeItems: "center" }}>
              <IconInfo />
            </button>
            <button onClick={leave} aria-label="Sign out" style={{ background: "rgba(255,255,255,.12)", color: "#EAF0FA", padding: 9, borderRadius: 11, display: "grid", placeItems: "center" }}>
              <IconExit />
            </button>
          </div>
        </aside>
        <main className="wmain">
          {TEST_GPS && tab === "driver" && <TestBar />}
          <div className="wmain-inner">{content}</div>
        </main>
        {showAbout && <About onClose={() => setShowAbout(false)} />}
      </div>
    );
  }

  // ---- Phone: menu (hub) → module → Back. No bottom bar. ----
  return (
    <div className="da" style={{ minHeight: "100%", paddingBottom: "calc(24px + env(safe-area-inset-bottom))" }}>
      <style>{CSS}</style>
      <header className="appbar">
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          {inModule ? (
            <button onClick={() => setTab(homeTab)} aria-label="Back to menu"
              style={{ background: "rgba(255,255,255,.12)", color: "#EAF0FA", padding: "8px 10px", borderRadius: 11, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
          ) : (
            <img src="/da-logo.png" alt="DA" width="34" height="34" style={{ display: "block", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.35))" }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="disp" style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{inModule ? activeLabel : <>DA <span style={{ color: "var(--lime)" }}>OPS</span></>}</div>
            <div className="mono" style={{ fontSize: 11, opacity: .7, marginTop: 3 }}>{inModule ? "Tap ‹ for the menu" : me.name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BellButton count={alerts?.count || 0} onClick={() => setTab("inbox")} />
            <button onClick={() => setShowAbout(true)} aria-label="About"
              style={{ background: "rgba(255,255,255,.12)", color: "#EAF0FA", padding: 9, borderRadius: 11, display: "grid", placeItems: "center" }}>
              <IconInfo />
            </button>
            <button onClick={leave} aria-label="Sign out"
              style={{ background: "rgba(255,255,255,.12)", color: "#EAF0FA", padding: 9, borderRadius: 11, display: "grid", placeItems: "center" }}>
              <IconExit />
            </button>
          </div>
        </div>
      </header>
      {TEST_GPS && tab === "driver" && <TestBar />}
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "16px 14px" }}>
        {content}
      </main>
      {showAbout && <About onClose={() => setShowAbout(false)} />}
    </div>
  );
}

/* ============================ DRIVER ============================== */
/* ===================== DRIVER HOME + MY CARD ===================== */
const SectionHead = ({ icon, title, tint, accent }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 10px 2px" }}>
    <div style={{ width: 30, height: 30, borderRadius: 10, background: tint, color: accent, display: "grid", placeItems: "center", flexShrink: 0 }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">{STEP_ICON_PATHS[icon]}</svg>
    </div>
    <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
  </div>
);

// The card is a USD wallet with per-product litre sub-balances. When the
// authoritative figures are present (usdCash != null) we show the wallet balance;
// otherwise we fall back to the ledger-derived litres balance.
// Fleet card balance is shown in LITRES (the authoritative petrol+diesel litre
// balance from the card system). The small USD wallet is noted underneath.
const BalanceHero = ({ card, balance, usdCash, petrolL, dieselL, children }) => {
  const parts = [];
  if (petrolL > 0) parts.push(`${L(petrolL)} L petrol`);
  if (dieselL > 0) parts.push(`${L(dieselL)} L diesel`);
  if (usdCash != null && Math.abs(usdCash) >= 0.5) parts.push(`$${usdCash.toLocaleString(undefined, { maximumFractionDigits: 0 })} wallet`);
  return (
    <div style={{ background: "linear-gradient(150deg,#22345C,#14213D)", color: "#EAF0FA", borderRadius: 18, padding: 20, boxShadow: "0 12px 30px rgba(20,33,61,.22)" }}>
      <div className="disp" style={{ fontSize: 11, letterSpacing: ".12em", color: "#8FA0C4" }}>Card balance</div>
      <div className="mono" style={{ fontSize: 46, fontWeight: 500, color: "var(--lime)", lineHeight: 1.1, letterSpacing: "-.02em" }}>{L(balance)}<span style={{ fontSize: 16, color: "#8FA0C4", marginLeft: 6 }}>L</span></div>
      <div className="mono" style={{ fontSize: 11, color: "#9FB0D0", marginTop: 4 }}>card {card}{parts.length ? ` · ${parts.join(" · ")}` : ""}</div>
      {children}
    </div>
  );
};

function DriverHome({ me, cards, requests, onRequest, onEdit, onDelivery, onApprove, onTrip }) {
  const c = cards[me.card] || { balance: 0, loads: [], redemptions: [], legs: [] };
  const mine = requests.filter((r) => r.card === me.card);
  const open = mine.filter((r) => r.status === "pending" || r.status === "approved");
  const declined = mine.filter((r) => r.status === "declined");
  // Recent activity = settled requests only — the in-flight (open) and needs-changes
  // (declined) ones already have their own sections above, so don't repeat them here.
  const history = mine.filter((r) => r.status !== "pending" && r.status !== "approved" && r.status !== "declined");
  const first = (me.name || "").split(" ")[0];
  const [myTrips, setMyTrips] = useState([]);
  useEffect(() => { getMyTrips().then((r) => setMyTrips(r.trips || [])).catch((e) => window.dispatchEvent(new CustomEvent("da-load-error", { detail: "Couldn't load your scheduled trips — " + (e.message || "pull to refresh.") }))); }, []);
  return (
    <div>
      <h2 style={{ margin: "2px 0 16px", fontSize: "clamp(22px,6vw,28px)" }}>Hi {first} 👋</h2>
      <div style={{ marginBottom: 14 }}>
        <BalanceHero card={me.card} balance={c.balance} usdCash={c.usdCash} petrolL={c.petrolL} dieselL={c.dieselL}>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            {/* delivery-note filing moved to supervisors; drivers confirm arrival/
                collection/offload from the "Deliveries due" list above, not here */}
            <button onClick={onRequest} className="disp pill pill-lime" style={{ flex: 1 }}>New request</button>
          </div>
        </BalanceHero>
      </div>
      {onApprove && (
        <div onClick={onApprove} role="button" className="card"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "13px 15px", marginBottom: 14, cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>✍️</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--navy)" }}>Sign off delivery notes</div>
              <div style={{ fontSize: 11.5, color: "var(--steel)" }}>Approve delivery notes waiting on you</div>
            </div>
          </div>
          <span style={{ color: "var(--steel)", fontSize: 18 }}>›</span>
        </div>
      )}
      <DriverPerformance />
      {myTrips.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <SectionHead icon="route" title="Pending trips" tint="#FEF4E6" accent="#C07A00" />
          {myTrips.map((t) => {
            // Only a trip with NO fuel request yet (and not collected) taps through to
            // the request form. Once fuel is requested/collected, the card is NOT
            // clickable — the rest of the trip is driven by "Deliveries due" (confirm
            // arrival → sign off), so the driver is never bounced back to request fuel.
            // A trip may be fuelled by more than one request (a top-up after logistics
            // grow the route), so the card stays actionable until the truck is collected.
            const canRequest = onTrip && !t.collected;
            return (
            <div key={t.tripNo} role={canRequest ? "button" : undefined} onClick={canRequest ? () => onTrip(t) : undefined} className="card" style={{ padding: 14, marginBottom: 10, borderLeft: "4px solid var(--amber)", cursor: canRequest ? "pointer" : "default" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span className="mono" style={{ fontWeight: 700, color: "var(--navy)" }}>{t.tripNo}</span>
                <span className="mono" style={{ fontSize: 12, color: "var(--steel)" }}>{L(t.qty)} L {t.product}</span>
              </div>
              <div className="mono" style={{ fontSize: 12, color: "var(--steel)", marginTop: 3 }}>{t.warehouse}{t.truck ? " · " + t.truck : ""} · {fmtD(t.date)}</div>
              <div style={{ fontSize: 12, color: "var(--ink)", marginTop: 4 }}>{(t.drops || []).map((d) => `${d.site} ${L(d.qty)}L`).join(" · ")}</div>
              {t.fuelRequested > 0
                ? (() => {
                    // State the TRUE next step from the drop-level counts, never a static
                    // "on the road" — so this never contradicts "Deliveries due" above.
                    const toArrive = t.toArrive || 0, awNote = t.awaitingNote || 0, awSign = t.awaitingSignoff || 0;
                    let msg, tone = "#3C9A52";
                    if (!t.collected) msg = `collect the load from ${t.warehouse}, then confirm each drop in “Deliveries due”`;
                    else if (toArrive > 0) { msg = `on the road — ${toArrive} drop${toArrive > 1 ? "s" : ""} still to deliver · confirm each in “Deliveries due”`; tone = "#C07A00"; }
                    else if (awSign > 0) { msg = `sign off ${awSign} delivery note${awSign > 1 ? "s" : ""} in “Deliveries due”`; tone = "#C07A00"; }
                    else if (awNote > 0) msg = `all drops delivered — waiting for the site to dip & file. Nothing to do now.`;
                    else msg = `all drops delivered.`;
                    return <div style={{ fontSize: 11.5, color: tone, fontWeight: 700, marginTop: 8 }}>✓ Fuel requested {L(t.fuelRequested)} L · {msg}{canRequest && <span style={{ color: "var(--amber)", fontWeight: 700 }}> · tap to top up if the route grew ›</span>}</div>;
                  })()
                : (onTrip && <div style={{ fontSize: 11.5, color: "var(--amber)", fontWeight: 700, marginTop: 8 }}>Request fuel for this trip ›</div>)}
            </div>);
          })}
        </div>
      )}
      {declined.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <SectionHead icon="gauge" title="Needs changes" tint="#FDECEA" accent="var(--red)" />
          {declined.map((r) => (
            <div key={r.id} className="card" style={{ padding: 15, marginBottom: 10, borderLeft: "4px solid var(--red)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 600 }}>{r.id} · {r.horse}{r.trailer ? ` ${r.trailer}` : ""}</div>
                <div className="mono" style={{ color: "var(--steel)", fontSize: 12 }}>{r.mode === "delivery" ? `${L(r.km)} km` : (r.reason || "general")}</div>
              </div>
              {r.note && <div style={{ fontSize: 13, color: "var(--red)", marginTop: 6 }}>“{r.note}”</div>}
              <button onClick={() => onEdit(r)} className="disp pill" style={{ marginTop: 12, width: "100%" }}>Edit &amp; resend</button>
            </div>))}
        </div>
      )}
      {open.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <SectionHead icon="route" title="Request status" tint="#EDE8FD" accent="#7A5AF0" />
          <div className="card" style={{ padding: 8 }}>{open.map((r) => <RequestLine key={r.id} r={r} />)}</div>
        </div>
      )}
      {(c.redemptions.length > 0 || history.length > 0 || mine.length === 0) && (
        <div style={{ marginBottom: 18 }}>
          <SectionHead icon="check" title="Recent fuel drawn" tint="#E9F5E2" accent="#3E8E28" />
          {c.redemptions.length === 0 && mine.length === 0
            ? <div className="card" style={{ padding: 18, color: "var(--steel)", fontSize: 14 }}>No fuel drawn yet. Tap “New request” to raise your first one.</div>
            : c.redemptions.length > 0
              ? <div className="card" style={{ padding: 8 }}>{c.redemptions.slice().reverse().slice(0, 8).map((rd, i, a) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "9px 10px", borderBottom: i < a.length - 1 ? "1px solid var(--line)" : "none" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--navy)" }}>{rd.station || "—"}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--steel)" }}>{rd.date ? fmtD(rd.date) : "—"}{rd.horse ? ` · ${rd.horse}` : ""}{rd.odo ? ` · ${L(rd.odo)} km` : ""}</div>
                    </div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>{L(rd.litres)} L</div>
                  </div>))}</div>
              : <div className="card" style={{ padding: 8 }}>{history.slice(0, 8).map((r) => <RequestLine key={r.id} r={r} />)}</div>}
        </div>
      )}
      {c.legs.length > 0 && (
        <div>
          <SectionHead icon="gauge" title="Trips · fill to fill" tint="#FBEDD6" accent="#C07A00" />
          <div style={{ fontSize: 11.5, color: "var(--steel)", margin: "-6px 2px 8px" }}>Distance & fuel efficiency between consecutive fills — town runs read lower than open road.</div>
          <div className="card" style={{ padding: 8 }}>
            {c.legs.slice().reverse().slice(0, 8).map((l, i, a) => (
              <div key={i} style={{ padding: "9px 10px", borderBottom: i < a.length - 1 ? "1px solid var(--line)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: "var(--navy)", minWidth: 0 }}>{l.from && l.to ? `${l.from} → ${l.to}` : (l.to || l.from || "trip")}</span>
                  <span className="mono" style={{ fontWeight: 700, whiteSpace: "nowrap", color: l.kmpl < 1.5 ? "var(--red)" : "var(--blue)" }}>{l.kmpl.toFixed(2)} km/L</span>
                </div>
                <div className="mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 2 }}>{l.date ? fmtD(l.date) : "—"}{l.horse ? ` · ${l.horse}` : ""} · {L(l.dist)} km · {L(l.litres)} L</div>
              </div>))}
          </div>
        </div>
      )}
    </div>
  );
}

function DriverCard({ me, cards, requests }) {
  const c = cards[me.card] || { balance: 0, loads: [], redemptions: [], legs: [] };
  const loaded = c.loads.reduce((s, x) => s + x.litres, 0);
  const taken = c.redemptions.reduce((s, x) => s + x.litres, 0);
  const pending = requests.filter((r) => r.card === me.card && r.status === "pending").length;
  return (
    <div>
      <div style={{ marginBottom: 16 }}><BalanceHero card={me.card} balance={c.balance} usdCash={c.usdCash} petrolL={c.petrolL} dieselL={c.dieselL} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 18 }}>
        {[["Loaded", L(loaded)], ["Taken", L(taken)], ["Pending", pending]].map(([k, v]) => (
          <div key={k} className="card" style={{ padding: 12, textAlign: "center" }}>
            <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{v}</div>
            <div className="lbl" style={{ margin: "4px 0 0" }}>{k}</div>
          </div>))}
      </div>
      <div style={{ marginBottom: 18 }}>
        <SectionHead icon="gauge" title="Trips · fill to fill" tint="#FBEDD6" accent="#C07A00" />
        {c.legs.length === 0
          ? <div className="card" style={{ padding: 18, color: "var(--steel)", fontSize: 14 }}>No completed trips yet — a trip is measured between two fills.</div>
          : <div className="card" style={{ padding: 8 }}>
              {c.legs.slice().reverse().map((l, i, a) => (
                <div key={i} style={{ padding: "9px 10px", borderBottom: i < a.length - 1 ? "1px solid var(--line)" : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--navy)", minWidth: 0 }}>{l.from && l.to ? `${l.from} → ${l.to}` : (l.to || l.from || "trip")}</span>
                    <span className="mono" style={{ fontWeight: 700, whiteSpace: "nowrap", color: l.kmpl < 1.5 ? "var(--red)" : "var(--blue)" }}>{l.kmpl.toFixed(2)} km/L</span>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 2 }}>{l.date ? fmtD(l.date) : "—"}{l.horse ? ` · ${l.horse}` : ""} · {L(l.dist)} km · {L(l.litres)} L</div>
                </div>))}
            </div>}
      </div>
      <div>
        <SectionHead icon="drop" title="Fuel taken" tint="#EDE8FD" accent="#7A5AF0" />
        {c.redemptions.length === 0
          ? <div className="card" style={{ padding: 18, color: "var(--steel)", fontSize: 14 }}>Nothing drawn yet.</div>
          : <AcctTable head={<><Th>Station</Th><Th right>Odometer</Th><Th right>Litres</Th></>}>
              {c.redemptions.slice().reverse().map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                  <Td>{r.station || "—"}</Td><Td right>{r.odo ? L(r.odo) + " km" : "—"}</Td>
                  <Td right style={{ fontWeight: 700 }}>{L(r.litres)}</Td>
                </tr>))}
            </AcctTable>}
      </div>
    </div>
  );
}

/* ==================== DRIVER — request wizard ==================== */
// Shows the multi-request picture for a trip: which request this is (1st/2nd/…), the
// 110% cap on the running total, and — for a top-up — exactly what changed in the trip
// (drops, distance) and the fuel adjustment that follows. Used on the driver's request
// screen (compose) and on the approver's card (review) so both see the SAME thing.
function FuelContextBanner({ ctx }) {
  if (!ctx) return null;
  const review = ctx.mode === "review";
  const seq = ctx.sequence || 1;
  const ord = ["", "1st", "2nd", "3rd", "4th", "5th", "6th"][seq] || `${seq}th`;
  const ch = ctx.changes;
  const kmUp = ch && ch.kmDelta != null && ch.kmDelta !== 0;
  const litUp = ch && ch.litresDelta != null && ch.litresDelta !== 0;
  const box = { background: seq > 1 ? "#FFF6E9" : "#EEF2FF", border: `1px solid ${seq > 1 ? "#EAD3A0" : "#C9D4F5"}`, borderRadius: 12, padding: "11px 13px", marginBottom: 12, fontSize: 12.5, color: "var(--navy)", lineHeight: 1.55 };
  const chip = (t, tone) => <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: tone === "add" ? "#E4F3E8" : "#FBE7E4", color: tone === "add" ? "#2C6B3F" : "#A23A2E", marginRight: 5, marginTop: 3 }}>{t}</span>;
  return (
    <div style={box}>
      <div style={{ fontWeight: 800, marginBottom: 5 }}>
        {seq > 1 ? `${ord} fuel request for this trip` : "First fuel request for this trip"}
      </div>
      {seq > 1 && ch && ch.changed && (
        <div style={{ marginBottom: 7 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>What changed since the previous request:</div>
          {(ch.dropsAdded || []).map((s, i) => <span key={"a" + i}>{chip("+ " + s, "add")}</span>)}
          {(ch.dropsRemoved || []).map((s, i) => <span key={"r" + i}>{chip("− " + s, "rm")}</span>)}
          {kmUp && <div style={{ marginTop: 4 }}>Distance: <b>{L(ch.kmPrev)} → {L(ch.kmNow)} km</b> <span style={{ color: ch.kmDelta > 0 ? "#A23A2E" : "#2C6B3F", fontWeight: 700 }}>({ch.kmDelta > 0 ? "+" : ""}{L(ch.kmDelta)} km)</span></div>}
          {litUp && <div>Route fuel: <b>{L(ch.litresPrev)} → {L(ch.litresNow)} L</b> <span style={{ color: ch.litresDelta > 0 ? "#A23A2E" : "#2C6B3F", fontWeight: 700 }}>({ch.litresDelta > 0 ? "+" : ""}{L(ch.litresDelta)} L)</span></div>}
        </div>
      )}
      {seq > 1 && ch && !ch.changed && (
        <div style={{ marginBottom: 7, color: "var(--steel)" }}>The trip route hasn't changed since the last request.</div>
      )}
      <div className="mono" style={{ fontSize: 11.5, color: "var(--steel)" }}>
        {ctx.recommended != null && <>Route needs <b style={{ color: "var(--navy)" }}>{L(ctx.recommended)} L</b> · cap <b style={{ color: "var(--navy)" }}>{L(ctx.cap)} L</b> (110%)</>}
        {review
          ? (ctx.alreadyAllocatedBefore > 0 && <> · earlier fills {L(ctx.alreadyAllocatedBefore)} L · this request {ctx.thisRequest ? L(ctx.thisRequest.litres) : "—"} L</>)
          : (<> · already allocated {L(ctx.alreadyAllocated)} L · <b style={{ color: "var(--navy)" }}>{L(ctx.headroom)} L</b> headroom</>)}
      </div>
      {!review && ctx.headroom != null && ctx.headroom <= 0 && (
        <div style={{ marginTop: 6, fontWeight: 700, color: "#A23A2E" }}>Already at the 110% cap — no more fuel can be added unless logistics grow the route.</div>
      )}
      {!review && seq > 1 && ctx.headroom > 0 && ctx.suggested != null && (
        <div style={{ marginTop: 6, fontWeight: 700, color: "#8A5A00" }}>Suggested top-up: {L(ctx.suggested)} L</div>
      )}
    </div>
  );
}

function DriverMode({ me, drivers, horses, onSubmit, cards, requests, gkey, onSent, initial }) {
  const locked = me && me.kind === "driver" ? me.card : null; // a driver is bound to their own card
  const init = initial || {};
  const initFleet = init.mode === "delivery";
  const [card, setCard] = useState(locked || "");
  const [horse, setHorse] = useState(initFleet ? (init.horse || "") : "");
  const [trailer, setTrailer] = useState(init.trailer || "");
  const [veh, setVeh] = useState(init.mode === "general" ? (init.horse || "") : "");
  const [fuelStn, setFuelStn] = useState(init.station || "");
  const [geo, setGeo] = useState({ state: "idle" });
  const [odo, setOdo] = useState("");
  const [photo, setPhoto] = useState(null);
  const [ocr, setOcr] = useState({ state: "idle" });
  const [drops, setDrops] = useState(initFleet && Array.isArray(init.stops) ? init.stops.slice(1, -1) : []);
  const [end, setEnd] = useState(initFleet && Array.isArray(init.stops) && init.stops.length > 1 ? init.stops[init.stops.length - 1] : "");
  const [pick, setPick] = useState("");
  const [ask, setAsk] = useState(init.mode === "general" ? String(init.calcLitres || "") : "");
  const [reason, setReason] = useState(init.mode === "general" ? (init.reason || "") : "");
  const [sent, setSent] = useState(null);
  const [sendErr, setSendErr] = useState(null);
  const [sending, setSending] = useState(false);
  const [step, setStep] = useState(0);
  const [tripNo, setTripNo] = useState(init.tripNo || "");
  const [myTrips, setMyTrips] = useState([]);
  const [fuelCtx, setFuelCtx] = useState(null);   // multi-request context for the picked trip
  // When a trip is picked, pull its fuel context: which request this would be (1st/2nd/…),
  // what the current route recommends, the 110% cap and remaining headroom, and — for a
  // top-up — exactly what changed in the trip since the last request. Prefill the suggested
  // top-up so the driver isn't guessing.
  useEffect(() => {
    setFuelCtx(null);
    if (!tripNo) return;
    let live = true;
    getTripFuelContext(tripNo).then((c) => { if (live) setFuelCtx(c); }).catch(() => {});
    return () => { live = false; };
  }, [tripNo]);
  useEffect(() => { getMyTrips().then((r) => setMyTrips(r.trips || [])).catch((e) => window.dispatchEvent(new CustomEvent("da-load-error", { detail: "Couldn't load your scheduled trips — " + (e.message || "pull to refresh.") }))); }, []);
  // arriving via "Request fuel for this trip": the trip number is preset before the
  // trip list loads — back-fill the horse, trailer, drops and end point once it does.
  useEffect(() => {
    if (!tripNo || !myTrips.length) return;
    const t = myTrips.find((x) => x.tripNo === tripNo);
    if (!t) return;
    if (t.truck && !horse) setHorse(t.truck);
    if (t.trailer && !trailer) setTrailer(t.trailer);
    setDrops((d) => (d && d.length ? d : (t.drops || []).map((x) => x.site)));
    setEnd((e) => e || t.endPoint || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTrips, tripNo]);

  const driver = drivers.find((d) => d.card === card);
  const isFleet = driver?.type === "fleet";
  const h = horses.find((x) => x.code === horse);
  const kmpl = h?.kmpl ?? FLEET_MEDIAN;

  useEffect(() => { if (h && !trailer) setTrailer(h.trailer); }, [horse]);

  // ask for location the moment the app opens, so the driver is not stopped at the pump
  useEffect(() => { primeLocation().then((r) => { if (r === "blocked") setGeo({ state: "blocked" }); }); }, []);
  // coming back from the phone's Location settings: re-verify AUTOMATICALLY the
  // moment the app is visible again — no "check again" tap needed.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && (geo.state === "off" || geo.state === "nofix") && fuelStn) locate(fuelStn); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.state, fuelStn]);
  // resending a declined request: re-verify GPS for the prefilled station
  useEffect(() => { if (init.station) locate(init.station); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const check = (here, acc, stn) => {
    const target = stn || fuelStn;
    const want = findStation(target);
    const m = Math.round(hav(here, want) * 1000);
    // capture the GPS and allow, flagging when it's beyond the tight radius
    if (m <= SURVEY_TOLERANCE_M) {
      return setGeo({ state: "onsite", station: target, m, acc, approx: m > ON_SITE_RADIUS_M, lat: here.lat, lon: here.lon });
    }
    let near = null;
    STATIONS.forEach((s) => { const d = hav(here, s) * 1000; if (!near || d < near.m) near = { s, m: d }; });
    const atOther = near && near.m <= ON_SITE_RADIUS_M ? near.s.name : null;
    setGeo({ state: "wrongplace", want: target, m, atOther, nearest: near?.s.name, nearM: Math.round(near?.m ?? 0), acc });
  };
  const locate = async (stn) => {
    const target = stn || fuelStn;
    if (!target) return;
    setGeo({ state: "locating" });
    // testing override: pretend we are standing at the chosen station
    if (TEST_GPS && typeof window !== "undefined" && window.__DA_TEST_SITE) {
      const s = STATIONS.find((x) => x.name === window.__DA_TEST_SITE);
      if (s) return check({ lat: s.lat, lon: s.lon }, 8, target);
    }
    try {
      const fix = await getFix();
      check({ lat: fix.lat, lon: fix.lon }, fix.acc, target);
    } catch (e) {
      setGeo(e.code === 1
        ? { state: "blocked" }
        : e.code === 3
          ? { state: "off" }
          : { state: "nofix", why: "The phone could not find you. Step out from under the canopy and try again." });
    }
  };

  const capture = async () => {
    try {
      const { dataUrl, blob } = await takeOdometerPhoto();
      setPhoto(dataUrl);
      setOcr({ state: "reading" });
      setOcr(await readOdometer(blob));
    } catch (e) {
      if (String(e.message) !== "no file") setOcr({ state: "failed", why: String(e.message || e) });
    }
  };

  const lastOdo = card ? cards[card]?.lastOdo : null;
  const odoNum = parseFloat(odo);
  const odoBad = odo !== "" && (!isFinite(odoNum) || (lastOdo != null && odoNum <= lastOdo));
  const ocrGap = ocr.state === "read" && isFinite(odoNum) ? Math.abs(ocr.value - odoNum) : null;
  const ocrMismatch = ocrGap != null && ocrGap > OCR_TOLERANCE;

  const full = [fuelStn, ...drops, end].filter(Boolean);
  const journeyOk = isFleet ? !!(fuelStn && end) : true;
  const route = useRoute(isFleet && journeyOk ? full : [], gkey);
  const km = route && !route.loading ? route.km : 0;
  const est = route && !route.loading ? estimate(full, route.legs, horse) : null;
  const calc = isFleet && est ? est.rounded : null;
  // For a 2nd/3rd request on a trip, the ask is the TOP-UP the server suggests (the extra
  // the grown route needs), not the whole-route estimate again — and it's held to the cap.
  const isTopUp = fuelCtx && fuelCtx.mode === "compose" && fuelCtx.sequence > 1;
  const calcEff = isFleet ? (isTopUp && fuelCtx.suggested != null ? fuelCtx.suggested : calc) : null;
  const openBal = card ? cards[card]?.balance ?? 0 : 0;

  const vehicleOk = isFleet ? !!(horse && trailer) : !!veh;
  const missing = [];
  if (!driver) missing.push("your name");
  if (driver && isFleet && !horse) missing.push("the horse");
  if (driver && isFleet && !trailer) missing.push("the trailer");
  if (driver && !isFleet && !veh) missing.push("the vehicle");
  if (!fuelStn) missing.push("the station you are fuelling from");
  else if (geo.state === "blocked") missing.push("location permission for the app");
  else if (geo.state === "off") missing.push("GPS switched on (phone settings)");
  else if (geo.state !== "onsite") missing.push("GPS confirmation that you are at " + fuelStn);
  if (!odo) missing.push("the odometer reading");
  else if (odoBad) missing.push("an odometer reading higher than " + L(lastOdo) + " km");
  if (!photo) missing.push("a photograph of the odometer");
  if (driver && isFleet && !end) missing.push("the end point of the journey");
  if (driver && !isFleet && !(parseFloat(ask) > 0)) missing.push("the litres you are asking for");
  // Trip already fuelled to its 110% cap and the route hasn't grown → nothing to top up.
  const capBlocked = isFleet && fuelCtx && fuelCtx.mode === "compose" && fuelCtx.headroom != null && fuelCtx.headroom <= 0;
  const ready = missing.length === 0 && !capBlocked;

  const send = async () => {
    setSending(true); setSendErr(null);
    try {
      await onSubmit({
        card, driver: driver.name, driverType: driver.type,
        horse: isFleet ? horse : veh, trailer: isFleet ? trailer : "",
        station: fuelStn, gpsAccuracy: geo.acc, gpsMetres: geo.m, gpsLat: geo.lat, gpsLon: geo.lon,
        start: fuelStn, drops, end,
        odo: odoNum, photo, ocr: ocr.state === "read" ? ocr.value : null, ocrConf: ocr.state === "read" ? ocr.conf : null,
        ocrState: ocr.state, ocrGap, ocrMismatch,
        mode: isFleet ? "delivery" : "general", stops: isFleet ? full : [], km, kmpl,
        distanceSource: route ? route.source : null, legs: route ? route.legs : null,
        locKm: est ? Math.round(est.locKm) : 0, hwyKm: est ? Math.round(est.hwyKm) : 0,
        blended: est ? +est.blended.toFixed(2) : kmpl,
        calcLitres: isFleet ? calcEff : parseFloat(ask), reason: isFleet ? "" : reason, openingBalance: openBal,
        tripNo: tripNo || null,
      });
      const msg = `${isFleet ? calcEff : parseFloat(ask)} L requested at ${fuelStn}`;
      setDrops([]); setEnd(""); setOdo(""); setAsk(""); setReason(""); setTripNo("");
      setPhoto(null); setOcr({ state: "idle" }); setGeo({ state: "idle" }); setFuelStn(""); setStep(0);
      // ALWAYS show the explicit "Sent for approval" confirmation so there's no doubt it
      // went through — otherwise the form silently resets and it looks unsent (→ re-click).
      setSent(msg);
      if (onSent) onSent(); // drivers also navigate to their dashboard (this unmounts the form)
    } catch (e) {
      setSendErr(e.message || "Could not send the request.");
    } finally {
      setSending(false);
    }
  };
  const mine = requests.filter((r) => r.card === card).slice(0, 4);

  // ---- wizard steps: one focused task per screen (Tiimo-style) ----
  const base = isFleet
    ? [
        { key: "vehicle", icon: "truck", accent: "#3E8E28", tint: "#E9F5E2", title: "Which truck today?", sub: "Pick your horse and trailer", done: vehicleOk },
        { key: "location", icon: "pin", accent: "var(--blue)", tint: "#E7ECFF", title: "Where are you?", sub: "The station you’re fuelling at", done: geo.state === "onsite" },
        { key: "odometer", icon: "gauge", accent: "#C07A00", tint: "#FBEDD6", title: "Odometer", sub: "Type it, then photograph it", done: !!odo && !odoBad && !!photo },
        { key: "journey", icon: "route", accent: "#7A5AF0", tint: "#EDE8FD", title: "Your journey", sub: "Where are you delivering?", done: journeyOk },
      ]
    : [
        { key: "vehicle", icon: "truck", accent: "#3E8E28", tint: "#E9F5E2", title: "What are you fuelling?", sub: "Pick the vehicle or equipment", done: !!veh },
        { key: "location", icon: "pin", accent: "var(--blue)", tint: "#E7ECFF", title: "Where are you?", sub: "The station you’re fuelling at", done: geo.state === "onsite" },
        { key: "odometer", icon: "gauge", accent: "#C07A00", tint: "#FBEDD6", title: "Odometer", sub: "Type it, then photograph it", done: !!odo && !odoBad && !!photo },
        { key: "usage", icon: "drop", accent: "#7A5AF0", tint: "#EDE8FD", title: "What’s it for?", sub: "Litres and purpose", done: parseFloat(ask) > 0 },
      ];
  const steps = locked ? base : [{ key: "who", icon: "user", accent: "var(--blue)", tint: "#E7ECFF", title: "Who’s requesting?", sub: "Select your name", done: !!driver }, ...base];
  const si = Math.min(step, steps.length - 1);
  const cur = steps[si];
  const isLast = si === steps.length - 1;
  const go = (d) => setStep(Math.max(0, Math.min(steps.length - 1, si + d)));

  const stepBody = (k) => {
    if (k === "who") return (
      <Field label="Driver">
        <Picker value={card} onChange={(v) => { setCard(v); setStep(0); setDrops([]); setHorse(""); setTrailer(""); setVeh(""); }}
          placeholder="Select your name" title="Driver" options={drivers.map((d) => ({ value: d.card, label: d.name }))} />
      </Field>
    );
    if (k === "vehicle") return isFleet ? (
      <>
        <Field label="Scheduled delivery trip">
          <Picker value={tripNo} title="Scheduled delivery trip" placeholder={myTrips.length ? "Select your trip…" : "No trip scheduled"}
            onChange={(v) => { setTripNo(v); const t = myTrips.find((x) => x.tripNo === v); if (t) { if (t.truck) setHorse(t.truck); if (t.trailer) setTrailer(t.trailer); setDrops((t.drops || []).map((d) => d.site)); setEnd(t.endPoint || ""); } }}
            options={myTrips.map((t) => ({ value: t.tripNo, label: `${t.tripNo} — ${t.warehouse} ${L(t.qty)}L → ${(t.drops || []).map((d) => d.site).join(", ")}${t.fuelRequested > 0 ? " · already fuelled" : ""}` }))} />
        </Field>
        {myTrips.length === 0 && <div style={{ fontSize: 11.5, color: "var(--amber)", marginTop: -6, marginBottom: 11 }}>No trip scheduled for you yet. Fleet fuel is requested against a planned trip — ask logistics to schedule it first, then it appears here.</div>}
        {fuelCtx && <FuelContextBanner ctx={fuelCtx} />}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Horse"><Picker value={horse} onChange={(v) => { setHorse(v); setTrailer(""); }} placeholder="Select" title="Horse" options={horses.map((x) => x.code)} /></Field>
          <Field label="Trailer"><Picker value={trailer} onChange={setTrailer} placeholder="Select" title="Trailer" options={TRAILERS} /></Field>
        </div>
        {h && <div className="mono" style={{ fontSize: 12, color: "var(--steel)" }}>{horse} normally runs with {h.trailer} · {h.kmpl.toFixed(2)} km/L{trailer && trailer !== h.trailer && <strong style={{ color: "var(--amber)" }}> · different trailer today</strong>}</div>}
      </>
    ) : (
      <Field label="Vehicle or equipment"><Picker value={veh} onChange={setVeh} placeholder="Select" title="Vehicle or equipment" options={RETAIL_VEH.map((v) => ({ value: v.code, label: `${v.code} — ${v.desc}` }))} /></Field>
    );
    if (k === "location") return (
      <>
        <Field label="Service station you are drawing fuel from">
          <Picker value={fuelStn} onChange={(v) => { setFuelStn(v); setGeo({ state: "idle" }); if (v) locate(v); }}
            placeholder="Select the station you are standing at" title="Service station" options={STATIONS.map((s) => s.name)} />
        </Field>
        {geo.state === "locating" && <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--paper)", borderRadius: 14, padding: 12 }}><span style={{ width: 16, height: 16, borderRadius: "50%", border: "2.5px solid var(--line)", borderTopColor: "var(--blue)", animation: "spin .8s linear infinite" }} /><span style={{ fontSize: 13 }}>Checking your location…</span></div>}
        {geo.state === "onsite" && <Flag tone={geo.approx ? "amber" : "ok"} title={geo.approx ? `GPS captured at ${geo.station}` : `Confirmed at ${geo.station}`}><span className="mono" style={{ fontSize: 11 }}>{geo.approx ? `${L(geo.m)} m from the recorded point · being surveyed` : `${geo.m} m from the site centre`} · fix ±{geo.acc} m</span></Flag>}
        {geo.state === "blocked" && (
          <div style={{ background: "var(--ink)", color: "#EDE9DC", borderRadius: 16, padding: 16 }}>
            <div className="disp" style={{ fontSize: 14, fontWeight: 700, color: "var(--lime)", marginBottom: 6 }}>Turn on location to request fuel</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>DA needs to see that you are standing at the pump. Nothing is tracked between requests.</div>
            <button onClick={() => locate()} className="disp pill pill-lime" style={{ width: "100%" }}>I have turned it on</button>
          </div>
        )}
        {geo.state === "off" && <Flag tone="red" title="GPS is switched OFF on this phone">Turn on Location in the phone settings, then come back and check again.<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={async () => { const opened = await openLocationSettings(); if (!opened) alert("Open the phone's Settings → Location and switch it ON, then come back."); }} className="disp" style={{ marginTop: 8, background: "var(--red)", color: "#fff", padding: "8px 16px", borderRadius: 100, fontSize: 13 }}>Open location settings</button>
          <button onClick={() => locate()} className="disp" style={{ marginTop: 8, background: "#fff", color: "var(--red)", border: "1.5px solid var(--red)", padding: "8px 16px", borderRadius: 100, fontSize: 13 }}>It&rsquo;s on — check again</button>
        </div></Flag>}
        {geo.state === "nofix" && <Flag tone="amber" title="Cannot find you yet">{geo.why}<div><button onClick={() => locate()} className="disp" style={{ marginTop: 8, background: "var(--amber)", color: "#fff", padding: "8px 16px", borderRadius: 100, fontSize: 13 }}>Try again</button></div></Flag>}
        {geo.state === "wrongplace" && <Flag tone="red" title="You are not at that station"><span className="mono" style={{ fontSize: 12 }}>{geo.want} is {L(geo.m)} m away{geo.atOther ? ` · you appear to be at ${geo.atOther}` : ` · nearest site is ${geo.nearest}, ${L(geo.nearM)} m`}</span><div style={{ marginTop: 4 }}>{geo.atOther ? `Change the station to ${geo.atOther}, or drive to ${geo.want}.` : "Pick the station you are actually standing at."}</div><button onClick={() => locate()} className="disp" style={{ marginTop: 8, background: "var(--red)", color: "#fff", padding: "8px 16px", borderRadius: 100, fontSize: 13 }}>Check again</button></Flag>}
      </>
    );
    if (k === "odometer") return (
      <>
        <Field label={lastOdo != null ? `Reading on the dash — last recorded ${L(lastOdo)} km` : "Reading on the dash"}>
          <input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 214530" style={{ borderColor: odoBad ? "var(--red)" : undefined }} />
        </Field>
        {odoBad && <div style={{ color: "var(--red)", fontSize: 13, marginTop: -8, marginBottom: 10 }}>Must be higher than the last recorded reading of {L(lastOdo)} km.</div>}
        <button onClick={capture} className="disp" style={{ width: "100%", padding: 14, fontSize: 14, fontWeight: 700, borderRadius: 100, marginBottom: 12, background: photo ? "#fff" : "var(--ink)", color: photo ? "var(--ink)" : "#fff", border: photo ? "1.5px solid var(--line)" : "none" }}>{photo ? "Retake photo" : "Photograph the odometer"}</button>
        {photo && <img src={photo} alt="Odometer" style={{ maxWidth: "100%", maxHeight: 170, borderRadius: 14, border: "1.5px solid var(--line)", marginBottom: 10, display: "block" }} />}
        {ocr.state === "reading" && <Flag tone="amber" title="Reading the photograph…">This takes a few seconds.</Flag>}
        {ocr.state === "read" && !ocrMismatch && ocrGap != null && <Flag tone="ok" title="Photo matches the typed reading"><span className="mono">read {L(ocr.value)} · typed {L(odoNum)} · {ocr.conf}%</span></Flag>}
        {ocr.state === "read" && ocrMismatch && <Flag tone="red" title="Photo doesn’t match what was typed"><span className="mono">read {L(ocr.value)} · typed {L(odoNum)} · {L(ocrGap)} km apart</span><div style={{ marginTop: 4 }}>You can still send — the approver will see this.</div></Flag>}
        {ocr.state === "nodigits" && <Flag tone="amber" title="No reading found in the photo">Take it again, straight on and close.</Flag>}
        {(ocr.state === "failed" || ocr.state === "unavailable") && <Flag tone="amber" title="Photo saved, not checked">The approver will check it by eye.</Flag>}
      </>
    );
    if (k === "journey") return (
      <>
        <div style={{ background: "var(--ink)", color: "#EDE9DC", borderRadius: 14, padding: "10px 14px", marginBottom: 14 }}>
          <div className="lbl" style={{ color: "#8FA0C4", marginBottom: 2 }}>Start · fixed by GPS</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{fuelStn || "—"}</div>
        </div>
        {tripNo && (() => {
          const t = myTrips.find((x) => x.tripNo === tripNo);
          return (
            <div style={{ background: "#EEF2FF", border: "1px solid #C9D4F5", borderRadius: 12, padding: "11px 13px", marginBottom: 12, fontSize: 12.5, color: "var(--navy)", lineHeight: 1.55 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>🚚 Trip {tripNo} — your delivery</div>
              {t ? (<>
                <div style={{ marginBottom: 6 }}>Collect <b>{L(t.qty)} L {t.product}</b> from <b>{t.warehouse}</b></div>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>Deliver in this order:</div>
                <ol style={{ margin: "0 0 6px 20px", padding: 0 }}>
                  {(t.drops || []).map((d, i) => <li key={i} style={{ marginBottom: 2 }}>{d.site} — <b>{L(d.qty)} L</b></li>)}
                </ol>
                {t.endPoint && <div style={{ marginBottom: 6 }}>Then return to <b>{t.endPoint}</b></div>}
              </>) : <div style={{ marginBottom: 6, color: "var(--steel)" }}>Loading the trip details…</div>}
              <div style={{ fontSize: 11.5, color: "var(--steel)" }}>🔒 The route, drops and quantities are fixed by logistics — you only confirm the fuelling station (start) above.</div>
            </div>
          );
        })()}
        {/* Drops: locked (read-only) when this request is against a scheduled trip;
            freely editable only for an ad-hoc run with no trip. */}
        {!tripNo && (
          <Field label="Drops on the way — add in order">
            <Picker value={pick} onChange={(v) => { setPick(""); if (v) setDrops([...drops, v]); }} placeholder="Choose a drop to add" title="Add a drop" options={STATIONS.map((s) => s.name)} />
          </Field>
        )}
        <div style={{ marginBottom: 12 }}>
          {drops.map((d, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: tripNo ? "#F6F8FC" : "#fff", border: "1.5px solid var(--line)", borderRadius: 12, padding: "6px 8px", marginBottom: 6 }}>
              <span className="mono" style={{ width: 22, height: 22, display: "grid", placeItems: "center", background: "var(--ink)", color: "#fff", borderRadius: 8, fontSize: 11, fontWeight: 700 }}>{i + 2}</span>
              <span style={{ flex: 1, fontSize: 14 }}>{d}</span>
              {!tripNo && <>
                <button aria-label="Move earlier" disabled={i === 0} onClick={() => { const a = [...drops]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setDrops(a); }} style={{ background: "#fff", border: "1.5px solid var(--line)", borderRadius: 8, padding: "3px 9px", color: i === 0 ? "var(--line)" : "var(--ink)", fontSize: 13 }}>↑</button>
                <button aria-label="Move later" disabled={i === drops.length - 1} onClick={() => { const a = [...drops]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setDrops(a); }} style={{ background: "#fff", border: "1.5px solid var(--line)", borderRadius: 8, padding: "3px 9px", color: i === drops.length - 1 ? "var(--line)" : "var(--ink)", fontSize: 13 }}>↓</button>
                <button aria-label={`Remove ${d}`} onClick={() => setDrops(drops.filter((_, j) => j !== i))} style={{ background: "none", color: "var(--red)", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>×</button>
              </>}
            </div>))}
          {drops.length === 0 && <div style={{ fontSize: 13, color: "var(--steel)" }}>{tripNo ? "This trip has no drops." : "No drops yet. Leave empty for a direct run."}</div>}
        </div>
        {tripNo ? (
          <Field label="End point — where the journey finishes">
            <div style={{ background: "#F6F8FC", border: "1.5px solid var(--line)", borderRadius: 12, padding: "10px 12px", fontSize: 14, color: end ? "var(--ink)" : "var(--steel)" }}>{end || "— (set by the schedule)"}</div>
          </Field>
        ) : (
          <Field label="End point — where the journey finishes">
            <Picker value={end} onChange={setEnd} placeholder="Select" title="End point" options={STATIONS.map((s) => s.name)} />
          </Field>
        )}
        {journeyOk && <div style={{ marginTop: 4 }}><RouteMap names={full} route={route} height={190} /></div>}
        <div style={{ marginTop: 14 }}><PumpHead caption={route && route.loading ? "Working out the distance…" : "Estimated for this route"} litres={calc} km={km || null} kmpl={est ? est.blended : kmpl} /></div>
        {!ready && <div style={{ marginTop: 10, background: "#FBEDD6", border: "1px solid var(--amber)", borderRadius: 12, padding: "10px 12px", fontSize: 13 }}>Finish the earlier steps first: {missing.slice(0, 3).join(", ")}{missing.length > 3 ? "…" : ""}</div>}
      </>
    );
    if (k === "usage") return (
      <>
        <Field label="Litres you are asking for"><input inputMode="numeric" value={ask} onChange={(e) => setAsk(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 40" /></Field>
        <Field label="What it is for"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. generator, yard shunting" style={{ fontFamily: "Barlow" }} /></Field>
        <div style={{ marginTop: 8 }}><PumpHead caption="Requested" litres={parseFloat(ask) || null} /></div>
        {!ready && <div style={{ marginTop: 10, background: "#FBEDD6", border: "1px solid var(--amber)", borderRadius: 12, padding: "10px 12px", fontSize: 13 }}>Finish the earlier steps first: {missing.slice(0, 3).join(", ")}{missing.length > 3 ? "…" : ""}</div>}
      </>
    );
    if (k === "review") return (
      <>
        <PumpHead caption={isFleet ? (route && route.loading ? "Working out the distance…" : "Estimated for this route") : "Requested"} litres={isFleet ? calc : (parseFloat(ask) || null)} km={isFleet && km ? km : null} kmpl={est ? est.blended : kmpl} />
        <div style={{ marginTop: 14 }}>
          {[
            ["Driver", driver ? driver.name : "—"],
            [isFleet ? "Truck" : "Vehicle", isFleet ? `${horse || "—"}${trailer ? " · " + trailer : ""}` : (veh || "—")],
            ["Station", fuelStn || "—"],
            ["Odometer", odo ? `${L(odoNum)} km` : "—"],
            isFleet ? ["Journey", km ? `${L(km)} km` : "—"] : ["Purpose", reason || "general use"],
          ].map(([k2, v2], i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <span className="lbl" style={{ margin: 0 }}>{k2}</span><span className="mono" style={{ fontSize: 13, fontWeight: 500, textAlign: "right" }}>{v2}</span>
            </div>
          ))}
        </div>
        {ocrMismatch && <div style={{ marginTop: 10 }}><Flag tone="red" title="Odometer photo doesn’t match the typed reading"><span className="mono">read {L(ocr.value)} · typed {L(odoNum)} · {L(ocrGap)} km apart</span></Flag></div>}
        {!ready && <div style={{ marginTop: 10, background: "#FBEDD6", border: "1px solid var(--amber)", borderRadius: 12, padding: "10px 12px", fontSize: 13 }}>Go back and finish: {missing.slice(0, 3).join(", ")}{missing.length > 3 ? "…" : ""}</div>}
      </>
    );
    return null;
  };

  return (
    <div>
      {sent && (
        <div className="card rise" style={{ padding: 24, textAlign: "center", borderTop: "4px solid var(--ok)" }}>
          <div style={{ width: 58, height: 58, borderRadius: "50%", background: "#E9F5E2", color: "var(--ok)", display: "grid", placeItems: "center", margin: "0 auto 12px" }}><StepIcon k="check" /></div>
          <h2 style={{ margin: "0 0 6px", fontSize: 22 }}>Sent for approval</h2>
          <div style={{ fontSize: 14, color: "var(--steel)" }}>{sent}</div>
          <button onClick={() => { setSent(null); setStep(0); }} className="disp pill pill-lime" style={{ marginTop: 18, width: "100%" }}>Raise another</button>
        </div>
      )}
      {!sent && (
        <>
          {sendErr && <Flag tone="red" title="Not sent">{sendErr}</Flag>}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {steps.map((s, i) => <div key={i} style={{ flex: 1, height: 6, borderRadius: 99, background: i < si ? "var(--lime)" : i === si ? cur.accent : "var(--line)", transition: "background .3s" }} />)}
            </div>
            <div className="disp" style={{ fontSize: 11, letterSpacing: ".08em", color: "var(--steel)" }}>Step {si + 1} of {steps.length}</div>
          </div>
          <div className="card rise" key={cur.key} style={{ padding: 22, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: cur.tint, color: cur.accent, display: "grid", placeItems: "center", flexShrink: 0 }}><StepIcon k={cur.icon} /></div>
              <div>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.05 }}>{cur.title}</h2>
                <div style={{ fontSize: 13, color: "var(--steel)", marginTop: 3 }}>{cur.sub}</div>
              </div>
            </div>
            {stepBody(cur.key)}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {si > 0 && <button onClick={() => go(-1)} className="disp pill-ghost">Back</button>}
            {!isLast
              ? <button onClick={() => go(1)} disabled={!cur.done} className="disp pill">Next</button>
              : <button onClick={send} disabled={!ready || sending} className="disp pill pill-lime">{sending ? "Sending…" : "Send for approval"}</button>}
          </div>
        </>
      )}
    </div>
  );
}

const Chip = ({ label, onRemove, tone }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, margin: "0 6px 6px 0", padding: "6px 10px",
    borderRadius: 2, fontSize: 13, background: tone === "start" ? "var(--ink)" : "#fff",
    color: tone === "start" ? "#EDE9DC" : "var(--ink)", border: "1.5px solid var(--line)" }}>
    {label}{onRemove && <button onClick={onRemove} aria-label={`Remove ${label}`}
      style={{ background: "none", color: "var(--steel)", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>}
  </span>
);

const STATUS = {
  pending: ["Awaiting approval", "var(--amber)", "#FDF3E7"],
  approved: ["Approved — loaded to card", "var(--ok)", "#EDF6EF"],
  declined: ["Declined", "var(--red)", "#FBEEEC"],
  redeemed: ["Fuel taken", "var(--ink)", "#EFEDE4"],
};
const RequestLine = ({ r }) => {
  const [t, c, bg] = STATUS[r.status];
  const v = r.status === "redeemed" ? r.takenLitres - r.approvedLitres : null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 11px",
      background: bg, borderLeft: `3px solid ${c}`, marginBottom: 6, flexWrap: "wrap" }}>
      <div>
        <div className="mono" style={{ fontSize: 12 }}>{r.id} · {r.horse}{r.trailer ? ` ${r.trailer}` : ""} · {r.mode === "delivery" ? `${L(r.km)} km` : r.reason || "general use"}
          {r.ocrMismatch && <strong style={{ color: "var(--red)" }}> · odometer flag</strong>}</div>
        <div className="disp" style={{ fontSize: 11, color: c, fontWeight: 700 }}>{t}</div>
      </div>
      <div className="mono" style={{ fontSize: 13, textAlign: "right" }}>
        {r.status === "pending" && <>asked {L(r.calcLitres)} L</>}
        {r.status === "approved" && <>approved {L(r.approvedLitres)} L</>}
        {r.status === "redeemed" && <>{L(r.approvedLitres)} → {L(r.takenLitres)} L
          {v !== 0 && <span style={{ color: v > 0 ? "var(--red)" : "var(--steel)", marginLeft: 6 }}>{v > 0 ? "+" : ""}{L(v)}</span>}</>}
      </div>
    </div>
  );
};

/* =========================== APPROVER ============================= */
function ApproverMode({ drivers, requests, cards, onApprove, onDecline, gkey, focusRef, onFocused }) {
  const [selId, setSelId] = useState(null);
  // A tapped "request to approve" push carries the ref → open THAT request directly,
  // instead of dropping the approver on the generic list to hunt for it.
  useEffect(() => {
    if (!focusRef) return;
    const m = requests.find((x) => x.ref === focusRef || x.id === focusRef);
    if (m) setSelId(m.id);
    onFocused && onFocused();
  }, [focusRef, requests]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pending = requests.filter((r) => r.status === "pending");
  const isToday = (d) => { try { return d && new Date(d).toDateString() === new Date().toDateString(); } catch { return false; } };
  const approvedToday = requests.filter((r) => r.status === "approved" && isToday(r.decidedAt));
  // recently decided (approved / declined / redeemed), newest first — click to see
  // exactly what the approver saw. Only requests that went through an ACTUAL app
  // decision (decidedAt set) belong here — the historical card-system imports are
  // redeemed WITHOUT a decision, so they must not clutter the approver's log.
  const recent = requests
    .filter((r) => r.decidedAt && (r.status === "approved" || r.status === "declined" || r.status === "redeemed"))
    .sort((a, b) => new Date(b.decidedAt || b.at) - new Date(a.decidedAt || a.at))
    .slice(0, 40);
  const sel = selId ? requests.find((x) => x.id === selId) : null;

  // one request open → the focused approval workflow (editable if pending, else read-only)
  if (sel) {
    return (
      <ApprovalCard r={sel} gkey={gkey} readOnly={sel.status !== "pending"} onBack={() => setSelId(null)}
        onApprove={async (id, n, note) => { await onApprove(id, n, note); setSelId(null); }}
        onDecline={async (id, note) => { await onDecline(id, note); setSelId(null); }} />
    );
  }

  return (
    <div>
      <h2 style={{ margin: "2px 0 16px", fontSize: 24 }}>Approvals</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
        <div className="card" style={{ padding: 14, textAlign: "center" }}><div className="mono" style={{ fontSize: 24, fontWeight: 700, color: "var(--amber)" }}>{pending.length}</div><div className="lbl" style={{ margin: "3px 0 0" }}>Pending</div></div>
        <div className="card" style={{ padding: 14, textAlign: "center" }}><div className="mono" style={{ fontSize: 24, fontWeight: 700, color: "var(--ok)" }}>{approvedToday.length}</div><div className="lbl" style={{ margin: "3px 0 0" }}>Approved today</div></div>
      </div>
      <SectionHead icon="drequest" title="Waiting on you" tint="#FBEDD6" accent="#C07A00" />
      {pending.length === 0
        ? <div className="card" style={{ padding: 18, color: "var(--steel)", fontSize: 14, marginBottom: 20 }}>Nothing waiting — you’re all caught up. 🎉</div>
        : <div style={{ marginBottom: 20 }}>{pending.map((r) => <ApprovalRow key={r.id} r={r} onClick={() => setSelId(r.id)} />)}</div>}
      {recent.length > 0 && <>
        <SectionHead icon="check" title="Recent decisions" tint="#E9F5E2" accent="#3E8E28" />
        <div style={{ fontSize: 12, color: "var(--steel)", margin: "-8px 2px 10px" }}>Tap any decision to see everything the approver saw.</div>
        <div>{recent.map((r) => <DecisionRow key={r.id} r={r} onClick={() => setSelId(r.id)} />)}</div>
      </>}
    </div>
  );
}

// A decided request — approved / declined / redeemed — as a clickable row.
const DecisionRow = ({ r, onClick }) => {
  const st = r.status === "declined"
    ? { c: "var(--red)", bg: "#FDECEA", label: "Declined", detail: r.note ? `“${r.note}”` : "sent back" }
    : r.status === "redeemed"
      ? { c: "var(--blue)", bg: "#E7ECFF", label: "Redeemed", detail: `${L(r.approvedLitres)} → ${L(r.takenLitres)} L` }
      : { c: "var(--ok)", bg: "#E9F5E2", label: "Approved", detail: `${L(r.approvedLitres)} L loaded` };
  const when = r.decidedAt ? new Date(r.decidedAt) : null;
  const day = when ? fmtD(when) : "";
  return (
    <button onClick={onClick} style={{ width: "100%", textAlign: "left", background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "11px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{r.driver}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--steel)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.id} · {r.horse}{r.mode === "delivery" ? ` · ${L(r.km)} km` : ""}{day ? ` · ${day}` : ""}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <span className="disp" style={{ fontSize: 11, fontWeight: 700, color: st.c, background: st.bg, padding: "2px 8px", borderRadius: 100 }}>{st.label}</span>
        <div className="mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 3 }}>{st.detail}</div>
      </div>
    </button>
  );
};

const ApprovalRow = ({ r, onClick }) => (
  <button onClick={onClick} style={{ width: "100%", textAlign: "left", background: "#fff", border: "1px solid var(--line)", borderRadius: 16, padding: "13px 15px", marginBottom: 10, boxShadow: "var(--sh)", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
    <div style={{ width: 44, height: 44, borderRadius: 12, background: r.ocrMismatch ? "#FDECEA" : "#E7ECFF", color: r.ocrMismatch ? "var(--red)" : "var(--blue)", display: "grid", placeItems: "center", flexShrink: 0 }}>
      <StepIcon k="truck" />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{r.driver}</div>
      <div className="mono" style={{ fontSize: 12, color: "var(--steel)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.id} · {r.horse}{r.trailer ? ` ${r.trailer}` : ""} · {r.mode === "delivery" ? `${L(r.km)} km` : (r.reason || "general")}</div>
      {r.ocrMismatch && <div className="disp" style={{ fontSize: 11, color: "var(--red)", fontWeight: 700, marginTop: 2 }}>⚠ Odometer flag</div>}
    </div>
    <div style={{ textAlign: "right", flexShrink: 0 }}>
      <div className="mono" style={{ fontSize: 16, fontWeight: 700 }}>{L(r.calcLitres)} L</div>
      <div style={{ color: "var(--steel)", fontSize: 18, lineHeight: 1 }}>›</div>
    </div>
  </button>
);

/* The approval workflow — a Tiimo-style stepped review, one focused screen at a
   time with forward/back, matching the driver wizard. NOT one long form. */
function ApprovalCard({ r, onApprove, onDecline, gkey, onBack, readOnly = false }) {
  const isFleet = r.mode === "delivery";
  const [amt, setAmt] = useState(String(r.calcLitres));
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState(null);
  const noteRef = useRef(null);
  const [step, setStep] = useState(0);
  const [fuelCtx, setFuelCtx] = useState(null);
  // Fetch the same trip fuel context the driver saw — so the approver knows this is the
  // Nth request, what changed in the trip, and the distance/fuel adjustment behind it.
  useEffect(() => {
    if (isFleet && r.tripNo) getTripFuelContext(r.tripNo, r.id).then(setFuelCtx).catch(() => {});
  }, [r.tripNo, r.id, isFleet]);
  const n = parseFloat(amt), diff = isFinite(n) ? n - r.calcLitres : 0;
  const doApprove = async () => {
    setActErr(null);
    if (!(n > 0)) { setActErr({ tone: "amber", title: "Almost there", body: "Enter the litres to load first." }); return; }
    setBusy(true); try { await onApprove(r.id, n, note); } catch (e) { setActErr({ tone: "red", title: "Didn’t go through", body: e.message || "Could not approve — try again." }); } finally { setBusy(false); }
  };
  const doDecline = async () => {
    setActErr(null);
    if (!note.trim()) { setActErr({ tone: "amber", title: "Almost there", body: "Add a reason first — the driver sees this and can edit & resend." }); return; }
    setBusy(true); try { await onDecline(r.id, note); } catch (e) { setActErr({ tone: "red", title: "Didn’t go through", body: e.message || "Could not send back — try again." }); } finally { setBusy(false); }
  };
  const flagged = r.ocrMismatch;

  const steps = isFleet
    ? [
        { key: "request", icon: "truck", accent: "#3E8E28", tint: "#E9F5E2", title: "The request", sub: `${r.driver} · ${r.horse}${r.trailer ? " · " + r.trailer : ""}` },
        { key: "evidence", icon: "gauge", accent: "#C07A00", tint: "#FBEDD6", title: "Odometer evidence", sub: "Photo against the typed reading" },
        { key: "journey", icon: "route", accent: "#7A5AF0", tint: "#EDE8FD", title: "The journey", sub: `${L(r.km)} km · ${r.distanceSource || "estimate"}` },
        { key: "history", icon: "gauge", accent: "var(--blue)", tint: "#E7ECFF", title: "Against the history", sub: `How ${r.horse} normally runs` },
        { key: "decide", icon: "check", accent: "#3E8E28", tint: "#E9F5E2", title: "Your decision", sub: "Confirm the load, or send it back" },
      ]
    : [
        { key: "request", icon: "truck", accent: "#3E8E28", tint: "#E9F5E2", title: "The request", sub: `${r.driver} · ${r.horse}` },
        { key: "evidence", icon: "gauge", accent: "#C07A00", tint: "#FBEDD6", title: "Odometer evidence", sub: "Photo against the typed reading" },
        { key: "purpose", icon: "drop", accent: "#7A5AF0", tint: "#EDE8FD", title: "What it’s for", sub: r.reason || "general use" },
        { key: "decide", icon: "check", accent: "#3E8E28", tint: "#E9F5E2", title: "Your decision", sub: "Confirm the load, or send it back" },
      ];
  const si = Math.min(step, steps.length - 1);
  const cur = steps[si];
  const isLast = si === steps.length - 1;
  const go = (d) => setStep(Math.max(0, Math.min(steps.length - 1, si + d)));

  const body = (k) => {
    if (k === "request") return (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Cell k="Driver type" v={r.driverType} />
          <Cell k="Station" v={r.station} />
          <Cell k="Odometer" v={`${L(r.odo)} km`} />
          <Cell k="Card balance" v={`${L(r.openingBalance)} L`} />
          <Cell k="GPS" v={`${r.gpsMetres ?? "—"} m · ±${r.gpsAccuracy ?? "—"} m`} />
          <Cell k="Asked for" v={`${L(r.calcLitres)} L`} />
        </div>
        {r.gpsMetres != null && r.gpsMetres > 250 && <div style={{ marginTop: 12 }}><Flag tone="red" title="Not at the fuelling station">
          <span className="mono">the fix is {L(r.gpsMetres)} m from {r.station} — well beyond the 250 m on-site radius. Confirm the driver was really at the pump before approving.</span></Flag></div>}
        {flagged && <div style={{ marginTop: 12 }}><Flag tone="red" title="Odometer photo doesn’t match the typed reading"><span className="mono">read {L(r.ocr)} · typed {L(r.odo)} · {L(r.ocrGap)} km apart</span></Flag></div>}
      </>
    );
    if (k === "evidence") return (
      <>
        {r.photo
          ? <img src={r.photo} alt="Odometer" style={{ maxWidth: "100%", maxHeight: 240, borderRadius: 14, border: "1px solid var(--line)", display: "block", margin: "0 auto 12px" }} />
          : <div className="card" style={{ padding: 16, color: "var(--steel)", fontSize: 13, marginBottom: 12 }}>No photo was attached to this request.</div>}
        {r.ocrMismatch && <Flag tone="red" title="Doesn’t match the typed reading"><span className="mono">read {L(r.ocr)} · typed {L(r.odo)} · {L(r.ocrGap)} km apart</span></Flag>}
        {!r.ocrMismatch && r.ocrState === "read" && <Flag tone="ok" title="Photo matches the typed reading"><span className="mono">read {L(r.ocr)} · typed {L(r.odo)} km</span></Flag>}
        {r.ocrState === "nodigits" && <Flag tone="amber" title="Odometer couldn’t be read from the photo">Check the picture by eye.</Flag>}
        {(r.ocrState === "failed" || r.ocrState === "unavailable") && <Flag tone="amber" title="Photo wasn’t checked automatically">Check the picture by eye.</Flag>}
      </>
    );
    if (k === "journey") return (
      <>
        {fuelCtx && <FuelContextBanner ctx={fuelCtx} />}
        <div style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.7 }}>{r.stops.map((p, i) => <span key={i}>{i ? "  →  " : ""}<strong>{i + 1}</strong> {p}</span>)}</div>
        <RouteMap names={r.stops} route={{ km: r.km, legs: r.legs, source: r.distanceSource || "straight-line estimate" }} height={190} />
        <div style={{ marginTop: 12 }}><SplitPanel est={estimate(r.stops, r.legs, r.horse)} horse={r.horse} /></div>
      </>
    );
    if (k === "history") return <HistoryPanel r={r} allocating={n} />;
    if (k === "purpose") return (
      <>
        <div style={{ marginBottom: 12 }}><Cell k="Purpose" v={r.reason || "general use"} /></div>
        <PumpHead caption="Driver asked for" litres={r.calcLitres} />
      </>
    );
    if (k === "decide" && readOnly) return (
      <>
        <PumpHead caption="Driver’s estimate" litres={r.calcLitres} km={isFleet ? r.km : null} kmpl={r.blended || r.kmpl} />
        <div style={{ marginTop: 16 }}>
          {r.status === "declined"
            ? <Flag tone="red" title="Declined — sent back to the driver">{r.note ? <span>“{r.note}”</span> : "No note recorded."}</Flag>
            : <Flag tone="ok" title={r.status === "redeemed" ? `Approved ${L(r.approvedLitres)} L · drawn ${L(r.takenLitres)} L` : `Approved — ${L(r.approvedLitres)} L loaded`}>
                {r.decidedAt ? `Decided ${fmtD(r.decidedAt)}` : ""}{r.note ? ` · “${r.note}”` : ""}
              </Flag>}
          {r.status === "redeemed" && <div style={{ marginTop: 10 }}><Cell k="Drawn at" v={r.takenAt || "—"} /></div>}
        </div>
      </>
    );
    if (k === "decide") return (
      <>
        <PumpHead caption="Driver’s estimate" litres={r.calcLitres} km={isFleet ? r.km : null} kmpl={r.blended || r.kmpl} />
        {fuelCtx && <div style={{ marginTop: 12 }}><FuelContextBanner ctx={fuelCtx} /></div>}
        {actErr && <div style={{ marginTop: 12 }}><Flag tone={actErr.tone} title={actErr.title}>{actErr.body}</Flag></div>}
        {!declining ? (
          <>
            <div style={{ marginTop: 16 }}>
              <Field label="Litres to load"><input inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
              {diff !== 0 && isFinite(n) && <div className="mono" style={{ fontSize: 12, color: diff > 0 ? "var(--amber)" : "var(--steel)", marginTop: -8 }}>{diff > 0 ? "+" : ""}{L(diff)} L against the estimate</div>}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={doApprove} disabled={busy} className="disp pill pill-lime">{busy ? "Loading…" : `Confirm · load ${isFinite(n) ? L(n) : "—"} L`}</button>
              <button onClick={() => { setActErr(null); setDeclining(true); setTimeout(() => noteRef.current && noteRef.current.focus(), 60); }} disabled={busy} className="disp pill-ghost" style={{ flex: "0 0 auto", color: "var(--red)", borderColor: "var(--red)" }}>Decline</button>
            </div>
          </>
        ) : (
          <div style={{ marginTop: 16 }}>
            <Field label="Why send it back? The driver sees this and can edit &amp; resend">
              <input ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} style={{ fontFamily: "Barlow" }} placeholder="e.g. wrong end point · retake the odometer photo" />
            </Field>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setActErr(null); setDeclining(false); }} disabled={busy} className="disp pill-ghost">Cancel</button>
              <button onClick={doDecline} disabled={busy} className="disp pill" style={{ background: "var(--red)", boxShadow: "none" }}>{busy ? "Sending…" : "Send back to driver"}</button>
            </div>
          </div>
        )}
      </>
    );
    return null;
  };

  return (
    <div>
      {onBack && <button onClick={onBack} className="disp" style={{ display: "flex", alignItems: "center", gap: 4, background: "none", color: "var(--blue)", fontSize: 13, fontWeight: 700, marginBottom: 10, padding: 0 }}>‹ Back to approvals</button>}

      {/* who / how much — persistent context */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.driver}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--steel)" }}>{r.id} · {isFleet ? "fleet" : "retail"}
            {readOnly && <span className="disp" style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: r.status === "declined" ? "var(--red)" : "var(--ok)" }}>· {r.status}</span>}
          </div>
        </div>
        <div className="mono" style={{ fontSize: 18, fontWeight: 700, flexShrink: 0, color: flagged ? "var(--red)" : "var(--ink)" }}>{L(r.calcLitres)} L{flagged ? " ⚠" : ""}</div>
      </div>

      {readOnly ? (
        /* Decided allocation — the WHOLE transaction on one screen (no re-walking the
           approval steps): request, evidence, journey/route, history, and the outcome. */
        <>
          {steps.map((s) => (
            <div key={s.key} className="card" style={{ padding: 18, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: 13, background: s.tint, color: s.accent, display: "grid", placeItems: "center", flexShrink: 0 }}><StepIcon k={s.icon} /></div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, lineHeight: 1.1 }}>{s.title}</h3>
                  <div style={{ fontSize: 12.5, color: "var(--steel)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.sub}</div>
                </div>
              </div>
              {body(s.key)}
            </div>
          ))}
        </>
      ) : (
        <>
          {/* progress */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {steps.map((s, i) => <div key={i} style={{ flex: 1, height: 6, borderRadius: 99, background: i < si ? "var(--lime)" : i === si ? cur.accent : "var(--line)", transition: "background .3s" }} />)}
            </div>
            <div className="disp" style={{ fontSize: 11, letterSpacing: ".08em", color: "var(--steel)" }}>Step {si + 1} of {steps.length}</div>
          </div>

          <div className="card rise" key={cur.key} style={{ padding: 22, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: cur.tint, color: cur.accent, display: "grid", placeItems: "center", flexShrink: 0 }}><StepIcon k={cur.icon} /></div>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.05 }}>{cur.title}</h2>
                <div style={{ fontSize: 13, color: "var(--steel)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cur.sub}</div>
              </div>
            </div>
            {body(cur.key)}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            {si > 0 && <button onClick={() => go(-1)} className="disp pill-ghost">Back</button>}
            {!isLast && <button onClick={() => go(1)} className="disp pill">Next</button>}
          </div>
        </>
      )}
    </div>
  );
}

function HistoryPanel({ r, allocating }) {
  const trips = (HISTORY[r.horse] || []).slice().reverse();
  const withKm = trips.filter((t) => t.km);
  const histKmpl = withKm.length ? withKm.reduce((s, t) => s + t.km / t.L, 0) / withKm.length : null;
  const dn = destMatch(r.stops);
  const perKm = isFinite(allocating) && r.km ? allocating / r.km : null;
  const impliedKmpl = isFinite(allocating) && allocating > 0 ? r.km / allocating : null;
  const plan = r.blended || r.kmpl;
  const vsPlan = impliedKmpl ? (impliedKmpl - plan) / plan : null;
  const vsDest = dn && isFinite(allocating) ? allocating - dn.med : null;
  return (
    <div style={{ border: "1.5px solid var(--line)", borderRadius: 11, marginBottom: 12, overflow: "hidden" }}>
      <div className="disp" style={{ background: "var(--ink)", color: "#EDE9DC", padding: "7px 11px", fontSize: 12, fontWeight: 700, letterSpacing: ".07em" }}>
        What the history says
      </div>
      <div style={{ padding: 12, background: "#fff" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 12 }}>
          <Cell k={`${r.horse} town / road`} v={`${effFor(r.horse).loc.toFixed(2)} / ${effFor(r.horse).hwy.toFixed(2)}`} />
          <Cell k="Its last trips average" v={histKmpl ? `${histKmpl.toFixed(2)} km/L` : "not enough data"} />
          <Cell k="This allocation implies" v={impliedKmpl ? `${impliedKmpl.toFixed(2)} km/L` : "—"} />
          <Cell k="Litres per 100 km" v={perKm ? `${(perKm * 100).toFixed(1)} L` : "—"} />
        </div>

        {vsPlan != null && (
          <div style={{ background: Math.abs(vsPlan) < 0.1 ? "#EDF6EF" : vsPlan < 0 ? "#FDF3E7" : "#EFEDE4",
            border: `1.5px solid ${Math.abs(vsPlan) < 0.1 ? "var(--ok)" : vsPlan < 0 ? "var(--amber)" : "var(--line)"}`,
            borderRadius: 11, padding: "9px 11px", marginBottom: 12 }}>
            <span className="mono" style={{ fontSize: 12 }}>
              {Math.abs(vsPlan) < 0.1
                ? `In line — ${Math.abs(vsPlan * 100).toFixed(0)}% off what this mix of town and road normally takes.`
                : vsPlan < 0
                  ? `Generous — this allocation lets ${r.horse} run at ${impliedKmpl.toFixed(2)} km/L against ${plan.toFixed(2)} for this mix of town and road, ${Math.abs(vsPlan * 100).toFixed(0)}% below plan. About ${L(allocating - r.km / plan)} L more than the journey needs.`
                  : `Tight — this allocation requires ${impliedKmpl.toFixed(2)} km/L against ${plan.toFixed(2)} for this mix. About ${L(r.km / plan - allocating)} L short.`}
            </span>
          </div>
        )}

        {dn && (
          <div style={{ marginBottom: 12 }}>
            <span className="lbl">Similar runs to “{dn.key}” — {dn.n} on record</span>
            <div className="mono" style={{ fontSize: 12 }}>
              usually {L(dn.med)} L, ranging {L(dn.p10)} to {L(dn.p90)} L
              {vsDest != null && (
                <strong style={{ color: Math.abs(vsDest) <= (dn.p90 - dn.p10) / 2 ? "var(--ok)" : "var(--amber)", marginLeft: 8 }}>
                  · this one {vsDest === 0 ? "matches" : `${vsDest > 0 ? "+" : ""}${L(vsDest)} L against the usual`}
                </strong>)}
            </div>
          </div>
        )}

        <span className="lbl">Last {trips.length} trips on {r.horse}</span>
        {trips.length === 0 && <div style={{ fontSize: 13, color: "var(--steel)" }}>No history on record for this horse.</div>}
        {trips.length > 0 && (
          <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ color: "var(--steel)" }}>
              {["Month", "Route", "Litres", "km", "km/L"].map((h) => (
                <th key={h} style={{ textAlign: h === "Month" || h === "Route" ? "left" : "right", padding: "4px 6px", fontWeight: 500 }}>{h}</th>))}
            </tr></thead>
            <tbody>{trips.map((t, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "4px 6px" }}>{t.m}</td>
                <td style={{ padding: "4px 6px", fontFamily: "Barlow" }}>{t.dest}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{L(t.L)}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{t.km ? L(t.km) : "—"}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{t.km ? (t.km / t.L).toFixed(2) : "—"}</td>
              </tr>))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const Cell = ({ k, v }) => (
  <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 2, padding: "8px 10px" }}>
    <div className="lbl" style={{ marginBottom: 2 }}>{k}</div>
    <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>{v}</div></div>
);

/* ========================= CARD SYSTEM ============================ */
function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function printReport(title, headers, rows) {
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const w = window.open("", "_blank");
  if (!w) { alert("Allow pop-ups to export a PDF (best from a browser)."); return; }
  w.document.write(`<html><head><title>${esc(title)}</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#14213D}h1{font-size:18px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:14px}th,td{border:1px solid #ccc;padding:6px 9px;font-size:12px;text-align:left}th{background:#14213D;color:#fff}tr:nth-child(even){background:#f4f4f0}</style></head><body><h1>${esc(title)}</h1><div style="font-size:12px;color:#666">Generated ${esc(new Date().toLocaleString())}</div><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table><script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
  w.document.close();
}
const DayFilter = ({ days, setDays }) => (
  <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
    {[[1, "Today"], [7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "1 year"], [0, "All"]].map(([d, label]) => (
      <button key={d} onClick={() => setDays(d)} className="disp" style={{ padding: "8px 15px", borderRadius: 100, fontSize: 13, fontWeight: 700, border: "1.5px solid var(--line)", background: days === d ? "var(--blue)" : "#fff", color: days === d ? "#fff" : "var(--ink)", cursor: "pointer" }}>{label}</button>
    ))}
  </div>
);

function CardSystem({ requests }) {
  const [days, setDays] = useState(30);
  const [fDriver, setFDriver] = useState("");
  const [fTruck, setFTruck] = useState("");
  const [fSite, setFSite] = useState("");
  const [drill, setDrill] = useState(null);
  const done = requests.filter((r) => r.status === "redeemed");
  const cutoff = days === 0 ? 0 : Date.now() - days * 86400000;
  const inWindow = done.filter((r) => days === 0 || (r.at && new Date(r.at).getTime() >= cutoff));
  // filter option lists (from what's actually in the window), sorted
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  const drivers = uniq(inWindow.map((r) => r.driver));
  const trucks = uniq(inWindow.map((r) => r.horse));
  const sites = uniq(inWindow.map((r) => r.takenAt));
  const rows = inWindow.filter((r) =>
    (!fDriver || r.driver === fDriver) && (!fTruck || r.horse === fTruck) && (!fSite || r.takenAt === fSite));
  const headers = ["Request", "Date", "Driver", "Card", "Horse", "Station", "Approved L", "Taken L", "Variance L"];
  const data = rows.map((r) => {
    const hasApp = Number.isFinite(Number(r.approvedLitres));
    return [r.id, r.at ? fmtD(r.at) : "", r.driver, r.card, r.horse, r.takenAt || "",
      hasApp ? r.approvedLitres : "", r.takenLitres, hasApp ? r.takenLitres - r.approvedLitres : ""];
  });
  const totalTaken = rows.reduce((s, r) => s + (r.takenLitres || 0), 0);
  const filtered = fDriver || fTruck || fSite;
  const selStyle = { padding: "9px 11px", borderRadius: 10, border: "1.5px solid var(--line)", background: "#fff", fontSize: 13, color: "var(--ink)", flex: "1 1 150px", minWidth: 0 };
  return (
    <div>
      <h2 style={{ margin: "2px 0 6px", fontSize: 24 }}>Fuel drawn</h2>
      <div style={{ fontSize: 13, color: "var(--steel)", marginBottom: 16 }}>Fuel drawn on DA cards. Filter by driver, truck or site, then export.</div>
      <DayFilter days={days} setDays={setDays} />
      {/* driver / truck / site filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 130px", minWidth: 0 }}><Picker value={fDriver} onChange={setFDriver} placeholder="All drivers" title="Driver" options={[{ value: "", label: "All drivers" }, ...drivers.map((d) => ({ value: d, label: d }))]} /></div>
        <div style={{ flex: "1 1 110px", minWidth: 0 }}><Picker value={fTruck} onChange={setFTruck} placeholder="All trucks" title="Truck" options={[{ value: "", label: "All trucks" }, ...trucks.map((t) => ({ value: t, label: t }))]} /></div>
        <div style={{ flex: "1 1 130px", minWidth: 0 }}><Picker value={fSite} onChange={setFSite} placeholder="All sites" title="Site" options={[{ value: "", label: "All sites" }, ...sites.map((s) => ({ value: s, label: s }))]} /></div>
        {filtered && <button onClick={() => { setFDriver(""); setFTruck(""); setFSite(""); }} className="disp pill-ghost" style={{ flex: "0 0 auto", padding: "8px 14px" }}>Clear</button>}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <button onClick={() => downloadCSV(`da-fuel-drawn-${days || "all"}.csv`, [headers, ...data])} disabled={!rows.length} className="disp pill" style={{ background: "var(--ok)", flex: "0 0 auto", boxShadow: "none" }}>Export Excel</button>
        <button onClick={() => printReport("DA OPS — Fuel drawn", headers, data)} disabled={!rows.length} className="disp pill-ghost" style={{ flex: "0 0 auto" }}>Export PDF</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
        <div className="card" style={{ padding: 14, textAlign: "center" }}><div className="mono" style={{ fontSize: 24, fontWeight: 700 }}>{rows.length}</div><div className="lbl" style={{ margin: "3px 0 0" }}>Fills</div></div>
        <div className="card" style={{ padding: 14, textAlign: "center" }}><div className="mono" style={{ fontSize: 24, fontWeight: 700, color: "var(--blue)" }}>{L(totalTaken)}</div><div className="lbl" style={{ margin: "3px 0 0" }}>Litres drawn</div></div>
      </div>
      {rows.length === 0
        ? <div className="card" style={{ padding: 18, color: "var(--steel)", fontSize: 14 }}>No card activity in this period. Redemptions arrive from the DA card system.</div>
        : <AcctTable head={<><Th>Driver</Th><Th>Request</Th><Th>Horse</Th><Th>Station</Th><Th>Date</Th><Th right>Approved</Th><Th right>Taken</Th><Th right>Variance</Th></>}>
            {rows.map((r) => {
              const hasApp = Number.isFinite(Number(r.approvedLitres));
              const v = hasApp ? r.takenLitres - r.approvedLitres : null;
              return (
                <tr key={r.id} onClick={() => setDrill(r)} style={{ borderTop: "1px solid var(--line)", background: v > 0 ? "#FDECEA" : undefined, cursor: "pointer" }}>
                  <Td style={{ fontWeight: 600 }}>{r.driver}</Td>
                  <Td style={{ color: "var(--steel)" }}>{r.id}</Td>
                  <Td style={{ color: "var(--steel)" }}>{r.horse}</Td>
                  <Td style={{ color: "var(--steel)" }}>{r.takenAt || "—"}</Td>
                  <Td style={{ color: "var(--steel)" }}>{r.at ? fmtD(r.at) : "—"}</Td>
                  <Td right>{hasApp ? L(r.approvedLitres) : "—"}</Td>
                  <Td right style={{ fontWeight: 700 }}>{L(r.takenLitres)}</Td>
                  <Td right style={{ fontWeight: 700, color: v == null ? "var(--steel)" : v > 0 ? "var(--red)" : v < 0 ? "var(--steel)" : "var(--ok)" }}>{v == null ? "—" : (v > 0 ? "+" : "") + L(v)}</Td>
                </tr>
              ); })}
            <tr style={{ borderTop: "2px solid var(--navy)", background: "#F4F6FA" }}>
              <Td colSpan={6} style={{ fontWeight: 700 }}>Total drawn</Td>
              <Td right style={{ fontWeight: 700 }}>{L(totalTaken)}</Td>
              <Td right></Td>
            </tr>
          </AcctTable>}
      {drill && (() => { const hasApp = Number.isFinite(Number(drill.approvedLitres)); const v = hasApp ? drill.takenLitres - drill.approvedLitres : null; return (
        <DetailSheet title={drill.driver} sub={`${drill.id}${drill.horse ? " · " + drill.horse : ""}`} onClose={() => setDrill(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div className="card" style={{ padding: 12, textAlign: "center" }}><div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{hasApp ? L(drill.approvedLitres) : "—"}</div><div className="lbl" style={{ margin: 0 }}>Approved L</div></div>
            <div className="card" style={{ padding: 12, textAlign: "center" }}><div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--blue)" }}>{L(drill.takenLitres)}</div><div className="lbl" style={{ margin: 0 }}>Taken L</div></div>
            <div className="card" style={{ padding: 12, textAlign: "center" }}><div className="mono" style={{ fontSize: 18, fontWeight: 700, color: v == null ? "var(--steel)" : v > 0 ? "var(--red)" : v < 0 ? "var(--steel)" : "var(--ok)" }}>{v == null ? "—" : (v > 0 ? "+" : "") + L(v)}</div><div className="lbl" style={{ margin: 0 }}>Variance</div></div>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><tbody>
                {[["Driver", drill.driver], ["Card", drill.card], ["Horse", drill.horse], ["Station", drill.takenAt || "—"], ["Date", drill.at ? fmtD(drill.at) : "—"], ["Request", drill.id]].map(([k, val]) => (
                  <tr key={k} style={{ borderTop: "1px solid var(--line)" }}><Td style={{ color: "var(--steel)" }}>{k}</Td><Td right>{val}</Td></tr>
                ))}
              </tbody></table>
            </div>
          </div>
          {v > 0 && <Flag tone="amber" title="Took more than approved">This fill drew {L(v)} L above the approved amount — worth a check.</Flag>}
        </DetailSheet>
      ); })()}
    </div>
  );
}
function RedeemRow({ r, onRedeem }) {
  const [lit, setLit] = useState(String(r.approvedLitres));
  const [stn, setStn] = useState(r.station);
  const [odo, setOdo] = useState(String(r.odo + Math.round(r.km || 0)));
  const [busy, setBusy] = useState(false);
  const n = parseFloat(lit), o = parseFloat(odo);
  return (
    <div className="card" style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: "#E7ECFF", color: "var(--blue)", display: "grid", placeItems: "center", flexShrink: 0 }}><StepIcon k="drop" /></div>
        <div>
          <div style={{ fontWeight: 600 }}>{r.driver}</div>
          <div className="mono" style={{ fontSize: 12, color: "var(--steel)" }}>{r.id} · {r.horse} · approved {L(r.approvedLitres)} L</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
        <Field label="Litres dispensed"><input inputMode="numeric" value={lit} onChange={(e) => setLit(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
        <Field label="Station"><Picker value={stn} onChange={setStn} title="Station" options={STATIONS.map((s) => s.name)} /></Field>
        <Field label="Odometer at fill"><input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
      </div>
      <button onClick={async () => { setBusy(true); try { await onRedeem(r.id, n, stn, o); } catch (e) { alert(e.message || "Could not post the redemption."); } finally { setBusy(false); } }} disabled={!isFinite(n) || n <= 0 || busy} className="disp pill" style={{ width: "100%", marginTop: 6 }}>
        {busy ? "Posting…" : "Post redemption"}</button>
    </div>
  );
}

/* ======================== EFFICIENCY ============================== */
const EFF_DIMS = [["horse", "Truck", "gauge"], ["driver", "Driver", "user"], ["route", "Route", "route"], ["site", "Site", "pin"]];

function inPeriod(dateStr, mode, val) {
  if (mode === "all") return true;
  if (!val) return true;
  const d = new Date(dateStr);
  if (isNaN(d)) return false;
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  if (mode === "year") return String(y) === String(val);
  if (mode === "month") return `${y}-${m}` === val;
  if (mode === "day") return `${y}-${m}-${day}` === val;
  return true;
}

function FleetEfficiency({ horses }) {
  const [legs, setLegs] = useState(null);
  const [err, setErr] = useState(null);
  const [dim, setDim] = useState("horse");
  const [mode, setMode] = useState("all");
  const now = new Date();
  const [val, setVal] = useState("");
  const [drill, setDrill] = useState(null);

  useEffect(() => {
    let dead = false;
    getEfficiency().then((r) => { if (!dead) setLegs(r.legs || []); }).catch((e) => { if (!dead) setErr(e.message); });
    return () => { dead = true; };
  }, []);

  // when the granularity changes, seed a sensible default value
  const pickMode = (mNew) => {
    setMode(mNew);
    if (mNew === "year") setVal(String(now.getFullYear()));
    else if (mNew === "month") setVal(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
    else if (mNew === "day") setVal(now.toISOString().slice(0, 10));
    else setVal("");
  };

  if (err) return <div><h2 style={{ margin: "2px 0 6px", fontSize: 24 }}>Efficiency</h2><Flag tone="amber" title="Couldn’t load efficiency data">{err}</Flag></div>;
  if (!legs) return <div><h2 style={{ margin: "2px 0 6px", fontSize: 24 }}>Efficiency</h2><div className="card" style={{ padding: 18, color: "var(--steel)" }}>Loading legs…</div></div>;

  const years = [...new Set(legs.map((l) => new Date(l.date).getFullYear()).filter((y) => !isNaN(y)))].sort((a, b) => b - a);
  const shown = legs.filter((l) => inPeriod(l.date, mode, val));

  // aggregate the filtered legs by the chosen dimension
  const groups = {};
  for (const l of shown) {
    const k = l[dim] || "—";
    (groups[k] ||= { key: k, km: 0, litres: 0, legs: 0 });
    groups[k].km += l.dist; groups[k].litres += l.litres; groups[k].legs += 1;
  }
  const cmp = dim === "horse" || dim === "driver";
  const rows = Object.values(groups).map((g) => {
    const kmpl = g.litres ? g.km / g.litres : 0;
    const plan = dim === "horse" ? (horses.find((h) => h.code === g.key)?.kmpl ?? FLEET_MEDIAN) : FLEET_MEDIAN;
    return { ...g, kmpl, plan, flagged: cmp && kmpl > 0 && kmpl < plan * (1 - PILFERAGE_TOLERANCE) };
  }).filter((r) => r.km >= 5 && r.kmpl >= 0.3).sort((a, b) => {   // drop bad-odometer noise (e.g. 1 km on 20 L → 0.05 km/L)

    // worst-first for the comparable dimensions (truck/driver): flagged on top,
    // then the biggest shortfall vs baseline. Route/site keep volume-desc.
    if (cmp) {
      if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
      const sa = a.plan - a.kmpl, sb = b.plan - b.kmpl;
      if (sb !== sa) return sb - sa;
    }
    return b.litres - a.litres;
  });

  const totKm = shown.reduce((s, l) => s + l.dist, 0);
  const totLit = shown.reduce((s, l) => s + l.litres, 0);
  const blended = totLit ? totKm / totLit : 0;
  const periodLabel = mode === "all" ? "all time" : mode === "year" ? val : mode === "month" ? val : mode === "day" ? val : "";
  const dimLabel = (EFF_DIMS.find((d) => d[0] === dim) || [])[1];

  const seg = (active) => ({ padding: "8px 14px", borderRadius: 100, fontSize: 13, fontWeight: 700, border: "1.5px solid var(--line)", background: active ? "var(--blue)" : "#fff", color: active ? "#fff" : "var(--ink)", cursor: "pointer" });

  return (
    <div>
      <h2 style={{ margin: "2px 0 6px", fontSize: 24 }}>Efficiency</h2>
      <div style={{ fontSize: 13, color: "var(--steel)", marginBottom: 16 }}>
        Measured fuel consumption by truck, driver, route and site.
      </div>

      {/* dimension */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {EFF_DIMS.map(([k, label]) => (
          <button key={k} onClick={() => setDim(k)} className="disp" style={seg(dim === k)}>{label}</button>
        ))}
      </div>
      {/* period granularity */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {[["all", "All time"], ["year", "Year"], ["month", "Month"], ["day", "Day"]].map(([k, label]) => (
          <button key={k} onClick={() => pickMode(k)} className="disp" style={seg(mode === k)}>{label}</button>
        ))}
        {mode === "year" && (
          <select value={val} onChange={(e) => setVal(e.target.value)} style={{ width: "auto", padding: "8px 30px 8px 12px" }}>
            {(years.length ? years : [now.getFullYear()]).map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        )}
        {mode === "month" && <input type="month" value={val} onChange={(e) => setVal(e.target.value)} style={{ width: "auto" }} />}
        {mode === "day" && <input type="date" value={val} onChange={(e) => setVal(e.target.value)} style={{ width: "auto" }} />}
      </div>

      {/* summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        <div className="card" style={{ padding: 13, textAlign: "center" }}><div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{L(totKm)}</div><div className="lbl" style={{ margin: "3px 0 0" }}>km</div></div>
        <div className="card" style={{ padding: 13, textAlign: "center" }}><div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--blue)" }}>{L(totLit)}</div><div className="lbl" style={{ margin: "3px 0 0" }}>litres</div></div>
        <div className="card" style={{ padding: 13, textAlign: "center" }}><div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--ok)" }}>{blended ? blended.toFixed(2) : "—"}</div><div className="lbl" style={{ margin: "3px 0 0" }}>km/L</div></div>
      </div>
      <div className="mono" style={{ fontSize: 11, color: "var(--steel)", marginBottom: 12 }}>{dimLabel} efficiency · {periodLabel} · {shown.length} leg{shown.length === 1 ? "" : "s"}</div>

      {rows.length === 0 && <div className="card" style={{ padding: 18, color: "var(--steel)", fontSize: 14 }}>
        No completed legs in this period. A vehicle needs two redemptions with odometer readings before consumption can be measured.</div>}

      {rows.map((r) => {
        const ref = cmp ? r.plan : Math.max(...rows.map((x) => x.kmpl), r.kmpl);
        const hi = Math.max(ref, r.kmpl) * 1.15 || 1;
        const pos = (v) => Math.max(2, Math.min(100, (v / hi) * 100));
        const myLegs = shown.filter((l) => (l[dim] || "—") === r.key).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
        const openLegs = () => setDrill({ key: r.key, row: r, legs: myLegs });
        return (
          <div className="card" key={r.key} role="button" tabIndex={0} onClick={openLegs}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLegs(); } }}
            style={{ padding: 16, marginBottom: 10, borderLeft: `4px solid ${r.flagged ? "var(--red)" : "var(--ok)"}`, cursor: "pointer", position: "relative" }}>
            <span aria-hidden style={{ position: "absolute", top: 12, right: 14, color: "var(--steel)", opacity: .5 }}>›</span>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, fontFamily: dim === "horse" ? "'DM Mono',monospace" : "Barlow", wordBreak: "break-word" }}>{r.key}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--steel)" }}>{r.legs} leg{r.legs === 1 ? "" : "s"} · {L(r.km)} km on {L(r.litres)} L</div>
              </div>
              <div className="mono" style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: r.flagged ? "var(--red)" : "var(--ink)" }}>{r.kmpl.toFixed(2)}</div>
                <div className="lbl" style={{ margin: 0 }}>km/L</div>
              </div>
            </div>
            <div style={{ position: "relative", height: 8, background: "var(--paper)", borderRadius: 4, margin: "10px 0 4px" }}>
              <div style={{ position: "absolute", left: 0, width: `${pos(r.kmpl)}%`, height: "100%", borderRadius: 4, background: r.flagged ? "var(--red)" : "var(--ok)" }} />
              {cmp && <div style={{ position: "absolute", left: `${pos(r.plan)}%`, top: -4, width: 2, height: 16, background: "var(--ink)" }} />}
            </div>
            {cmp && <div className="mono" style={{ fontSize: 11, color: "var(--steel)" }}>measured {r.kmpl.toFixed(2)} · baseline {r.plan.toFixed(2)} km/L{r.flagged ? " — worth a word with the driver" : ""}</div>}
          </div>);
      })}

      {drill && (
        <DetailSheet title={drill.key} sub={`${dimLabel} · ${drill.row.legs} legs · ${drill.row.kmpl.toFixed(2)} km/L`} onClose={() => setDrill(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div className="card" style={{ padding: 12, textAlign: "center" }}><div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{L(drill.row.km)}</div><div className="lbl" style={{ margin: 0 }}>km</div></div>
            <div className="card" style={{ padding: 12, textAlign: "center" }}><div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--blue)" }}>{L(drill.row.litres)}</div><div className="lbl" style={{ margin: 0 }}>litres</div></div>
            <div className="card" style={{ padding: 12, textAlign: "center" }}><div className="mono" style={{ fontSize: 18, fontWeight: 700, color: drill.row.flagged ? "var(--red)" : "var(--ok)" }}>{drill.row.kmpl.toFixed(2)}</div><div className="lbl" style={{ margin: 0 }}>km/L</div></div>
          </div>
          <div className="lbl" style={{ marginBottom: 6 }}>Individual legs (newest first)</div>
          <AcctTable head={<><Th>Route</Th><Th>Date</Th><Th right>km</Th><Th right>Litres</Th><Th right>km/L</Th></>}>
            {drill.legs.map((l, i) => {
              const lk = l.litres ? l.dist / l.litres : 0;
              const low = lk > 0 && lk < FLEET_MEDIAN * (1 - PILFERAGE_TOLERANCE);
              return (
                <tr key={i} style={{ borderTop: "1px solid var(--line)", background: low ? "#FDECEA" : undefined }}>
                  <Td style={{ fontWeight: 600 }}>{l.route}{(dim !== "driver" || dim !== "horse") && <div style={{ fontSize: 10, color: "var(--steel)", fontWeight: 400 }}>{dim !== "driver" ? l.driver : ""}{dim !== "driver" && dim !== "horse" ? " · " : ""}{dim !== "horse" ? l.horse : ""}</div>}</Td>
                  <Td style={{ color: "var(--steel)" }}>{l.date ? fmtD(l.date) : "—"}</Td>
                  <Td right>{L(l.dist)}</Td>
                  <Td right>{L(l.litres)}</Td>
                  <Td right style={{ fontWeight: 700, color: low ? "var(--red)" : "var(--ink)" }}>{lk.toFixed(2)}</Td>
                </tr>
              );
            })}
            <tr style={{ borderTop: "2px solid var(--navy)", background: "#F4F6FA" }}>
              <Td colSpan={2} style={{ fontWeight: 700 }}>Total</Td>
              <Td right style={{ fontWeight: 700 }}>{L(drill.row.km)}</Td>
              <Td right style={{ fontWeight: 700 }}>{L(drill.row.litres)}</Td>
              <Td right style={{ fontWeight: 700 }}>{drill.row.kmpl.toFixed(2)}</Td>
            </tr>
          </AcctTable>
        </DetailSheet>
      )}
    </div>
  );
}

/* ======================= INTELLIGENCE ============================ */
const INTEL_SUGGESTIONS = [
  "Which trucks are running least efficiently, and could it just be town work?",
  "Summarise fuel drawn against fuel approved, with the numbers.",
  "How many requests are still pending approval right now?",
  "Draft a short note to management on this month’s fuel position.",
];

function inlineBold(s) {
  return String(s).split(/(\*\*[^*]+\*\*)/g).map((t, i) =>
    t.startsWith("**") && t.endsWith("**") ? <strong key={i}>{t.slice(2, -2)}</strong> : <React.Fragment key={i}>{t}</React.Fragment>);
}
function RichText({ text }) {
  const lines = String(text).split("\n");
  return (
    <div style={{ fontSize: 14, lineHeight: 1.55 }}>
      {lines.map((ln, i) => {
        const t = ln.trim();
        if (!t) return <div key={i} style={{ height: 8 }} />;
        if (/^#{1,3}\s/.test(t)) return <div key={i} className="disp" style={{ fontSize: 14, fontWeight: 700, margin: "10px 0 4px" }}>{inlineBold(t.replace(/^#{1,3}\s/, ""))}</div>;
        if (/^[-*]\s/.test(t)) return <div key={i} style={{ display: "flex", gap: 8, margin: "3px 0" }}><span style={{ color: "var(--lime)", fontWeight: 700 }}>•</span><span>{inlineBold(t.replace(/^[-*]\s/, ""))}</span></div>;
        return <p key={i} style={{ margin: "0 0 6px", whiteSpace: "pre-wrap" }}>{inlineBold(t)}</p>;
      })}
    </div>
  );
}

function IntelligenceMode() {
  const [msgs, setMsgs] = useState([]);   // { role: "user"|"assistant", content }
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const send = async (text) => {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    setErr(null); setQ("");
    const history = msgs;
    const next = [...msgs, { role: "user", content: question }];
    setMsgs(next); setBusy(true);
    try {
      const r = await askIntelligence(question, history);
      setMsgs([...next, { role: "assistant", content: r.answer }]);
    } catch (e) { setErr(e.message); setMsgs(msgs); setQ(question); }
    finally { setBusy(false); }
  };

  const exportPDF = () => {
    if (!msgs.length) return;
    printReport("DA OPS — Intelligence briefing",
      ["", "Message"],
      msgs.map((m) => [m.role === "user" ? "Question" : "Analyst", m.content]));
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <h2 style={{ margin: "2px 0 0", fontSize: 24 }}>Intelligence</h2>
        {msgs.length > 0 && <button onClick={exportPDF} className="disp pill-ghost" style={{ padding: "9px 16px", flex: "0 0 auto" }}>Export PDF</button>}
      </div>
      <div style={{ fontSize: 13, color: "var(--steel)", marginBottom: 16 }}>
        Ask questions to get additional operations insight.
      </div>

      {msgs.map((m, i) => m.role === "user" ? (
        <div key={i} style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <div style={{ maxWidth: "85%", background: "linear-gradient(150deg,#22345C,#14213D)", color: "#EAF0FA", padding: "11px 15px", borderRadius: "16px 16px 4px 16px", fontSize: 14, lineHeight: 1.45, boxShadow: "0 6px 16px rgba(20,33,61,.18)" }}>{m.content}</div>
        </div>
      ) : (
        <div key={i} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 24, height: 24, borderRadius: 8, background: "#EDE8FD", color: "#7A5AF0", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{NAV_PATHS.intel}</svg>
            </div>
            <span className="disp" style={{ fontSize: 12, fontWeight: 700, color: "var(--steel)", letterSpacing: ".04em" }}>Operations analyst</span>
          </div>
          <div className="card" style={{ padding: "14px 16px" }}><RichText text={m.content} /></div>
        </div>
      ))}

      {busy && (
        <div className="card" style={{ padding: "14px 16px", marginBottom: 14, color: "var(--steel)", fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 16, height: 16, border: "2.5px solid var(--line)", borderTopColor: "var(--blue)", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />
          Reading the database and thinking it through…
        </div>
      )}
      {err && <Flag tone="amber" title="Couldn’t get an answer">{err}</Flag>}
      <div ref={endRef} />

      <div style={{ position: "sticky", bottom: "calc(8px + env(safe-area-inset-bottom))", marginTop: 8 }}>
        <div className="card" style={{ padding: 8, display: "flex", gap: 8, alignItems: "flex-end", boxShadow: "var(--shlg)" }}>
          <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={1}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask for additional insights…"
            style={{ flex: 1, resize: "none", border: "none", background: "none", padding: "10px 8px", fontFamily: "'Barlow',sans-serif", fontSize: 14, maxHeight: 120 }} />
          <button onClick={() => send()} disabled={busy || !q.trim()} className="disp pill" style={{ flex: "0 0 auto", padding: "13px 20px", opacity: busy || !q.trim() ? .5 : 1 }}>Send</button>
        </div>
      </div>
    </div>
  );
}

/* ========================= MASTER DATA ============================ */
function MasterData({ drivers, horses, onAddDriver, gkey, setGkey }) {
  const [f, setF] = useState({ card: "", name: "", type: "", pin: "" });
  const [addErr, setAddErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const dup = drivers.some((d) => d.card === f.card.trim());
  const ok = f.card.trim().length >= 4 && f.name.trim().length >= 3 && f.type && f.pin.trim().length >= 4 && !dup;
  const usernameOf = (name) => { const p = (name || "").toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean); return p.length <= 1 ? (p[0] || "") : p[0][0] + p[p.length - 1]; };
  const add = async () => {
    setAddErr(null);
    if (f.card.trim().length < 4) return setAddErr({ tone: "amber", title: "Almost there", body: "Enter the fuel-card number (at least 4 digits)." });
    if (dup) return setAddErr({ tone: "amber", title: "Card already exists", body: "A driver with that card number is already set up." });
    if (f.name.trim().length < 3) return setAddErr({ tone: "amber", title: "Almost there", body: "Enter the driver's full name." });
    if (!f.type) return setAddErr({ tone: "amber", title: "Almost there", body: "Choose Fleet or Retail for this driver." });
    if (f.pin.trim().length < 4) return setAddErr({ tone: "amber", title: "Almost there", body: "Set a PIN of at least 4 digits." });
    setBusy(true);
    try { await onAddDriver({ card: f.card.trim(), name: f.name.trim(), type: f.type, pin: f.pin.trim() }); setF({ card: "", name: "", type: "", pin: "" }); }
    catch (e) { setAddErr({ tone: "red", title: "Could not add the driver", body: e.message }); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <h2 style={{ margin: "2px 0 18px", fontSize: 24 }}>Master data</h2>

      <SectionHead icon="user" title="Add a driver" tint="#E7ECFF" accent="var(--blue)" />
      <div className="card" style={{ padding: 18, marginBottom: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
          <Field label="Card number"><input value={f.card} onChange={(e) => setF({ ...f, card: e.target.value.replace(/\D/g, "") })} placeholder="1000123" /></Field>
          <Field label="Full name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ fontFamily: "Barlow" }} placeholder="As on the card" /></Field>
          <Field label="Driver type">
            <Picker value={f.type} onChange={(v) => setF({ ...f, type: v })} placeholder="Choose one" options={[{ value: "fleet", label: "Fleet — route based" }, { value: "retail", label: "Retail — general use" }]} />
          </Field>
          <Field label="Sign-in PIN — 4+ digits"><input value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="PIN" /></Field>
        </div>
        {f.name.trim().length >= 3 && <div className="mono" style={{ fontSize: 12, color: "var(--steel)", marginBottom: 12 }}>signs in as <strong style={{ color: "var(--blue)" }}>{usernameOf(f.name)}</strong>{f.type ? ` · ${f.type === "retail" ? "requests a quantity" : "route allocated from distance"}` : ""}</div>}
        {addErr && <Flag tone={addErr.tone} title={addErr.title}>{addErr.body}</Flag>}
        <button onClick={add} disabled={busy} className="disp pill" style={{ width: "100%" }}>{busy ? "Adding…" : "Add driver"}</button>
      </div>

      <SectionHead icon="master" title="Retail site managers" tint="#EAF7E4" accent="var(--lime)" />
      <SiteManagerCreate />
      <div style={{ height: 22 }} />

      <SectionHead icon="truck" title={`Drivers · ${drivers.filter((d) => d.type === "fleet").length} fleet, ${drivers.filter((d) => d.type === "retail").length} retail`} tint="#E9F5E2" accent="#3E8E28" />
      <div style={{ marginBottom: 22, maxHeight: 340, overflowY: "auto" }}>
        <AcctTable head={<><Th>Name</Th><Th>Username</Th><Th>Card</Th><Th>Type</Th></>}>
          {drivers.map((d) => (
            <tr key={d.card} style={{ borderTop: "1px solid var(--line)" }}>
              <Td style={{ fontWeight: 600 }}>{d.name}</Td>
              <Td style={{ color: "var(--steel)" }}>{usernameOf(d.name)}</Td>
              <Td style={{ color: "var(--steel)" }}>{d.card}</Td>
              <Td style={{ fontWeight: 700, color: d.type === "retail" ? "var(--amber)" : "var(--ok)" }}>{d.type}</Td>
            </tr>))}
        </AcctTable>
      </div>

      <SectionHead icon="gauge" title="Horses · trailer & consumption" tint="#FBEDD6" accent="#C07A00" />
      <div style={{ marginBottom: 22, maxHeight: 320, overflowY: "auto" }}>
        <AcctTable head={<><Th>Horse</Th><Th>Trailer</Th><Th right>km/L</Th></>}>
          {horses.map((h) => (
            <tr key={h.code} style={{ borderTop: "1px solid var(--line)" }}>
              <Td style={{ fontWeight: 700 }}>{h.code}</Td>
              <Td style={{ color: "var(--steel)" }}>{h.trailer}</Td>
              <Td right>{h.kmpl.toFixed(2)}</Td>
            </tr>))}
        </AcctTable>
      </div>

    </div>
  );
}


export default App;

/* Full-screen block for drivers while the phone's GPS is off. Styled like the
   update gate. It clears ITSELF — the app polls and unblocks the moment
   location services come back on. */
// A driver signed in on a laptop/browser — driver features need the handset.
function DriverMobileOnlyGate({ onSignOut }) {
  const C = { navy: "#14213D", ink: "#1B2A4A", blue: "#2B3990", lime: "#6BC048", steel: "#5B6B84" };
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(165deg,#1F2E52 0%,#0F1A31 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "24px 20px", fontFamily: "'Barlow',system-ui,sans-serif", color: "#EAF0FA" }}>
      <div style={{ width: "100%", maxWidth: 384, textAlign: "center" }}>
        <img src="/da-wordmark.png" alt="Daniel Aguiar Motors" style={{ width: "min(248px,74%)", height: "auto", filter: "drop-shadow(0 10px 24px rgba(0,0,0,.4))" }} />
        <div style={{ background: "#fff", color: C.ink, borderRadius: 18, padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,.40)", textAlign: "center", marginTop: 24 }}>
          <div style={{ width: 58, height: 58, borderRadius: 16, background: "#EAF0FA", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>
          </div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontSize: 20, fontWeight: 800, letterSpacing: ".03em", color: C.navy }}>Use the mobile app</div>
          <div style={{ fontSize: 13.5, color: C.steel, margin: "9px 0 20px", lineHeight: 1.55 }}>
            Driver features — fuel requests, collection, the geo-lock and trip GPS — only work on the DA OPS phone app. Sign in on your Android phone to continue.
          </div>
          <a href={APK_URL} style={{ display: "block", width: "100%", boxSizing: "border-box", padding: 15, fontSize: 15, fontWeight: 700, borderRadius: 12, cursor: "pointer",
            fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: ".05em", textDecoration: "none",
            background: C.blue, color: "#fff", boxShadow: "0 10px 22px rgba(43,57,144,.30)" }}>Download the Android app</a>
          <button type="button" onClick={onSignOut} style={{ marginTop: 12, width: "100%", padding: 12, fontSize: 13, fontWeight: 700, borderRadius: 12, border: "1px solid #D5DCEA", background: "#fff", color: C.steel, cursor: "pointer" }}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

function GpsGate() {
  const C = { navy: "#14213D", ink: "#1B2A4A", blue: "#2B3990", lime: "#6BC048", steel: "#5B6B84", red: "#B23B3B" };
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(165deg,#1F2E52 0%,#0F1A31 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom))", fontFamily: "'Barlow',system-ui,sans-serif", color: "#EAF0FA" }}>
      <div style={{ width: "100%", maxWidth: 384, textAlign: "center" }}>
        <img src="/da-wordmark.png" alt="Daniel Aguiar Motors" style={{ width: "min(248px,74%)", height: "auto", filter: "drop-shadow(0 10px 24px rgba(0,0,0,.4))" }} />
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontSize: 26, fontWeight: 800, letterSpacing: ".2em", marginTop: 16, lineHeight: 1 }}>
          <span style={{ color: C.lime }}>OPS</span>
        </div>
        <div style={{ background: "#fff", color: C.ink, borderRadius: 18, padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,.40)", textAlign: "center", marginTop: 24 }}>
          <div style={{ width: 58, height: 58, borderRadius: 16, background: "#FDECEA", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
          </div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontSize: 20, fontWeight: 800, letterSpacing: ".03em", color: C.navy }}>Turn on GPS to continue</div>
          <div style={{ fontSize: 13.5, color: C.steel, margin: "9px 0 20px", lineHeight: 1.55 }}>
            DA OPS needs your location for fuel requests and trip tracking. Switch <b>Location</b> on — this screen clears by itself the moment it&rsquo;s on.
          </div>
          <button type="button" onClick={() => openLocationSettings().then((ok) => { if (!ok) alert("Open the phone's Settings → Location and switch it ON."); })}
            style={{ display: "block", width: "100%", boxSizing: "border-box", padding: 15, fontSize: 15, fontWeight: 700, borderRadius: 12, border: "none", cursor: "pointer",
              fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: ".05em",
              background: C.blue, color: "#fff", boxShadow: "0 10px 22px rgba(43,57,144,.30)" }}>
            Open location settings
          </button>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, fontSize: 12, color: C.steel }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid #D5DCEA", borderTopColor: C.lime, animation: "spin 1s linear infinite", display: "inline-block" }} />
            Watching for GPS…
          </div>
        </div>
      </div>
    </div>
  );
}
