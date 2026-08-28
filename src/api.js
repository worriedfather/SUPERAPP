/* Talks to the DA Fuel backend. Holds the sign-in token, and returns the
   read-model in the exact shapes the screens already use.

   Set VITE_API_BASE at build time to the server's URL (e.g. the Harare box).
   In `npm run dev` it is empty and Vite proxies /api to the local server. */

import { APP_BUILD } from "./config.js";

// Is this the native/app shell (vs a plain web browser)? The server uses the
// X-DA-App header to exempt the app from the web-only bot checks — the app is
// protected by device attestation instead.
const IS_APP = (() => {
  try {
    if (typeof window !== "undefined" && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return true;
    if (typeof window !== "undefined" && window.__DAOPS_SHELL) return true;
    if (typeof navigator !== "undefined" && /DAOPSMobile/i.test(navigator.userAgent || "")) return true;
  } catch { /* ignore */ }
  return false;
})();
const APP_HEADERS = IS_APP ? { "X-DA-App": "1", "X-DA-Build": String(APP_BUILD) } : {};

// The server address. Defaults to the value baked in at build time, but can be
// overridden in-app (Login → server settings) and is remembered — so changing
// WiFi/laptop IP no longer needs a rebuild.
const DEFAULT_BASE = import.meta.env.VITE_API_BASE || "";
export const getServer = () => localStorage.getItem("da_api") || DEFAULT_BASE;
export const setServer = (url) => {
  const v = (url || "").trim().replace(/\/+$/, "");
  if (v) localStorage.setItem("da_api", v); else localStorage.removeItem("da_api");
};

let token = localStorage.getItem("da_token") || null;
let me = JSON.parse(localStorage.getItem("da_me") || "null");

export const currentUser = () => me;
export const signedIn = () => !!token;

/* ---------------- Offline support ----------------------------------------
   The forecourts and highway have patchy signal, and the server occasionally
   blips. So:
     • GET responses are cached on the device. If a GET can't reach the server,
       the last-synced copy is served (tagged __offline) instead of an error —
       so dashboards, lists and reference data stay usable offline.
     • Writes that can't reach the server are held in an on-device OUTBOX and
       replayed automatically when the connection returns (tagged __queued).
   Only genuine network failures queue/serve-stale; a server that answers with
   an error is surfaced normally. Endpoints that must be live never queue. */
// Cache key is VERSIONED by app build. A release that changes a response shape or
// re-points data to a new source must not keep serving a pre-refactor cached copy
// (that was the "Revenue $0 on the phone" bug — a stale executive payload served on
// a network blip). Bumping APP_BUILD changes the prefix, so old copies are ignored,
// and we proactively purge them on load to reclaim quota.
const CACHE_ROOT = "da_cache:";
const CACHE_PREFIX = `${CACHE_ROOT}v${APP_BUILD}:`;
try { Object.keys(localStorage).forEach((k) => { if (k.startsWith(CACHE_ROOT) && !k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k); }); } catch { /* ignore */ }
const OUTBOX_KEY = "da_outbox";
const NO_QUEUE = /\/api\/(login|route\/google|intelligence|verify)\b/;

const readCache = (path) => { try { const s = localStorage.getItem(CACHE_PREFIX + path); return s ? JSON.parse(s) : null; } catch { return null; } };
const writeCache = (path, data) => { try { localStorage.setItem(CACHE_PREFIX + path, JSON.stringify({ at: Date.now(), data })); } catch { /* quota — ignore */ } };
const outboxAll = () => { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]"); } catch { return []; } };
const outboxSave = (list) => { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(list)); } catch { /* ignore */ } window.dispatchEvent(new CustomEvent("da-outbox", { detail: list.length })); };
export const outboxCount = () => outboxAll().length;
export const clearCache = () => { try { Object.keys(localStorage).forEach((k) => { if (k.startsWith(CACHE_ROOT)) localStorage.removeItem(k); }); } catch { /* ignore */ } };
// Broadcast real API reachability (a live server answering), which is more
// accurate than navigator.onLine — the phone can have WiFi but not reach the box.
let lastReachable = null;
const netEvent = (reachable) => { if (reachable === lastReachable) return; lastReachable = reachable; try { window.dispatchEvent(new CustomEvent("da-net", { detail: reachable })); } catch { /* SSR */ } };

async function call(path, { method = "GET", body, timeoutMs = 12000, _replay = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Shared "the server isn't reachable" handling: serve the cached copy for a
  // GET, hold a write in the outbox, else signal an offline error. Used both for
  // a network failure (fetch throws) AND a gateway error (502/503/504 = the box
  // is down even though the tunnel answered).
  const unreachable = (fallbackMsg) => {
    if (!NO_QUEUE.test(path)) netEvent(false);
    if (method === "GET") {
      const c = readCache(path);
      if (c) return { __served: { ...c.data, __offline: true, __cachedAt: c.at } };
    } else if (!_replay && !NO_QUEUE.test(path)) {
      const list = outboxAll(); list.push({ path, method, body, at: Date.now() }); outboxSave(list);
      return { __served: { __queued: true, ok: true } };
    }
    const err = new Error(fallbackMsg); err.offline = true; throw err;
  };

  let res;
  try {
    res = await fetch(getServer() + path, {
      method,
      headers: { "Content-Type": "application/json", ...APP_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return unreachable(e.name === "AbortError"
      ? "The server didn't respond. You may be offline — showing the last synced data where available."
      : "Can't reach the server. You may be offline — showing the last synced data where available.").__served;
  } finally {
    clearTimeout(timer);
  }
  // Gateway/service-unavailable — the tunnel answered but the API is down.
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return unreachable("The server is briefly unavailable — showing the last synced data where available.").__served;
  }
  netEvent(true);                                      // a live server answered → we're online
  if (res.status === 401 && token) signOut();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  if (method === "GET") writeCache(path, data);       // refresh the offline copy
  if (!_replay) flushOutbox();                          // we're online → drain the queue
  return data;
}

// Replay queued writes in order. A network failure stops the drain (retry later);
// a server rejection drops that item (it will never succeed) and continues.
let flushing = false;
export async function flushOutbox() {
  if (flushing) return;
  let list = outboxAll();
  if (!list.length || !token) return;
  flushing = true;
  let sent = 0;
  try {
    while (list.length) {
      const item = list[0];
      try {
        await call(item.path, { method: item.method, body: item.body, _replay: true });
        sent++;
      } catch (e) {
        if (e && e.offline) break;   // still offline → keep the queue, try again later
        // else: server rejected it — drop so it doesn't wedge the queue
      }
      list = outboxAll(); list.shift(); outboxSave(list);
    }
  } finally {
    flushing = false;
    // Tell the app a queued write actually landed, so the on-screen read-model refreshes
    // and the user sees their offline submission appear (no manual pull-to-refresh).
    if (sent > 0 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("da-synced", { detail: sent }));
  }
}
// Drain automatically when the device regains connectivity.
if (typeof window !== "undefined") window.addEventListener("online", () => flushOutbox());

// ---- Offline sign-in --------------------------------------------------------
// After a successful ONLINE login we cache, per login, a salted SHA-256 of the PIN
// plus the actor + token, so the same person can sign back in with NO signal (the
// device is the gate, same trust model as biometric unlock). The cached token is
// reused to queue writes offline; they replay — and any expired token re-auths —
// once back online.
const AUTH_CACHE = "da_offline_auth";
const normLogin = (s) => String(s || "").trim().toLowerCase();
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function cacheOfflineAuth(login, pin, actor, tok) {
  try {
    const salt = [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const hash = await sha256Hex(salt + ":" + pin);
    const map = JSON.parse(localStorage.getItem(AUTH_CACHE) || "{}");
    map[normLogin(login)] = { salt, hash, actor, token: tok, at: Date.now() };
    localStorage.setItem(AUTH_CACHE, JSON.stringify(map));
  } catch { /* ignore (no subtle crypto / quota) */ }
}
async function offlineLogin(login, pin) {
  try {
    const rec = JSON.parse(localStorage.getItem(AUTH_CACHE) || "{}")[normLogin(login)];
    if (!rec) return null;
    if ((await sha256Hex(rec.salt + ":" + pin)) !== rec.hash) return null;
    return { actor: rec.actor, token: rec.token };
  } catch { return null; }
}

export async function signIn(loginId, pin, meta = {}) {
  // meta carries the web human-check (hp honeypot + ts form-render time); the app is exempt server-side
  try {
    const r = await call("/api/login", { method: "POST", body: { login: loginId, pin, hp: meta.hp || "", ts: meta.ts || 0 } });
    token = r.token;
    me = r.actor;
    localStorage.setItem("da_token", token);
    localStorage.setItem("da_me", JSON.stringify(me));
    cacheOfflineAuth(loginId, pin, r.actor, r.token);   // enable offline sign-in next time
    return me;
  } catch (e) {
    // No signal? fall back to a previously-cached sign-in for this person.
    if (e && e.offline) {
      const off = await offlineLogin(loginId, pin);
      if (off) {
        token = off.token; me = { ...off.actor, __offline: true };
        localStorage.setItem("da_token", token);
        localStorage.setItem("da_me", JSON.stringify(off.actor));
        return me;
      }
      const err = new Error("You're offline, and this device hasn't signed in as this user before. Connect once, then you can sign in offline.");
      err.offline = true;
      throw err;
    }
    throw e;
  }
}

// Google Sign-In: exchange the Google credential (ID token) for our session.
export async function signInGoogle(credential) {
  const r = await call("/api/auth/google", { method: "POST", body: { credential } });
  token = r.token; me = r.actor;
  localStorage.setItem("da_token", token);
  localStorage.setItem("da_me", JSON.stringify(me));
  return me;
}

export function signOut() {
  token = null;
  me = null;
  localStorage.removeItem("da_token");
  localStorage.removeItem("da_me");
  // Tell the app to drop to the login screen (App listens for this). Fired both on
  // a manual sign-out and on an expired/invalid session (401).
  try { window.dispatchEvent(new CustomEvent("da-signout")); } catch { /* SSR */ }
}

export const getHealth = () => call("/api/health");
export const getState = () => call("/api/state");
export const postRequest = (r) => call("/api/requests", { method: "POST", body: r });
export const getAlerts = () => call("/api/alerts");
export const registerPush = (token, platform) => call("/api/push/register", { method: "POST", body: { token, platform } });

// ---- super-app modules (stock / price / sales / deliveries / recon) ----
export const getSites = () => call("/api/sites");
export const getSiteConfig = (site) => call(`/api/site-config${site ? `?site=${encodeURIComponent(site)}` : ""}`);
export const postSiteSubmit = (b) => call("/api/site-submit", { method: "POST", body: b });
export const postSiteDip = (b) => call("/api/site-dip", { method: "POST", body: b });
export const addSiteTank = (b) => call("/api/site-tank", { method: "POST", body: b });
export const addSiteCompetitor = (b) => call("/api/site-competitor", { method: "POST", body: b });
export const postStock = (b) => call("/api/stock", { method: "POST", body: b });
export const postPrice = (b) => call("/api/price", { method: "POST", body: b });
export const postSales = (b) => call("/api/sales", { method: "POST", body: b });
export const postDelivery = (b) => call("/api/deliveries", { method: "POST", body: b });
export const postAppDelivery = (b) => call("/api/delivery", { method: "POST", body: b });
export const approveDelivery = (dn, body) => call(`/api/delivery/${encodeURIComponent(dn)}/approve`, { method: "POST", body });
export const getPendingDeliveries = () => call("/api/deliveries/pending");
export const getAppDelivery = (dn) => call(`/api/delivery/${encodeURIComponent(dn)}`);
export const getAppDeliveries = () => call("/api/deliveries/app");
export const postRecon = (b) => call("/api/recon", { method: "POST", body: b });
export const getExecutive = (period, from, to, scope) => {
  let q = `/api/executive?period=${encodeURIComponent(period)}${from && to ? `&from=${from}&to=${to}` : ""}`;
  if (scope?.type === "site" && scope.value) q += `&site=${encodeURIComponent(scope.value)}`;
  else if (scope?.type === "region" && scope.value) q += `&region=${encodeURIComponent(scope.value)}`;
  return call(q);
};
export const getInventory = () => call("/api/inventory");
export const postWarehouseImport = (b) => call("/api/warehouse/import", { method: "POST", body: b });
export const getWarehouseBalances = () => call("/api/warehouse/balances");
export const postTrip = (b) => call("/api/trip", { method: "POST", body: b });
export const editTrip = (tripNo, b) => call(`/api/trip/${encodeURIComponent(tripNo)}/edit`, { method: "POST", body: b });
export const cancelTrip = (tripNo) => call(`/api/trip/${encodeURIComponent(tripNo)}/cancel`, { method: "POST" });
export const closeTrip = (tripNo) => call(`/api/trip/${encodeURIComponent(tripNo)}/close`, { method: "POST" });
export const getTrips = () => call("/api/trips");
export const getMyTrips = () => call("/api/trips/mine");
export const getDeliveriesInProgress = () => call("/api/deliveries/in-progress");
export const getDeliveriesDue = () => call("/api/deliveries/due");
export const collectTrip = (tripNo) => call(`/api/trip/${encodeURIComponent(tripNo)}/collect`, { method: "POST" });
export const postTripLeg = (tripNo, site, event) => call(`/api/trip/${encodeURIComponent(tripNo)}/leg`, { method: "POST", body: { site, event } });
// GPS breadcrumb streaming (driver) + the trip's track/ETA (managers). Pings post
// with a short timeout and are allowed to queue offline through the outbox.
export const postTripPing = (tripNo, pings) => call(`/api/trip/${encodeURIComponent(tripNo)}/ping`, { method: "POST", body: { pings }, timeoutMs: 8000 });
export const getTripTrack = (tripNo) => call(`/api/trip/${encodeURIComponent(tripNo)}/track`);
export const getDriverPerformance = (from, to, driver) => call(`/api/driver/performance?from=${from}&to=${to}${driver ? `&driver=${encodeURIComponent(driver)}` : ""}`);
export const getDriverLeague = (from, to) => call(`/api/drivers/league?from=${from}&to=${to}`);
export const routeGoogle = (points) => call("/api/route/google", { method: "POST", body: { points } });
export const getStationCoords = () => call("/api/geo/stations");
export const getYard = () => call("/api/yard");
export const getYardVehicles = () => call("/api/yard/vehicles");
export const yardOpen = (b) => call("/api/yard/open", { method: "POST", body: b });
export const yardUpdate = (b) => call("/api/yard/update", { method: "POST", body: b });
export const yardClose = (b) => call("/api/yard/close", { method: "POST", body: b });
export const getLubeProducts = () => call("/api/lube/products");
export const postLubeSale = (b) => call("/api/lube/sale", { method: "POST", body: b });
export const getLubeSales = (days = 7) => call(`/api/lube/sales?days=${days}`);
export const getWarehouseConfig = (warehouse) => call(`/api/warehouse-config?warehouse=${encodeURIComponent(warehouse)}`);
export const getRetail = (date) => call(`/api/retail?date=${encodeURIComponent(date)}`);
const rangeQS = (days, from, to) => (from && to ? `from=${from}&to=${to}` : `days=${days}`);
export const getHaulage = (days = 14, from = null, to = null) => call(`/api/haulage?${rangeQS(days, from, to)}`);
export const getWetstock = (days = 30, from = null, to = null) => call(`/api/wetstock?${rangeQS(days, from, to)}`);
export const getCash = (days = 30, from = null, to = null) => call(`/api/cash?${from && to ? `from=${from}&to=${to}` : `days=${days}`}`);
export const postCash = (b) => call("/api/cash", { method: "POST", body: b });
// Expected cash for a shift, derived from the site's sales submission (litres × DA price)
export const getExpectedCash = ({ site, date, shift } = {}) => {
  const q = new URLSearchParams();
  if (site) q.set("site", site);
  if (date) q.set("date", date);
  if (shift) q.set("shift", shift);
  return call(`/api/cash/expected?${q.toString()}`);
};
// Banking reconciliation & day-close (module A)
export const postCashDeposit = (b) => call("/api/cash/deposit", { method: "POST", body: b });
export const getCashRecon = (days = 30, from = null, to = null) => call(`/api/cash/recon?${from && to ? `from=${from}&to=${to}` : `days=${days}`}`);
export const getCashShortfall = () => call('/api/cash/shortfall');
export const getCashInflows = (days = 30, from = null, to = null) => call(`/api/cash/inflows?${from && to ? `from=${from}&to=${to}` : `days=${days}`}`);
export const requestUnlock = (b) => call("/api/unlock/request", { method: "POST", body: b });
export const getUnlockRequests = () => call("/api/unlock/requests");
export const decideUnlock = (id, outcome, note) => call(`/api/unlock/${id}/decide`, { method: "POST", body: { outcome, note } });
export const getCashflow = (days = 30) => call(`/api/cashflow?days=${days}`);
export const getSignals = (days = 30, from = null, to = null) => call(`/api/signals?${from && to ? `from=${from}&to=${to}` : `days=${days}`}`);
// Field feedback ("Report a problem")
export const postFeedback = (b) => call("/api/feedback", { method: "POST", body: b });
export const getFeedback = (status) => call(`/api/feedback${status ? `?status=${status}` : ""}`);
export const reviewDeposit = (seq, outcome, note) => call(`/api/cash/deposit/${seq}/review`, { method: "POST", body: { outcome, note } });
export const closeDay = (b) => call("/api/cash/dayclose", { method: "POST", body: b });
// Deposit-slip image needs the auth header, so fetch it as a blob → object URL
// (revoke it when done). Returns null if the deposit has no slip.
export const depositSlipUrl = async (seq) => {
  const res = await fetch(getServer() + `/api/cash/deposit/${seq}/photo`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
};
export const getSiteDayend = (site, days = 14) => call(`/api/site-dayend?site=${encodeURIComponent(site)}&days=${days}`);
// Indicative shift report (day/night) from supervisor submissions — mirrors the DA Finance Bot PDFs
export const getShiftReport = (shift = "night", date) => call(`/api/executive/shift?shift=${shift}${date ? `&date=${date}` : ""}`);
// Manager birds-eye analytics sections (scorecard | dayend | tanktrends | statustrends)
export const getSiteAnalytics = (section, from, to) => call(`/api/manager/analytics?section=${section}&from=${from}&to=${to}`);
// Fleet allocation vs system estimate — daily over/under-allocation report
export const getFleetAllocation = (from, to) => call(`/api/manager/allocation?from=${from}&to=${to}`);
export const getWatchSnoozes = () => call("/api/watchlist/snoozes");
export const postWatchSnooze = (b) => call("/api/watchlist/snooze", { method: "POST", body: b });
export const addSiteManager = (b) => call("/api/site-managers", { method: "POST", body: b });
export const getStaff = () => call("/api/staff");
export const assignSupervisorSite = (actorId, siteId, siteId2 = null) => call("/api/staff/supervisor-site", { method: "POST", body: { actorId, siteId, siteId2 } });
export const assignDriverHorse = (driverId, horse) => call("/api/staff/driver-horse", { method: "POST", body: { driverId, horse } });
export const postDecision = (ref, body) =>
  call(`/api/requests/${encodeURIComponent(ref)}/decision`, { method: "POST", body });
// ---- approver history: search, drill-down, Excel export ----
const apprQS = (f = {}) => {
  const p = new URLSearchParams();
  for (const k of ["driver", "truck", "from", "to", "q"]) if (f[k]) p.set(k, f[k]);
  const s = p.toString();
  return s ? `?${s}` : "";
};
// Outflows are sourced from the cash-office WHITESLIPS (the daily cash-breakdown
// sheets), reconciled to each sheet's printed total. (`currency` is accepted for
// signature compatibility but whiteslips are USD.)
export const getBankOutflows = (from, to /* , currency */) => {
  const p = new URLSearchParams();
  if (from) p.set("from", from); if (to) p.set("to", to);
  const s = p.toString();
  return call(`/api/whiteslip/outflows${s ? `?${s}` : ""}`);
};
export const getOutflowTxns = (f = {}) => {
  const p = new URLSearchParams();
  for (const k of ["payee", "category", "from", "to"]) if (f[k]) p.set(k, f[k]);
  const s = p.toString();
  return call(`/api/whiteslip/outflows/txns${s ? `?${s}` : ""}`);
};
export const getApprovalHistory = (f) => call(`/api/approvals/history${apprQS(f)}`);
export const getApprovalDetail = (ref) => call(`/api/approvals/${encodeURIComponent(ref)}`);
// Excel/CSV export — needs the auth header, so pull it as a blob and save it.
export const downloadApprovalsCsv = async (f) => {
  const sep = apprQS(f) ? "&" : "?";
  const res = await fetch(getServer() + `/api/approvals/history${apprQS(f)}${sep}format=csv`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error("export failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = `approvals-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};
export const postRedeem = (ref, body) =>
  call(`/api/requests/${encodeURIComponent(ref)}/redeem`, { method: "POST", body });
export const addDriver = (body) => call("/api/drivers", { method: "POST", body });
export const verifyChains = () => call("/api/verify");
export const getEfficiency = () => call("/api/efficiency");
// Intelligence answers can take a while (Claude reasoning) — give it room.
export const askIntelligence = (question, history) =>
  call("/api/intelligence", { method: "POST", body: { question, history }, timeoutMs: 90000 });

/* ---- Databricks (BizTracker retail via the warehouse) --------------------
   A second read source, separate from the Postgres-backed dashboards above.
   These can be slow on the first call of the day while a serverless warehouse
   starts, so they get the same long timeout as Intelligence rather than the
   default — a cold-start abort looks identical to "no data" on screen, and
   that is exactly the kind of unlabelled figure we don't ship.

   Responses carry `source: "databricks"`. Screens must show that: a number off
   the warehouse is BizTracker's, not ours, and the two can legitimately
   disagree until the field mapping is confirmed. */
export const getDatabricksHealth = (probe = false) =>
  call(`/api/databricks/health${probe ? "?probe=1" : ""}`, { timeoutMs: 90000 });

// Which named queries this signed-in actor may run.
export const getDatabricksQueries = () => call("/api/databricks/queries");

// Run one by key. `params` are the names the registry entry declares
// (e.g. { months: 6, site: "Msasa" }); anything else is dropped server-side.
export const runDatabricksQuery = (key, params = {}) => {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ).toString();
  return call(`/api/databricks/query/${encodeURIComponent(key)}${qs ? `?${qs}` : ""}`, { timeoutMs: 90000 });
};

// Schema discovery (admin). Call with nothing for catalogs, then narrow.
export const discoverDatabricks = ({ catalog, schema, table } = {}) => {
  const qs = new URLSearchParams(
    Object.entries({ catalog, schema, table }).filter(([, v]) => v)
  ).toString();
  return call(`/api/databricks/discover${qs ? `?${qs}` : ""}`, { timeoutMs: 90000 });
};
