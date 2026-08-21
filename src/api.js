/* Talks to the DA Fuel backend. Holds the sign-in token, and returns the
   read-model in the exact shapes the screens already use.

   Set VITE_API_BASE at build time to the server's URL (e.g. the Harare box).
   In `npm run dev` it is empty and Vite proxies /api to the local server. */

import { APP_BUILD } from "./config.js";

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
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  try {
    while (list.length) {
      const item = list[0];
      try {
        await call(item.path, { method: item.method, body: item.body, _replay: true });
      } catch (e) {
        if (e && e.offline) break;   // still offline → keep the queue, try again later
        // else: server rejected it — drop so it doesn't wedge the queue
      }
      list = outboxAll(); list.shift(); outboxSave(list);
    }
  } finally { flushing = false; }
}
// Drain automatically when the device regains connectivity.
if (typeof window !== "undefined") window.addEventListener("online", () => flushOutbox());

export async function signIn(loginId, pin) {
  const r = await call("/api/login", { method: "POST", body: { login: loginId, pin } });
  token = r.token;
  me = r.actor;
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
export const getExecutive = (period, from, to) => call(`/api/executive?period=${encodeURIComponent(period)}${from && to ? `&from=${from}&to=${to}` : ""}`);
export const getInventory = () => call("/api/inventory");
export const postWarehouseImport = (b) => call("/api/warehouse/import", { method: "POST", body: b });
export const getWarehouseBalances = () => call("/api/warehouse/balances");
export const postTrip = (b) => call("/api/trip", { method: "POST", body: b });
export const editTrip = (tripNo, b) => call(`/api/trip/${encodeURIComponent(tripNo)}/edit`, { method: "POST", body: b });
export const cancelTrip = (tripNo) => call(`/api/trip/${encodeURIComponent(tripNo)}/cancel`, { method: "POST" });
export const closeTrip = (tripNo) => call(`/api/trip/${encodeURIComponent(tripNo)}/close`, { method: "POST" });
export const getTrips = () => call("/api/trips");
export const getMyTrips = () => call("/api/trips/mine");
export const routeGoogle = (points) => call("/api/route/google", { method: "POST", body: { points } });
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
export const getHaulage = (days = 14) => call(`/api/haulage?days=${days}`);
export const getWetstock = (days = 30) => call(`/api/wetstock?days=${days}`);
export const getCash = (days = 30) => call(`/api/cash?days=${days}`);
export const postCash = (b) => call("/api/cash", { method: "POST", body: b });
// Banking reconciliation & day-close (module A)
export const postCashDeposit = (b) => call("/api/cash/deposit", { method: "POST", body: b });
export const getCashRecon = (days = 30) => call(`/api/cash/recon?days=${days}`);
export const getCashflow = (days = 30) => call(`/api/cashflow?days=${days}`);
export const getSignals = (days = 30) => call(`/api/signals?days=${days}`);
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
export const getWatchSnoozes = () => call("/api/watchlist/snoozes");
export const postWatchSnooze = (b) => call("/api/watchlist/snooze", { method: "POST", body: b });
export const addSiteManager = (b) => call("/api/site-managers", { method: "POST", body: b });
export const postDecision = (ref, body) =>
  call(`/api/requests/${encodeURIComponent(ref)}/decision`, { method: "POST", body });
export const postRedeem = (ref, body) =>
  call(`/api/requests/${encodeURIComponent(ref)}/redeem`, { method: "POST", body });
export const addDriver = (body) => call("/api/drivers", { method: "POST", body });
export const verifyChains = () => call("/api/verify");
export const getEfficiency = () => call("/api/efficiency");
// Intelligence answers can take a while (Claude reasoning) — give it room.
export const askIntelligence = (question, history) =>
  call("/api/intelligence", { method: "POST", body: { question, history }, timeoutMs: 90000 });
