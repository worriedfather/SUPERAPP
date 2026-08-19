/* Super-app modules — the in-app screens that replace the six WhatsApp bots.
   Structured submission (no more parsing messy chat text), written to the same
   append-only, attributable backend as fuel. Styling reuses the App.jsx design
   system (.card/.pill/.lbl/.mono/.cta + CSS vars). */
import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import {
  getSites, postPrice, postDelivery, postRecon, postRequest,
  getRetail, getHaulage, getWetstock, getCash, postCash, getSiteDayend, addSiteManager, getExecutive, getInventory, getWarehouseConfig,
  getWatchSnoozes, postWatchSnooze,
  postWarehouseImport, getWarehouseBalances, postTrip, editTrip, cancelTrip, closeTrip, getTrips, getMyTrips,
  postAppDelivery, getPendingDeliveries, approveDelivery, getAppDelivery,
  getSiteConfig, postSiteSubmit, addSiteTank, addSiteCompetitor,
  getYard, getYardVehicles, yardOpen, yardUpdate, yardClose,
  getLubeProducts, postLubeSale, getLubeSales,
} from "./api.js";
import { takeOdometerPhoto } from "./device.js";
import { Picker } from "./Picker.jsx";
import { remindersOn, setRemindersOn, syncReminders, cancelReminders, sendTestNotification } from "./notify.js";

const L = (n) => (Number.isFinite(Number(n)) ? Math.round(n).toLocaleString() : "—");
// fuel prices are quoted to the tenth-of-a-cent — 3dp everywhere so the retail
// board matches the executive board (was 2dp here, hiding sub-cent gaps).
const money = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(3) : "—");
const todayISO = () => new Date().toISOString().slice(0, 10);
// Sensible default shift, still user-overridable: evening/overnight → the "day"
// trading shift (17:00 close), otherwise "night". The app removes the guessing
// the bots had to do from message timestamps.
const defaultShift = () => { const h = new Date().getHours(); return h >= 17 || h < 5 ? "day" : "night"; };

/* ---------- small shared UI (matches App.jsx classes) ---------- */
const Panel = ({ children, style, onClick, id }) => (
  <div id={id} className="card" onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    style={{ padding: 16, cursor: onClick ? "pointer" : undefined, ...style }}>{children}</div>
);
const Field = ({ label, children }) => (
  <label style={{ display: "block", marginBottom: 11 }}><span className="lbl">{label}</span>{children}</label>
);
const Note = ({ tone = "ok", title, children }) => {
  const c = { red: ["#D63B2E", "#FDECEA"], amber: ["#C07A00", "#FEF4E6"], ok: ["#4C9E2A", "#EBF6E7"], blue: ["#2B3990", "#EAEEFB"] }[tone];
  return (
    <div style={{ background: c[1], border: `1px solid ${c[0]}`, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
      <div className="disp" style={{ color: c[0], fontSize: 13, fontWeight: 700 }}>{title}</div>
      {children && <div style={{ fontSize: 13, marginTop: 4 }}>{children}</div>}
    </div>
  );
};
const SectionHead = ({ title, sub }) => (
  <div style={{ margin: "4px 2px 14px" }}>
    <h2 style={{ margin: 0, fontSize: 22, color: "var(--navy)" }}>{title}</h2>
    {sub && <div style={{ fontSize: 13, color: "var(--steel)", marginTop: 3 }}>{sub}</div>}
  </div>
);

// Drill-down back-history for a screen's internal sub-tabs. Any section change is
// remembered (browser-like); Back() returns to the previous section by name — so a
// drill such as "See full inventory" leaves a clear "‹ Back to Overview" control.
function useNavStack(initial) {
  const [tab, setTabRaw] = useState(initial);
  const [stack, setStack] = useState([]);
  const setTab = (next) => { if (next !== tab) setStack((s) => [...s, tab]); setTabRaw(next); };
  const back = () => setStack((s) => { if (!s.length) return s; setTabRaw(s[s.length - 1]); return s.slice(0, -1); });
  return { tab, setTab, back, prev: stack.length ? stack[stack.length - 1] : null };
}
// The "‹ Back to <previous section>" pill. Renders only after a drill (prev set).
function BackBar({ prev, options, onBack }) {
  if (!prev) return null;
  const found = (options || []).find(([k]) => k === prev);
  const label = found ? found[1] : prev;
  return (
    <button type="button" onClick={onBack} className="disp"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff",
        border: "1px solid var(--line)", borderRadius: 999, padding: "6px 14px 6px 9px",
        fontSize: 13, fontWeight: 700, color: "var(--navy)", cursor: "pointer", marginBottom: 12 }}>
      <span style={{ fontSize: 19, lineHeight: 1, color: "var(--amber)" }}>‹</span> Back to {label}
    </button>
  );
}
const Num = (props) => (
  <input inputMode="decimal" enterKeyHint="done"
    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } }}
    {...props} onChange={(e) => props.onChange(e.target.value)} value={props.value ?? ""} />
);
// Even-fill pills for a few options; a horizontally-scrolling strip once there
// are too many to fit (so the tab bar never widens the page on a narrow phone).
const Segmented = ({ options, value, onChange }) => {
  const scroll = options.length > 4;
  const ref = useRef(null);
  // keep the active tab in view — makes it obvious the ribbon scrolls & moves
  useEffect(() => {
    if (!scroll || !ref.current) return;
    const el = ref.current.querySelector('[data-on="1"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [value, scroll]);
  const buttons = options.map(([k, label]) => (
    <button key={k} data-on={value === k ? "1" : "0"} type="button" onClick={() => onChange(k)} style={{
      flex: scroll ? "0 0 auto" : 1, whiteSpace: "nowrap", padding: scroll ? "9px 13px" : "10px 14px", borderRadius: 100, fontWeight: 700, fontSize: 13, cursor: "pointer",
      background: value === k ? "var(--blue)" : "transparent", color: value === k ? "#fff" : "var(--steel)", transition: "background .15s",
    }}>{label}</button>
  ));
  if (!scroll) return <div style={{ display: "flex", gap: 6, background: "#fff", border: "1px solid var(--line)", borderRadius: 100, padding: 4, marginBottom: 16 }}>{buttons}</div>;
  // scrollable ribbon: edge fades signal there's more to either side
  return (
    <div style={{ position: "relative", marginBottom: 16 }}>
      <div ref={ref} className="noscrollbar" style={{ display: "flex", gap: 6, background: "#fff", border: "1px solid var(--line)", borderRadius: 100, padding: 4, overflowX: "auto", WebkitOverflowScrolling: "touch", scrollSnapType: "x proximity" }}>{buttons}</div>
      <div aria-hidden style={{ position: "absolute", top: 4, bottom: 4, left: 4, width: 22, borderRadius: "100px 0 0 100px", background: "linear-gradient(270deg, rgba(255,255,255,0), #fff 75%)", pointerEvents: "none" }} />
      <div aria-hidden style={{ position: "absolute", top: 4, bottom: 4, right: 4, width: 30, borderRadius: "0 100px 100px 0", background: "linear-gradient(90deg, rgba(255,255,255,0), #fff 75%)", pointerEvents: "none" }} />
    </div>
  );
};
const Wrap = ({ children }) => <div className="wrap">{children}</div>;
// Button-style period/range selector (used everywhere instead of a dropdown).
const RANGE_OPTS = [[1, "Today"], [7, "7 days"], [14, "14 days"], [30, "30 days"], [90, "90 days"], [365, "1 year"]];
const RangeTabs = ({ days, setDays, options = RANGE_OPTS }) => (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
    {options.map(([d, label]) => (
      <button key={d} type="button" onClick={() => setDays(d)} className="disp" style={{
        padding: "7px 13px", borderRadius: 100, fontSize: 12, fontWeight: 700, cursor: "pointer",
        border: `1.5px solid ${days === d ? "var(--blue)" : "var(--line)"}`,
        background: days === d ? "var(--blue)" : "#fff", color: days === d ? "#fff" : "var(--ink)",
      }}>{label}</button>
    ))}
  </div>
);

// Download a table as CSV (opens in Excel) — the modern stand-in for the bots'
// daily Excel/PDF report. header = ["Site","Blend",…]; rows = [[…],[…]].
function downloadCsv(filename, header, rows) {
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const ExportBtn = ({ onClick }) => (
  <button className="pill-ghost" onClick={onClick} style={{ padding: "10px 16px", whiteSpace: "nowrap" }}>Export CSV</button>
);

// Build the CSV for whichever retail board is showing (both shifts included).
function exportRetail(which, d) {
  if (which === "stock") {
    downloadCsv(`DA_Stock_${d.date}.csv`,
      ["Site", "Region", "Day Blend", "Day Diesel", "Night Blend", "Night Diesel"],
      d.sites.map((s) => { const dd = d.stock.day[s.id] || {}, nn = d.stock.night[s.id] || {};
        return [s.name, s.region, dd.blend ?? "", dd.diesel ?? "", nn.blend ?? "", nn.diesel ?? ""]; }));
  } else if (which === "sales") {
    downloadCsv(`DA_Sales_${d.date}.csv`,
      ["Site", "Region", "Day Blend Sales", "Day Diesel Sales", "Night Blend Sales", "Night Diesel Sales"],
      d.sites.map((s) => { const dd = d.sales.day[s.id] || {}, nn = d.sales.night[s.id] || {};
        return [s.name, s.region, dd.blendSales ?? "", dd.dieselSales ?? "", nn.blendSales ?? "", nn.dieselSales ?? ""]; }));
  } else {
    const rows = [];
    for (const [id, p] of Object.entries(d.price.bySite)) {
      const name = d.sites.find((s) => String(s.id) === String(id))?.name || id;
      for (const fuel of ["Blend", "Diesel"]) { const a = p.analysis[fuel]; if (a && a.da != null) rows.push([name, fuel, a.da, a.min ?? "", a.avg ?? "", a.max ?? "", a.gap ?? "", a.competitors]); }
    }
    downloadCsv(`DA_Prices_${d.date}.csv`, ["Site", "Fuel", "DA Price", "Mkt Min", "Mkt Avg", "Mkt Max", "Gap vs Avg", "Competitors"], rows);
  }
}
function exportHaulage(which, d) {
  if (which === "deliveries") {
    downloadCsv("DA_Deliveries.csv",
      ["D/N", "Date", "Commodity", "Loaded From", "Delivered To", "Truck", "Qty Loaded", "Truck Dip", "Site Dip", "Transit Loss", "Discharge Loss", "Combined Loss", "Loss %", "Flagged"],
      d.deliveries.map((x) => [x.id, x.date ?? "", x.commodity ?? "", x.loadedFrom ?? "", x.deliveredTo ?? "", x.truckReg ?? "", x.qtyLoaded ?? "", x.truckDip ?? "", x.siteDip ?? "", x.transitLoss ?? "", x.dischargeLoss ?? "", x.combinedLoss ?? "", x.lossPct ?? "", x.flagged ? "YES" : ""]));
  } else {
    const rows = [];
    for (const r of d.recons) for (const l of r.lines) rows.push([r.warehouse, r.date, l.product, l.opening, l.receipts, l.issued, l.theoretical, l.reported ?? "", l.discrepancy ?? "", l.status]);
    downloadCsv("DA_Recon.csv", ["Warehouse", "Date", "Product", "Opening", "Receipts", "Issued", "Theoretical", "Reported", "Discrepancy", "Status"], rows);
  }
}
// Executive-dashboard section exports (one CSV per section, current period).
function exportExecSales(d) {
  const day = d.asOf?.date || "";
  downloadCsv(`DA_Sales_by_site_${day}.csv`, ["Site", "Blend (L)", "Diesel (L)", "ULP (L)", "Total (L)", "Revenue ($)"],
    (d.sales?.sites || []).map((s) => [s.site, Math.round(s.blend || 0), Math.round(s.diesel || 0), Math.round(s.ulp || 0), Math.round(s.litres || 0), Math.round(s.cash || 0)]));
}
function exportExecMargin(d) {
  const m = d.kpis?.margin; if (!m) return;
  downloadCsv(`DA_Margin_${d.asOf?.date || ""}.csv`, ["Product", "Litres", "Sell/L", "Cost/L", "Margin/L", "Gross $"],
    (m.byProduct || []).map((p) => [p.product, p.litres, p.price ?? "", p.cost ?? "", p.cpl != null ? p.cpl.toFixed(4) : "", p.gm ?? ""]));
}
function exportExecInventory(d) {
  const rows = [];
  for (const w of (d.supply?.warehouses || [])) rows.push(["Warehouse", w.name, w.products?.Diesel || 0, w.products?.Blend || 0, w.products?.ULP || 0, w.stock || 0, w.transit || 0]);
  for (const s of (d.supply?.siteList || [])) rows.push(["Site", s.site, s.diesel || 0, s.blend || 0, s.ulp || 0, s.total || 0, ""]);
  downloadCsv(`DA_Inventory_${d.asOf?.date || ""}.csv`, ["Type", "Name", "Diesel (L)", "Blend (L)", "ULP (L)", "On hand (L)", "In transit (L)"], rows);
}
function exportExecFleet(d) {
  downloadCsv("DA_Fleet_efficiency.csv", ["Vehicle", "km/L", "Town km/L", "Road km/L", "90d km", "Litres", "Fills"],
    (d.fleet?.vehicles || []).map((v) => [v.vehicle, v.kmpl ?? "", v.townKmpl ?? "", v.roadKmpl ?? "", v.km ?? "", v.litres ?? "", v.fills ?? ""]));
}
function exportWetstock(d) {
  downloadCsv(`DA_Wetstock_losses.csv`, ["Site", "Delivery loss (L)", "Site loss (L)", "Total loss (L)", "Loss %", "Status"],
    (d.sites || []).map((s) => [s.site, Math.round(s.deliveryLoss || 0), Math.round(s.siteLoss || 0), Math.round(s.totalLoss || 0), s.lossPct ?? "", s.status ?? ""]));
}

const submitBtn = (busy, label) => (
  <button className="pill" disabled={busy} style={{ width: "100%", marginTop: 6 }}>{busy ? "Sending…" : label}</button>
);

// The site a submission is for: fixed for a site_manager, chosen for staff.
function useSiteChoice(me) {
  const [sites, setSites] = useState([]);
  const fixed = me?.kind === "site_manager";
  useEffect(() => {
    if (!fixed) getSites().then((r) => setSites(r.sites)).catch(() => {});
  }, [fixed]);
  return { fixed, fixedSite: me?.site || null, sites };
}
const SitePicker = ({ choice, value, onChange }) =>
  choice.fixed ? (
    <Field label="Site"><input value={choice.fixedSite || "—"} disabled /></Field>
  ) : (
    <Field label="Site">
      <Picker value={value} onChange={onChange} placeholder="Select a site…" title="Site" options={choice.sites.map((s) => s.name)} />
    </Field>
  );

/* Reminder control: daily submission nudges on this device + a Test button so
   you can see a notification fire now. */
export function ReminderBar({ me }) {
  const [on, setOn] = useState(remindersOn());
  const [msg, setMsg] = useState(null);
  const toggle = async () => {
    const next = !on; setOn(next); setRemindersOn(next);
    try {
      if (next) {
        const r = await syncReminders(me.kind, me.site);
        if (r.denied) setMsg("Turn on notifications for DA OPS in your phone Settings to get reminders.");
        else if (r.error) setMsg("Reminders saved, but this phone blocked scheduling — check notification settings.");
        else if (!r.native) setMsg("Reminders on (they fire on the phone app, not the browser).");
        else setMsg("Daily reminders on");
      } else { await cancelReminders(me.kind); setMsg("Reminders off"); }
    } catch { setMsg("Couldn't update reminders — try again."); }
    setTimeout(() => setMsg(null), 4000);
  };
  const test = async () => {
    try {
      const r = await sendTestNotification();
      setMsg(r.ok ? (r.in ? `Test notification in ${r.in}s…` : "Test notification sent") : `Can't send — ${r.reason}`);
    } catch { setMsg("Couldn't send a test notification."); }
    setTimeout(() => setMsg(null), 5000);
  };
  return (
    <div className="card" style={{ padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontSize: 22 }}>🔔</span>
      <div style={{ flex: 1, minWidth: 120 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "var(--navy)" }}>Reminders</div>
        <div style={{ fontSize: 11, color: "var(--steel)" }}>{msg || (on ? "Daily nudges to submit" : "Off")}</div>
      </div>
      <button className="pill-ghost" style={{ padding: "8px 14px" }} onClick={test}>Test</button>
      <button className="pill-ghost" style={{ padding: "8px 14px", background: on ? "var(--lime)" : "#fff", color: on ? "#14213D" : "var(--ink)", borderColor: on ? "var(--lime)" : "var(--line)" }} onClick={toggle}>{on ? "On" : "Off"}</button>
    </div>
  );
}

/* ============================================================ *
 *  SITE MANAGER — submit hub (Stock / Price / Sales)
 * ============================================================ */
const shiftNow = () => (new Date().getHours() >= 17 ? "day" : "night");
const shiftLabel = (s) => (s === "day" ? "Day shift · 17:00–23:59" : "Night shift · 00:00–16:59");
// The freshest COMPLETE shift to review right now = the opposite of the one
// currently being collected. Evening (day shift 17:00–23:59 collecting) → show
// the night shift that just wrapped at ~17:00; morning/afternoon (night
// collecting) → show the day shift that finished the night before. This makes
// the retail board open on the most natural view for the clock instead of a
// fixed default. `pick` lets a board fall back if that shift has no data yet.
const naturalShift = () => (shiftNow() === "day" ? "night" : "day");
const pickShift = (has, fallback) => {
  const nat = naturalShift();
  if (has(nat)) return nat;
  const other = nat === "day" ? "night" : "day";
  if (has(other)) return other;
  return fallback;
};

export function SiteSubmit({ me }) {
  const choice = useSiteChoice(me);
  const [site, setSite] = useState(choice.fixedSite || "");
  const [which, setWhich] = useState("readings");
  const [config, setConfig] = useState(null);
  const [cfgErr, setCfgErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const activeSite = choice.fixed ? choice.fixedSite : site;
  const shift = shiftNow(); const date = todayISO();

  const loadCfg = useCallback(() => {
    if (!activeSite) { setConfig(null); return; }
    setLoading(true); setConfig(null); setCfgErr(null);
    getSiteConfig(choice.fixed ? undefined : activeSite).then(setConfig).catch((e) => { setConfig(null); setCfgErr(e.message || "Couldn't load this site's setup."); }).finally(() => setLoading(false));
  }, [activeSite, choice.fixed]);
  useEffect(() => { loadCfg(); }, [loadCfg]);

  return (
    <Wrap>
      <SectionHead title="Site submission" sub={activeSite || "Choose a site"} />
      {me && <ReminderBar me={me} />}
      {!choice.fixed && <SitePicker choice={choice} value={site} onChange={setSite} />}
      {activeSite && (
        <>
          <div className="card" style={{ padding: "11px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><span className="lbl" style={{ marginBottom: 1 }}>Shift (auto)</span><div className="disp" style={{ fontWeight: 700, color: "var(--navy)", fontSize: 14 }}>{shiftLabel(shift)}</div></div>
            <div style={{ textAlign: "right" }}><span className="lbl" style={{ marginBottom: 1 }}>Date</span><div className="mono" style={{ fontSize: 13 }}>{date}</div></div>
          </div>
          <Segmented options={[["readings", "Stock & Sales"], ["prices", "Prices"], ["cash", "Cash"]]} value={which} onChange={setWhich} />
          {loading && <Panel><div style={{ color: "var(--steel)" }}>Loading…</div></Panel>}
          {cfgErr && <Note tone="red" title="Couldn't load this site">{cfgErr} <button type="button" className="pill-ghost" style={{ marginTop: 8, padding: "6px 14px" }} onClick={loadCfg}>Retry</button></Note>}
          {config && which === "readings" && <ReadingsForm choice={choice} site={activeSite} config={config} date={date} shift={shift} onSaved={loadCfg} />}
          {config && which === "prices" && <PricesForm choice={choice} site={activeSite} config={config} date={date} onSaved={loadCfg} />}
          {which === "cash" && <CashForm choice={choice} site={activeSite} date={date} shift={shift} />}
        </>
      )}
    </Wrap>
  );
}

// Stock (per tank) + sales in one submission. Tanks and the previous readings
// are preloaded; the user changes only what moved.
function ReadingsForm({ choice, site, config, date, shift, onSaved }) {
  const lastByLabel = Object.fromEntries((config.lastStock || []).map((t) => [t.label, t.litres]));
  const [tanks, setTanks] = useState(config.tanks.map((t) => ({ label: t.label, product: t.product, litres: lastByLabel[t.label] ?? "" })));
  const [sales, setSales] = useState({ blendSales: "", dieselSales: "" });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const setTank = (i, v) => setTanks((ts) => ts.map((t, j) => (j === i ? { ...t, litres: v } : t)));

  const send = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const r = await postSiteSubmit({
        site: choice.fixed ? undefined : site, tradingDate: date, shift,
        tanks: tanks.map((t) => ({ label: t.label, product: t.product, litres: t.litres })),
        blendSales: sales.blendSales, dieselSales: sales.dieselSales, deviceTime: new Date().toISOString(),
      });
      setMsg({ tone: "ok", title: "Submitted", body: `Stock ${L(r.blend)} blend · ${L(r.diesel)} diesel` });
    } catch (err) { setMsg({ tone: "red", title: "Not submitted", body: err.message }); }
    finally { setBusy(false); }
  };

  return (
    <Panel>
      <form onSubmit={send}>
        {msg && <Note tone={msg.tone} title={msg.title}>{msg.body}</Note>}
        <span className="lbl">Tank readings (litres)</span>
        {tanks.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{t.label}</div>
              <div style={{ fontSize: 11, color: "var(--steel)" }}>{t.product}{lastByLabel[t.label] != null ? ` · was ${L(lastByLabel[t.label])}` : ""}</div>
            </div>
            <Num style={{ maxWidth: 150 }} value={t.litres} onChange={(v) => setTank(i, v)} placeholder="litres" />
          </div>
        ))}
        <div style={{ height: 8 }} />
        <span className="lbl">Sales this shift (litres)</span>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Blend sold"><Num value={sales.blendSales} onChange={(v) => setSales((s) => ({ ...s, blendSales: v }))} /></Field></div>
          <div style={{ flex: 1 }}><Field label="Diesel sold"><Num value={sales.dieselSales} onChange={(v) => setSales((s) => ({ ...s, dieselSales: v }))} /></Field></div>
        </div>
        {config.lastSales && <div style={{ fontSize: 11, color: "var(--steel)", marginBottom: 12 }}>Last: {L(config.lastSales.blend_sales)} blend · {L(config.lastSales.diesel_sales)} diesel sold</div>}
        <button className="pill" disabled={busy} style={{ width: "100%" }}>{busy ? "Sending…" : "Submit stock & sales"}</button>
      </form>
    </Panel>
  );
}

// Price survey — the site's competitor list is preloaded, prices default to
// yesterday's; the user changes only what moved and can add a competitor.
function PricesForm({ choice, site, config, date, onSaved }) {
  const last = config.lastPrice || [];
  const priceOf = (station, fuel) => { const l = last.find((x) => x.station === station && x.fuelType === fuel); return l ? l.price : ""; };
  const daName = `DA ${site}`;
  const daPrice = (fuel) => { const l = last.find((x) => x.isDA && x.fuelType === fuel); return l ? l.price : ""; };
  const [rows, setRows] = useState([
    { station: daName, isDA: true, petrol: daPrice("Petrol"), diesel: daPrice("Diesel") },
    ...config.competitors.map((c) => ({ station: c.name, brand: c.brand, isDA: false, petrol: priceOf(c.name, "Petrol"), diesel: priceOf(c.name, "Diesel") })),
  ]);
  const [newComp, setNewComp] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const setRow = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const addComp = async () => {
    if (!newComp.trim()) return;
    try { await addSiteCompetitor({ site: choice.fixed ? undefined : site, name: newComp.trim() }); setNewComp(""); onSaved(); }
    catch (e) { setMsg({ tone: "red", title: "Could not add", body: e.message }); }
  };
  const send = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    const lines = [];
    for (const r of rows) {
      if (!r.station.trim()) continue;
      if (r.petrol) lines.push({ station: r.station.trim(), brand: r.brand, isDA: r.isDA, fuelType: "Petrol", price: Number(r.petrol) });
      if (r.diesel) lines.push({ station: r.station.trim(), brand: r.brand, isDA: r.isDA, fuelType: "Diesel", price: Number(r.diesel) });
    }
    try { const r = await postPrice({ site: choice.fixed ? undefined : site, tradingDate: date, lines, deviceTime: new Date().toISOString() }); setMsg({ tone: "ok", title: "Prices submitted", body: `${r.lines} prices` }); }
    catch (err) { setMsg({ tone: "red", title: "Not submitted", body: err.message }); }
    finally { setBusy(false); }
  };

  return (
    <Panel>
      <form onSubmit={send}>
        {msg && <Note tone={msg.tone} title={msg.title}>{msg.body}</Note>}
        <div style={{ fontSize: 12, color: "var(--steel)", marginBottom: 10 }}>Yesterday's prices are preloaded — change only what moved.</div>
        <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--steel)", padding: "0 2px 4px" }}>
          <span style={{ flex: 1 }}>STATION</span><span style={{ width: 66, textAlign: "center" }}>PETROL</span><span style={{ width: 66, textAlign: "center" }}>DIESEL</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, padding: "6px 8px", borderRadius: 10, background: r.isDA ? "#EAEEFB" : "#fff", border: "1px solid var(--line)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.isDA ? "★ " : ""}{r.station}</div>
              {r.brand && <div style={{ fontSize: 11, color: "var(--steel)" }}>{r.brand}</div>}
            </div>
            <Num style={{ width: 66, padding: "9px 7px" }} value={r.petrol} onChange={(v) => setRow(i, "petrol", v)} />
            <Num style={{ width: 66, padding: "9px 7px" }} value={r.diesel} onChange={(v) => setRow(i, "diesel", v)} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, margin: "10px 0 14px" }}>
          <input style={{ flex: 1 }} placeholder="Add a competitor station" value={newComp} onChange={(e) => setNewComp(e.target.value)} />
          <button type="button" className="pill-ghost" style={{ padding: "8px 12px" }} onClick={addComp}>+ Add</button>
        </div>
        <button className="pill" disabled={busy} style={{ width: "100%" }}>{busy ? "Sending…" : "Submit prices"}</button>
      </form>
    </Panel>
  );
}

// Cash collections — the tender split (USD cash / swipe / DA card) taken this
// shift, plus what was banked. Reconciled server-side against expected takings
// (litres × price). USD notes are the tender that must be physically banked.
function CashForm({ choice, site, date, shift }) {
  const [f, setF] = useState({ usdCash: "", swipe: "", daCard: "", banked: "", bankRef: "" });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const n = (v) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : 0; };
  const declared = n(f.usdCash) + n(f.swipe) + n(f.daCard);
  const dollars = (v) => "$" + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

  const send = async (e) => {
    e.preventDefault(); setMsg(null);
    if (declared + n(f.banked) === 0) { setMsg({ tone: "amber", title: "Nothing to submit", body: "Enter at least one tender amount, or the amount banked." }); return; }
    setBusy(true);
    try {
      const r = await postCash({
        site: choice.fixed ? undefined : site, tradingDate: date, shift,
        usdCash: n(f.usdCash), swipe: n(f.swipe), daCard: n(f.daCard), banked: n(f.banked),
        bankRef: f.bankRef || null, deviceTime: new Date().toISOString(),
      });
      setMsg({ tone: "ok", title: "Cash submitted", body: `${dollars(declared)} taken · ${dollars(n(f.banked))} banked — ${r.site}` });
      setF({ usdCash: "", swipe: "", daCard: "", banked: "", bankRef: "" });
    } catch (err) { setMsg({ tone: "red", title: "Not submitted", body: err.message }); }
    finally { setBusy(false); }
  };

  return (
    <Panel>
      <form onSubmit={send}>
        {msg && <Note tone={msg.tone} title={msg.title}>{msg.body}</Note>}
        <span className="lbl">Takings this shift (US$)</span>
        <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
          <div style={{ flex: 1 }}><Field label="USD cash"><Num value={f.usdCash} onChange={(v) => set("usdCash", v)} placeholder="notes" /></Field></div>
          <div style={{ flex: 1 }}><Field label="Card swipe"><Num value={f.swipe} onChange={(v) => set("swipe", v)} /></Field></div>
          <div style={{ flex: 1 }}><Field label="DA card"><Num value={f.daCard} onChange={(v) => set("daCard", v)} /></Field></div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 2px 12px", fontSize: 12.5 }}>
          <span style={{ color: "var(--steel)" }}>Total takings declared</span>
          <span className="mono" style={{ fontWeight: 700, color: "var(--navy)" }}>{dollars(declared)}</span>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <span className="lbl">Banking</span>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><Field label="USD cash banked"><Num value={f.banked} onChange={(v) => set("banked", v)} /></Field></div>
            <div style={{ flex: 1 }}><Field label="Deposit ref (optional)"><input value={f.bankRef} onChange={(e) => set("bankRef", e.target.value)} placeholder="slip no." /></Field></div>
          </div>
          {n(f.usdCash) > 0 && (
            <div style={{ fontSize: 11, color: n(f.banked) < n(f.usdCash) ? "var(--amber)" : "var(--steel)", marginBottom: 12 }}>
              {n(f.banked) >= n(f.usdCash) ? "All USD cash banked." : `${dollars(n(f.usdCash) - n(f.banked))} of USD cash still on hand — bank it as soon as possible.`}
            </div>
          )}
        </div>
        <button className="pill" disabled={busy} style={{ width: "100%" }}>{busy ? "Sending…" : "Submit cash & banking"}</button>
      </form>
    </Panel>
  );
}

/* ============================================================ *
 *  EXECUTIVE DASHBOARD — the numbers at a glance, any period
 * ============================================================ */
const compact = (n) => {
  const x = Number(n) || 0, a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return (x / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "k";
  return Math.round(x).toLocaleString();
};

function Sparkline({ points, height = 46, color = "var(--blue)" }) {
  if (!points || points.length < 2) return <div style={{ height, display: "grid", placeItems: "center", color: "var(--steel)", fontSize: 12 }}>Not enough data yet</div>;
  const vals = points.map((p) => p.litres);
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  const W = 300, H = height, span = max - min || 1;
  const x = (i) => (i / (points.length - 1)) * W;
  const y = (v) => H - ((v - min) / span) * (H - 6) - 3;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.litres).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height }}>
      <defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.22" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill="url(#spk)" /><path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const Delta = ({ v }) => {
  if (v == null) return null;
  const flat = Math.abs(v) < 0.05;                       // a flat change is neutral, not a green rise
  const col = flat ? "#8A94A6" : v > 0 ? "#6BC048" : "#FF6B5E";
  return (
    <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: col, background: `${col}22`, padding: "2px 7px", borderRadius: 100, marginTop: 7 }}>
      {flat ? "—" : v > 0 ? "▲" : "▼"} {Math.abs(v)}%
    </span>
  );
};
const Hero = ({ label, value, unit, sub, accent = "var(--lime)", delta, onClick }) => (
  <div onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    style={{ background: "linear-gradient(150deg,#22345C,#14213D)", borderRadius: 18, padding: "16px 18px", color: "#EAF0FA", boxShadow: "0 10px 26px rgba(20,33,61,.22)", cursor: onClick ? "pointer" : "default", position: "relative" }}>
    {onClick && <span aria-hidden style={{ position: "absolute", top: 12, right: 14, color: "#8FA0C4", fontSize: 15 }}>›</span>}
    <div className="disp" style={{ fontSize: 11, letterSpacing: ".12em", color: "#8FA0C4" }}>{label}</div>
    <div className="mono" style={{ fontSize: "clamp(26px,7vw,34px)", lineHeight: 1.05, fontWeight: 500, color: accent, marginTop: 6, letterSpacing: "-.02em" }}>
      {value}{unit && <span style={{ fontSize: 14, marginLeft: 4, color: "#8FA0C4" }}>{unit}</span>}
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
      {sub && <div className="mono" style={{ fontSize: 11, color: "#9FB0D0", marginTop: 5 }}>{sub}</div>}
      <Delta v={delta} />
    </div>
  </div>
);
/* Revenue & volume MIX — the two streams: DA's own pump sales (fuel sold at the
   pump price) vs Petrotrade coupon redemptions (add volume, earn only a commission).
   Volume is invoice-billed here (differs slightly from the pump-metered total). */
function RevenueMixPanel({ mix }) {
  const money = (v) => "$" + compact(v || 0);
  const rows = [
    ["DA pump sales", mix.pump.volume, money(mix.pump.revenue), "var(--ok)"],
    ["Petrotrade coupons", mix.coupon.volume, money(mix.coupon.commission) + " comm.", "var(--amber)"],
  ];
  return (
    <Panel style={{ marginBottom: 12 }}>
      <div className="lbl" style={{ marginBottom: 8 }}>Revenue &amp; volume mix</div>
      <div style={{ overflowX: "auto" }}>
        <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr style={{ color: "var(--steel)", textAlign: "left" }}><th style={{ fontWeight: 600, padding: "0 0 6px" }}>Stream</th><th style={{ fontWeight: 600, textAlign: "right" }}>Volume</th><th style={{ fontWeight: 600, textAlign: "right" }}>Revenue</th></tr></thead>
          <tbody>
            {rows.map(([label, vol, rev, col]) => (
              <tr key={label} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "7px 0" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: col }} />{label}</span></td>
                <td style={{ textAlign: "right" }}>{compact(vol)} L</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{rev}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid var(--navy)", background: "#F4F6FA" }}>
              <td style={{ padding: "7px 0", fontWeight: 700 }}>Total</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{compact(mix.total.volume)} L</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{money(mix.total.revenue)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: "var(--steel)", marginTop: 6 }}>Coupons add volume but earn only DA's commission (~$0.05/L), not the pump price.</div>
    </Panel>
  );
}

/* A boxed unit figure (sell or cost per litre) — clean, uncramped. */
function UnitCell({ label, value }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 11px" }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10.5, color: "var(--steel)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 2 }}>{label}</div>
      <div className="mono" style={{ fontSize: 15.5, fontWeight: 600, color: "var(--ink)" }}>{value}</div>
    </div>
  );
}

/* How we compare — latest complete day vs the day before + same day last month, and
   month-to-date vs the same span last month. Anchored to the latest COMPLETE day so a
   partial day never shows a fake decline. */
function ComparisonPanel({ cmp }) {
  const tag = (v) => {
    if (v == null) return <span className="mono" style={{ fontSize: 12, color: "var(--steel)" }}>—</span>;
    const flat = Math.abs(v) < 0.5;
    const col = flat ? "#8A94A6" : v < 0 ? "var(--red)" : "var(--ok)";
    return <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: col }}>{flat ? "→" : v < 0 ? "▼" : "▲"} {Math.abs(v)}%</span>;
  };
  const cmpRow = (label, volPct, revPct) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
      <span style={{ fontSize: 12.5, color: "var(--steel)" }}>{label}</span>
      <span style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <span style={{ display: "flex", gap: 5, alignItems: "baseline" }}><span style={{ fontSize: 10, color: "var(--steel)" }}>vol</span>{tag(volPct)}</span>
        <span style={{ display: "flex", gap: 5, alignItems: "baseline" }}><span style={{ fontSize: 10, color: "var(--steel)" }}>$</span>{tag(revPct)}</span>
      </span>
    </div>
  );
  const head = (title, sub, vol, rev) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontWeight: 700, fontSize: 14, letterSpacing: ".03em", color: "var(--navy)" }}>{title}{sub && <span style={{ color: "var(--steel)", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>{sub}</span>}</span>
      <span className="mono" style={{ fontSize: 12.5 }}>{compact(vol)} L · ${compact(rev)}</span>
    </div>
  );
  const v = cmp.vol, r = cmp.rev;
  // The headline number: month-to-date vs the same span last month. This is the
  // stable read — a single day routinely swings ±14% on weekday/rota alone, so the
  // day comparisons live below as context, not as the lead figure.
  const bigTag = (val) => {
    if (val == null) return <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: "var(--steel)" }}>—</span>;
    const flat = Math.abs(val) < 0.5;
    const col = flat ? "#8A94A6" : val < 0 ? "var(--red)" : "var(--ok)";
    return <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: col, lineHeight: 1 }}>{flat ? "→" : val < 0 ? "▼" : "▲"} {Math.abs(val)}%</span>;
  };
  return (
    <Panel style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 0 }}>How we compare</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--steel)" }}>as of {fmtD(cmp.day)}</div>
      </div>
      {/* HEADLINE — month to date vs last month (the trend that matters) */}
      <div style={{ background: "#F4F6FA", borderRadius: 12, padding: "13px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <span style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontWeight: 700, fontSize: 14, letterSpacing: ".03em", color: "var(--navy)" }}>Month to date <span style={{ color: "var(--steel)", fontWeight: 400, fontSize: 11 }}>vs last month · same {cmp.mtdDays} days</span></span>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--steel)", marginBottom: 4 }}>Volume</div>
            {bigTag(v.mtdVsLastMonth)}
            <div className="mono" style={{ fontSize: 11.5, color: "var(--steel)", marginTop: 5 }}>{compact(v.mtd)} L vs {compact(v.mtdLastMonth)} L</div>
          </div>
          <div style={{ flex: 1, borderLeft: "1px solid var(--line)", paddingLeft: 20 }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--steel)", marginBottom: 4 }}>Revenue</div>
            {bigTag(r.mtdVsLastMonth)}
            <div className="mono" style={{ fontSize: 11.5, color: "var(--steel)", marginTop: 5 }}>${compact(r.mtd)} vs ${compact(r.mtdLastMonth)}</div>
          </div>
        </div>
      </div>
      {/* CONTEXT — single-day comparisons, explicitly flagged as noisy */}
      <div style={{ marginTop: 12 }}>
        {head("Latest day", "one day — noisy", v.day, r.day)}
        {cmpRow("vs the day before", v.vsDayBefore, r.vsDayBefore)}
        {cmpRow("vs same day last month", v.vsSameDayLastMonth, r.vsSameDayLastMonth)}
      </div>
    </Panel>
  );
}

/* Cost buildup per litre — base (ex-duty) + duties + distribution, with a stacked bar. */
function CostBreakdown({ parts, total }) {
  const segs = [
    { label: "Base (ex-duty)", v: parts.base, color: "#2B3990" },
    { label: "Duties", v: parts.duties, color: "#C8A24B" },
    { label: "Distribution", v: parts.distribution, color: "#8FB8FF" },
  ];
  const sum = segs.reduce((a, s) => a + (s.v || 0), 0) || 1;
  return (
    <div style={{ marginTop: 9, padding: "11px 12px", background: "#F4F6FA", borderRadius: 10 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--steel)", marginBottom: 8 }}>Cost buildup / litre</div>
      <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", marginBottom: 9 }}>
        {segs.map((s, i) => <div key={i} style={{ width: (100 * (s.v || 0) / sum) + "%", background: s.color }} />)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {segs.map((s, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--ink)" }}><span style={{ width: 9, height: 9, borderRadius: 3, background: s.color }} />{s.label}</span>
            <span className="mono">${(s.v || 0).toFixed(3)}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 6, marginTop: 3, fontWeight: 700, fontSize: 12.5 }}>
          <span>Total cost / L</span><span className="mono">${Number(total).toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
}

/* Gross margin by product — Tiimo cards. Unit economics (sell − cost = margin/L) are
   shown on their own, kept visually separate from the gross litres/$ figures. Tapping
   Cost/L opens the cost buildup (landed + duties + distribution). */
function MarginPanel({ margin }) {
  const cpl = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "c");
  const dol = (v) => (v == null ? "—" : "$" + v.toFixed(3));
  const rows = (margin.byProduct || []).filter((p) => p.litres > 0);
  return (
    <Panel style={{ marginBottom: 12 }}>
      <div className="lbl" style={{ marginBottom: 10 }}>Gross margin by product <span style={{ color: "var(--steel)", fontWeight: 400 }}>· retail</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((p) => {
          const neg = p.cpl != null && p.cpl < 0;
          return (
            <div key={p.product} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: "13px 14px", background: "#FBFCFE" }}>
              {/* headline: product + margin per litre */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 11 }}>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontWeight: 700, fontSize: 16, letterSpacing: ".03em", color: "var(--navy)" }}>{p.product}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5, background: neg ? "#FDECEA" : "#EEF7E9", borderRadius: 999, padding: "4px 12px" }}>
                  <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: neg ? "var(--red)" : "#3E7D22" }}>{cpl(p.cpl)}</span>
                  <span style={{ fontSize: 10.5, color: "var(--steel)" }}>/L margin</span>
                </div>
              </div>
              {/* unit economics: sell and cost per litre */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <UnitCell label="Sell / L" value={dol(p.price)} />
                <UnitCell label="Cost / L" value={dol(p.cost)} />
              </div>
              {/* cost buildup shown on the face — base + duties + distribution */}
              {p.costParts && <CostBreakdown parts={p.costParts} total={p.cost} />}
              {/* gross figures — deliberately separated from the per-unit block */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 11, paddingTop: 9, borderTop: "1px dashed var(--line)" }}>
                <span className="mono" style={{ fontSize: 12.5, color: "var(--steel)" }}>{compact(p.litres)} L sold</span>
                <span className="mono" style={{ fontSize: 13.5 }}><b style={{ color: "var(--navy)" }}>{p.gm != null ? money0(p.gm) : "—"}</b> <span style={{ color: "var(--steel)" }}>gross</span></span>
              </div>
            </div>
          );
        })}
      </div>
      {/* total */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, padding: "12px 14px", background: "var(--navy)", borderRadius: 14, color: "#fff" }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", fontSize: 12.5, letterSpacing: ".05em", opacity: .9 }}>Total gross margin</div>
          <div className="mono" style={{ fontSize: 11, opacity: .72, marginTop: 2 }}>{cpl(margin.cpl)}/L blended · incl. Petrotrade commission</div>
        </div>
        <div className="mono" style={{ fontSize: 23, fontWeight: 700, letterSpacing: "-.01em" }}>{money0(margin.total)}</div>
      </div>
      <div style={{ fontSize: 11, color: "var(--steel)", marginTop: 8, lineHeight: 1.5 }}>
        Reported months use the audited P&amp;L figures; the current month is a live estimate (invoiced price − landed cost incl. ~11c distribution). Petrotrade coupons earn commission at zero fuel cost. Excludes bulk/corporate.
      </div>
    </Panel>
  );
}

/* Relative time, compact. */
function relTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return `${d}d ago`;
}
/* "Data as of · Refresh" strip. Shows LIVE (green) with how long ago the screen
   last pulled, or OFFLINE (amber) with the cached-copy age, and a Refresh button.
   `data` is the screen's loaded object — call() tags it __offline/__cachedAt when
   it had to serve the on-device cache, so the user always knows what they're seeing. */
function RefreshBar({ data, onRefresh, busy }) {
  const [now, setNow] = useState(() => Date.now());
  const seenRef = useRef(Date.now());
  useEffect(() => { if (data) seenRef.current = Date.now(); }, [data]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20000); return () => clearInterval(t); }, []);
  const offline = !!(data && data.__offline);
  const at = offline ? (data.__cachedAt || seenRef.current) : seenRef.current;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "0 2px 10px" }}>
      <span className="mono" style={{ fontSize: 11, color: offline ? "var(--amber)" : "var(--steel)", display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: offline ? "var(--amber)" : "var(--ok)", flexShrink: 0 }} />
        {!data ? "Loading…" : offline ? `Offline — cached ${relTime(now - at)}` : `Live · updated ${relTime(now - at)}`}
      </span>
      <button type="button" onClick={onRefresh} disabled={busy} className="pill-ghost"
        style={{ padding: "5px 13px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, opacity: busy ? 0.6 : 1 }}>
        <span style={{ display: "inline-block", animation: busy ? "spin 0.7s linear infinite" : "none", fontSize: 14 }}>⟳</span>{busy ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

/* Overdue-trips drill — each trip shows what the delivery feed has matched to it
   (coverage %) and a manual "Mark delivered / close" for the ones auto-match can't
   reach (split loads, aborted, hand-reconciled). Trips ≥90% covered already
   auto-closed server-side and never reach here. */
function OpenTripsPanel({ rows, onReload }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const doClose = async (tripNo) => {
    setBusy(tripNo); setMsg(null);
    try { await closeTrip(tripNo); setMsg({ tone: "ok", text: `${tripNo} closed off.` }); onReload && onReload(); }
    catch (e) { setMsg({ tone: "red", text: e.message }); }
    finally { setBusy(null); }
  };
  if (!rows.length) return <div style={{ color: "var(--steel)", fontSize: 13 }}>No overdue trips — all delivered or closed.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {msg && <Note tone={msg.tone} title={msg.tone === "ok" ? "Done" : "Couldn't close"}>{msg.text}</Note>}
      {rows.map((t) => (
        <div key={t.tripNo} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", borderLeft: `4px solid ${t.daysOpen >= 2 ? "var(--red)" : "var(--amber)"}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div><b style={{ color: "var(--navy)" }}>{t.tripNo}</b> <span style={{ color: "var(--steel)", fontSize: 12 }}>{t.truck || "—"} · {t.driver || "—"}</span></div>
            <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: t.daysOpen >= 2 ? "var(--red)" : "var(--amber)", whiteSpace: "nowrap" }}>{t.daysOpen}d open</span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 3 }}>
            {L(t.qty)} L · {(t.drops || []).join(", ") || "no drops"} · <b style={{ color: t.coveragePct > 0 ? "var(--navy)" : "var(--steel)" }}>{t.coveragePct}% delivered</b> per feed
          </div>
          <button className="pill-ghost" disabled={busy === t.tripNo} style={{ padding: "6px 12px", marginTop: 8, fontSize: 12 }} onClick={() => doClose(t.tripNo)}>
            {busy === t.tripNo ? "Closing…" : "Mark delivered / close"}
          </button>
        </div>
      ))}
    </div>
  );
}
const Stat = ({ label, value, unit, sub, tone, onClick }) => {
  const col = { red: "var(--red)", amber: "var(--amber)", ok: "var(--ok)" }[tone] || "var(--navy)";
  return (
    <div className="card" onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
      style={{ padding: "13px 15px", cursor: onClick ? "pointer" : undefined, position: "relative" }}>
      <div className="lbl" style={{ marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 600, color: col, lineHeight: 1 }}>{value}{unit && <span style={{ fontSize: 12, color: "var(--steel)", marginLeft: 3 }}>{unit}</span>}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--steel)", marginTop: 4 }}>{sub}</div>}
      {onClick && <span aria-hidden style={{ position: "absolute", top: 10, right: 12, color: "var(--steel)", fontSize: 15, opacity: .5 }}>›</span>}
    </div>
  );
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtD = (v) => { if (!v) return ""; const [y, m, dd] = String(v).slice(0, 10).split("-"); return dd && m ? `${+dd} ${MONTHS[+m - 1]}` : String(v); };
// ranked table (top / bottom sites): Site | Litres | Revenue
const RankTable = ({ rows, tone }) => (
  <div style={{ overflowX: "auto" }}>
    <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Site</Th><Th right>Litres</Th><Th right>Revenue</Th></tr></thead>
      <tbody>{(rows || []).map((s) => (
        <tr key={s.site} style={{ borderTop: "1px solid var(--line)" }}>
          <Td>{s.site}</Td>
          <Td right style={{ fontWeight: 700, color: tone || "var(--navy)" }}>{L(s.litres)}</Td>
          <Td right style={{ color: "var(--steel)" }}>{s.cash != null ? "$" + compact(s.cash) : "—"}</Td>
        </tr>
      ))}</tbody>
    </table>
  </div>
);
const EXEC_SEV = { critical: "var(--red)", major: "var(--red)", high: "var(--amber)", medium: "var(--amber)", low: "var(--steel)" };
// horizontal stacked bar — fuel on hand split by location
function StockBar({ parts, total, fmt }) {
  const t = total || parts.reduce((a, p) => a + Math.max(0, p[1]), 0) || 1;
  const f = fmt || ((v) => compact(v) + "L");   // default: litres; pass fmt for money etc.
  return (
    <>
      <div style={{ display: "flex", height: 14, borderRadius: 100, overflow: "hidden", background: "#EEF1F6" }}>
        {parts.map(([lab, v, c]) => v > 0 && <div key={lab} title={`${lab}: ${f(v)}`} style={{ width: `${(Math.max(0, v) / t) * 100}%`, background: c }} />)}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
        {parts.map(([lab, v, c]) => (
          <div key={lab} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />
            <span className="mono" style={{ fontSize: 12, color: "var(--ink)" }}>{lab} <b>{f(v)}</b></span>
          </div>
        ))}
      </div>
    </>
  );
}

/* Reusable drill-down sheet — a summary card/row opens this to show the full
   detail behind the number. Portal to body with className="da" so CSS vars and
   box-sizing apply. Tap the backdrop or "Done" to close. */
export function DetailSheet({ title, sub, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="da" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,18,35,.55)", zIndex: 250, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "pkfade .15s ease", boxSizing: "border-box" }}>
      <style>{`@keyframes pkfade{from{opacity:0}to{opacity:1}}@keyframes pkrise{from{transform:translateY(100%)}to{transform:none}}`}</style>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "#F4F6FA", width: "100%", maxWidth: 560, minWidth: 0, maxHeight: "90vh", borderRadius: "20px 20px 0 0",
          display: "flex", flexDirection: "column", boxShadow: "0 -8px 40px rgba(0,0,0,.3)", animation: "pkrise .22s cubic-bezier(.2,.9,.3,1)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div style={{ padding: "10px 16px 10px", borderBottom: "1px solid var(--line)", background: "#fff", borderRadius: "20px 20px 0 0" }}>
          <div style={{ width: 38, height: 4, borderRadius: 100, background: "var(--line)", margin: "0 auto 10px" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div className="disp" style={{ fontSize: 17, fontWeight: 700, color: "var(--navy)" }}>{title}</div>
              {sub && <div className="mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 2 }}>{sub}</div>}
            </div>
            <button type="button" onClick={onClose} style={{ flexShrink: 0, border: "1.5px solid var(--line)", background: "#fff", borderRadius: 10, padding: "7px 15px", fontWeight: 700, fontSize: 13, color: "var(--navy)", cursor: "pointer" }}>Done</button>
          </div>
        </div>
        <div style={{ overflowY: "auto", overflowX: "hidden", padding: "12px 14px 20px" }}>{children}</div>
      </div>
    </div>, document.body);
}

// Full detail for a workshop/open case (shared by exec tab and fleet status).
function workshopCaseDetail(c) {
  return () => (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <Stat label="Days open" value={c.days ?? "—"} unit="d" tone={c.days >= 7 ? "red" : undefined} />
        <Stat label="Severity" value={c.severity ? String(c.severity).toUpperCase() : "—"} tone={c.days >= 7 ? "red" : "amber"} />
      </div>
      <Panel style={{ marginBottom: 12 }}>
        <div className="lbl" style={{ marginBottom: 4 }}>Fault</div>
        <div style={{ fontSize: 14, color: "var(--ink)" }}>{c.description || c.title || "No description recorded."}</div>
      </Panel>
      {(c.category || c.ref) && (
        <div className="mono" style={{ fontSize: 12, color: "var(--steel)" }}>{c.ref ? `Case ${c.ref}` : ""}{c.category ? ` · ${c.category}` : ""}</div>
      )}
      {Array.isArray(c.entries) && c.entries.length > 0 && (
        <Panel style={{ marginTop: 12 }}>
          <div className="lbl" style={{ marginBottom: 6 }}>History</div>
          {c.entries.map((e, i) => (
            <div key={i} style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ fontSize: 13 }}>{e.note}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 2 }}>{e.type || "update"}{e.by ? " · " + e.by : ""}{e.at ? " · " + fmtD(e.at) : ""}</div>
            </div>
          ))}
        </Panel>
      )}
    </>
  );
}

// A card that signals it drills down (chevron) and is keyboard/tap accessible.
function DrillCard({ onClick, children, style }) {
  return (
    <div role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      style={{ cursor: "pointer", position: "relative", ...style }}>
      {children}
      <span aria-hidden style={{ position: "absolute", top: 10, right: 12, color: "var(--steel)", fontSize: 15, opacity: .5 }}>›</span>
    </div>
  );
}

// Full per-site sales listing for a drill sheet. `cols` = [[label, key, fmt?]…];
// rows are sorted by `sortKey` desc, a Total row is appended, and sites with no
// value in any listed column are hidden. Reused for blend/diesel/ulp/total/revenue.
function siteSalesDrill(sites, cols, sortKey) {
  return () => {
    const rows = [...(sites || [])]
      .filter((r) => cols.some(([, k]) => (r[k] || 0) > 0))
      .sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
    if (!rows.length) return <div style={{ color: "var(--steel)", fontSize: 13 }}>No sales in this period.</div>;
    const totals = {}; for (const [, k] of cols) totals[k] = rows.reduce((s, r) => s + (r[k] || 0), 0);
    return (
      <div style={{ overflowX: "auto" }}>
        <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "var(--navy)", color: "#fff" }}>
            <Th>Site</Th>{cols.map(([lab]) => <Th key={lab} right>{lab}</Th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.site} style={{ borderTop: "1px solid var(--line)" }}>
                <Td>{r.site}</Td>
                {cols.map(([lab, k, fmt]) => <Td key={lab} right>{fmt ? fmt(r[k] || 0) : L(r[k] || 0)}</Td>)}
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid var(--navy)", background: "#F4F6FA" }}>
              <Td style={{ fontWeight: 700 }}>Total ({rows.length} sites)</Td>
              {cols.map(([lab, k, fmt]) => <Td key={lab} right style={{ fontWeight: 700 }}>{fmt ? fmt(totals[k]) : L(totals[k])}</Td>)}
            </tr>
          </tbody>
        </table>
      </div>
    );
  };
}
const money0 = (v) => "$" + L(Math.round(v || 0));

// Deliveries + transit/discharge loss, split by product (Diesel / Blend / ULP).
// Used both inline (supply tab panel) and inside a drill sheet. Loss over 0.3%
// (the delivery bot's excessive-loss line) is flagged red.
// Per-truck efficiency for one driver — the drill behind the Drivers table.
function driverTruckTable(dr) {
  const trucks = (dr && dr.trucks) || [];
  if (!trucks.length) return <div style={{ color: "var(--steel)", fontSize: 13 }}>No per-truck legs for this driver.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Truck</Th><Th right>km/L</Th><Th right>90-day km</Th><Th right>Fills</Th></tr></thead>
        <tbody>
          {trucks.map((t) => (
            <tr key={t.vehicle} style={{ borderTop: "1px solid var(--line)" }}>
              <Td style={{ fontWeight: 600 }}>{t.vehicle}</Td>
              <Td right style={{ fontWeight: 700, color: t.kmpl < dr.kmpl ? "var(--red)" : "var(--ok)" }}>{t.kmpl}</Td>
              <Td right style={{ color: "var(--steel)" }}>{L(t.km)}</Td>
              <Td right style={{ color: "var(--steel)" }}>{t.fills}</Td>
            </tr>
          ))}
          <tr style={{ borderTop: "2px solid var(--navy)", background: "#F4F6FA" }}>
            <Td style={{ fontWeight: 700 }}>Driver overall</Td>
            <Td right style={{ fontWeight: 700 }}>{dr.kmpl}</Td>
            <Td right style={{ fontWeight: 700 }}>{L(dr.km)}</Td>
            <Td right style={{ fontWeight: 700 }}>{dr.fills}</Td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function deliveriesProductTable(rows) {
  const list = rows || [];
  if (!list.length) return <div style={{ color: "var(--steel)", fontSize: 13 }}>No deliveries in this period.</div>;
  const tot = list.reduce((a, p) => ({ loaded: a.loaded + p.loaded, received: a.received + p.received, loss: a.loss + p.loss, loads: a.loads + (p.loads || 0) }), { loaded: 0, received: 0, loss: 0, loads: 0 });
  const totPct = tot.loaded > 0 ? +((tot.loss / tot.loaded) * 100).toFixed(2) : null;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr style={{ background: "var(--navy)", color: "#fff" }}>
          <Th>Product</Th><Th right>Loads</Th><Th right>Loaded</Th><Th right>Received</Th><Th right>Loss</Th><Th right>%</Th>
        </tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.product} style={{ borderTop: "1px solid var(--line)" }}>
              <Td>{p.product}</Td>
              <Td right>{p.loads}</Td>
              <Td right>{L(p.loaded)}</Td>
              <Td right>{L(p.received)}</Td>
              <Td right style={{ color: p.lossPct != null && p.lossPct > 0.3 ? "var(--red)" : "var(--ink)" }}>{L(p.loss)}</Td>
              <Td right style={{ color: p.lossPct != null && p.lossPct > 0.3 ? "var(--red)" : "var(--steel)" }}>{p.lossPct != null ? p.lossPct + "%" : "—"}</Td>
            </tr>
          ))}
          <tr style={{ borderTop: "2px solid var(--navy)", background: "#F4F6FA" }}>
            <Td style={{ fontWeight: 700 }}>Total</Td>
            <Td right style={{ fontWeight: 700 }}>{tot.loads}</Td>
            <Td right style={{ fontWeight: 700 }}>{L(tot.loaded)}</Td>
            <Td right style={{ fontWeight: 700 }}>{L(tot.received)}</Td>
            <Td right style={{ fontWeight: 700, color: totPct != null && totPct > 0.3 ? "var(--red)" : "var(--ink)" }}>{L(tot.loss)}</Td>
            <Td right style={{ fontWeight: 700, color: totPct != null && totPct > 0.3 ? "var(--red)" : "var(--steel)" }}>{totPct != null ? totPct + "%" : "—"}</Td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Per-warehouse stock broken down by product, for an inventory drill sheet.
function warehouseStockDrill(warehouses) {
  return () => {
    const rows = warehouses || [];
    if (!rows.length) return <div style={{ color: "var(--steel)", fontSize: 13 }}>No warehouse data yet.</div>;
    const prods = ["Diesel", "Blend", "ULP"];
    const tot = {}; prods.forEach((p) => tot[p] = rows.reduce((s, w) => s + ((w.products && w.products[p]) || 0), 0));
    const totAll = rows.reduce((s, w) => s + (w.stock || 0), 0);
    return (
      <div style={{ overflowX: "auto" }}>
        <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "var(--navy)", color: "#fff" }}>
            <Th>Warehouse</Th>{prods.map((p) => <Th key={p} right>{p}</Th>)}<Th right>Total</Th>
          </tr></thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.name} style={{ borderTop: "1px solid var(--line)" }}>
                <Td>{w.name}</Td>
                {prods.map((p) => <Td key={p} right>{L((w.products && w.products[p]) || 0)}</Td>)}
                <Td right style={{ fontWeight: 700, color: w.stock < 0 ? "var(--red)" : undefined }}>{L(w.stock || 0)}</Td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid var(--navy)", background: "#F4F6FA" }}>
              <Td style={{ fontWeight: 700 }}>Total</Td>
              {prods.map((p) => <Td key={p} right style={{ fontWeight: 700 }}>{L(tot[p])}</Td>)}
              <Td right style={{ fontWeight: 700 }}>{L(totAll)}</Td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };
}

/* THE standard period model, shared across the app. Maps a period + optional
   custom range to every window shape a feed might need: executive takes
   period+range; haulage/wet-stock take a day-count; day-boards take an "as of"
   date. One selector, one meaning everywhere. */
export function periodWindow(period, range) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());   // date-only, no partial-day drift
  const yd = new Date(today); yd.setDate(yd.getDate() - 1);
  const todayISO = iso(today), ydISO = iso(yd);
  const daysBetween = (a, b) => Math.round((a - b) / 86400000) + 1;           // inclusive
  if (period === "today") return { period, days: 1, date: todayISO, retailDate: todayISO, from: todayISO, to: todayISO, label: `Today · ${fmtD(todayISO)}` };
  if (period === "month") { const first = new Date(now.getFullYear(), now.getMonth(), 1); const days = daysBetween(today, first); return { period, days, date: ydISO, retailDate: ydISO, from: iso(first), to: ydISO, label: `This month · ${days} day${days === 1 ? "" : "s"}` }; }
  if (period === "year") { const first = new Date(now.getFullYear(), 0, 1); const days = daysBetween(today, first); return { period, days, date: ydISO, retailDate: ydISO, from: iso(first), to: ydISO, label: `Year to date · ${days} days` }; }
  if (period === "range") { const days = Math.max(1, daysBetween(new Date(range.to), new Date(range.from))); return { period, days, date: range.to, retailDate: range.to, from: range.from, to: range.to, label: `${fmtD(range.from)} → ${fmtD(range.to)} · ${days} days` }; }
  return { period: "yesterday", days: 1, date: ydISO, retailDate: ydISO, from: ydISO, to: ydISO, label: `Yesterday · ${fmtD(ydISO)}` };   // default (reporting runs a day late)
}
const cockpitWindow = periodWindow;   // back-compat alias

/* The standard period selector — Yesterday · Today · Month · Year · Range —
   with the custom range inputs and an "over: <label>" line. Drop into any screen. */
export function PeriodBar({ period, range, onPeriod, onRange, showLabel = true }) {
  const win = periodWindow(period, range);
  return (
    <div style={{ margin: "0 2px 8px" }}>
      <Segmented options={[["today", "Today"], ["yesterday", "Yesterday"], ["month", "Month"], ["year", "Year"], ["range", "Range"]]} value={period} onChange={onPeriod} />
      {period === "range" && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: -8, marginBottom: 10, flexWrap: "wrap" }}>
          <input type="date" value={range.from} max={range.to} onChange={(e) => onRange((r) => ({ ...r, from: e.target.value }))} style={{ maxWidth: 150 }} />
          <span style={{ color: "var(--steel)" }}>→</span>
          <input type="date" value={range.to} onChange={(e) => onRange((r) => ({ ...r, to: e.target.value }))} style={{ maxWidth: 150 }} />
        </div>
      )}
      {showLabel && <div className="mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 3 }}>Showing: <b style={{ color: "var(--navy)" }}>{win.label}</b></div>}
    </div>
  );
}
const defaultRange = () => { const t = new Date(); t.setDate(t.getDate() - 1); const f = new Date(t); f.setDate(f.getDate() - 6); return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) }; };

/* ============================================================ *
 *  COCKPIT — role home. One "what needs attention today" action
 *  queue, auto-tailored: a card shows only if the user's role can
 *  open the screen it links to (so fleet sees fleet cards, logistics
 *  sees logistics cards, etc.). `tabs` = the tab keys the role has.
 * ============================================================ */
export function Cockpit({ me, go, tabs = [] }) {
  const [ex, setEx] = useState(null), [hl, setHl] = useState(null), [rt, setRt] = useState(null), [ws, setWs] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [drill, setDrill] = useState(null);
  const [period, setPeriod] = useState("yesterday");   // observations reflect this window; reporting runs a day late
  const [range, setRange] = useState(defaultRange);
  const [errs, setErrs] = useState({});                // which feeds failed → never fake an "all clear" on error
  const [reloadKey, setReloadKey] = useState(0);
  const [snoozes, setSnoozes] = useState({});          // cardId → { fingerprint, until } (parked cards)
  const win = cockpitWindow(period, range);
  // load this user's active snoozes (a card the user has actioned is parked until it
  // expires OR its contents change — see the fingerprint check below).
  useEffect(() => { getWatchSnoozes().then((r) => { const m = {}; for (const s of (r.snoozes || [])) m[s.cardId] = s; setSnoozes(m); }).catch(() => {}); }, [reloadKey]);
  // FNV-1a fingerprint of a card's primary-item set — changes when a new exception appears.
  const fpOf = (arr) => { const s = arr.join("|"); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const snoozeUntilTomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(5, 0, 0, 0); return d.toISOString(); };
  useEffect(() => {
    if (period === "range" && !(range.from && range.to)) return;
    const w = cockpitWindow(period, range);
    const [f, t] = period === "range" ? [range.from, range.to] : [null, null];
    setLoaded(false); setEx(null); setHl(null); setRt(null); setWs(null); setErrs({});
    let n = 4; const done = () => { if (--n === 0) setLoaded(true); };
    getExecutive(period, f, t).then(setEx).catch((e) => setErrs((p) => ({ ...p, "watchlist": e.message }))).finally(done);
    getHaulage(w.days).then(setHl).catch((e) => setErrs((p) => ({ ...p, deliveries: e.message }))).finally(done);
    getRetail(w.retailDate).then(setRt).catch((e) => setErrs((p) => ({ ...p, retail: e.message }))).finally(done);
    getWetstock(w.days).then(setWs).catch((e) => setErrs((p) => ({ ...p, losses: e.message }))).finally(done);
  }, [period, range.from, range.to, reloadKey]);
  const TONE = { red: "var(--red)", amber: "var(--amber)", ok: "var(--ok)" };
  const has = (t) => tabs.includes(t);
  // Every card's ROWS are ordered worst-first by their own magnitude, so the most
  // serious item in each list is at the top (losses by loss litres, dispatch by
  // least cover, trips by days open, …). Price actions keep the alphabetical order.
  const num = (x) => (typeof x === "number" && !isNaN(x) ? x : 0);
  const stockout = ex?.stockout || [];
  const dispatch = stockout.filter((s) => s.suggestLitres > 0).slice().sort((a, b) => (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9));   // least days-cover first
  const risks = stockout.filter((s) => s.level === "risk");
  const nonSub = (rt?.compliance || []).filter((c) => c.pct < 50).slice().sort((a, b) => num(a.pct) - num(b.pct));                     // worst compliance first
  const priceAct = ex?.prices?.actions || [];                                                                                          // alphabetical by site (deliberate)
  const openTrips = (hl?.openTrips || []).slice().sort((a, b) => num(b.daysOpen) - num(a.daysOpen));                                   // longest open first
  const highLossTrucks = (hl?.transporterLeague || []).filter((t) => t.highLoss).slice().sort((a, b) => num(b.loss) - num(a.loss));   // biggest loss litres first
  const flaggedDeliv = (hl?.deliveries || []).filter((d) => d.flagged).slice().sort((a, b) => num(b.combinedLoss) - num(a.combinedLoss)); // biggest loss first
  const negWh = (ex?.supply?.warehouses || []).filter((w) => w.hasNegativeProduct || w.stock < 0).slice().sort((a, b) => num(a.stock) - num(b.stock)); // any negative product bucket (even if the total nets positive)
  const laggards = (ex?.fleet?.vehicles || []).filter((v) => v.flag).slice().sort((a, b) => num(a.kmpl) - num(b.kmpl));               // lowest km/L first
  const fdExc = ex?.fleet?.exceptions || [];                                                                                           // already severity-sorted server-side
  const recurring = (ex?.workshop?.recurring || []).slice().sort((a, b) => num(b.cases) - num(a.cases));                              // most repeat visits first
  const inWorkshop = (ex?.workshop?.openCases || []).slice().sort((a, b) => num(b.days) - num(a.days));                               // longest in workshop first
  const wetCrit = (ws?.sites || []).filter((s) => s.status !== "ok").slice().sort((a, b) => num(b.totalLoss) - num(a.totalLoss));     // biggest total loss first

  // generic drill table: cols = [[label, key|fn, fmt?]]; fmt = L | "%" | "$" | "d" | fn
  const val = (r, c) => (typeof c[1] === "function" ? c[1](r) : r[c[1]]);
  const fmtCell = (v, f) => (f === L ? L(v || 0) : typeof f === "function" ? f(v) : f === "%" ? (v ?? "—") + "%" : f === "$" ? "$" + Number(v).toFixed(3) : f === "d" ? v + "d" : (v ?? "—"));
  const drillTable = (rows, cols) => () => (rows.length === 0 ? <div style={{ color: "var(--steel)", fontSize: 13 }}>Nothing here — all clear.</div> : (
    <div style={{ overflowX: "auto" }}>
      <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr style={{ background: "var(--navy)", color: "#fff" }}>{cols.map((c, j) => <Th key={j} right={j > 0}>{c[0]}</Th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>{cols.map((c, j) => <Td key={j} right={j > 0}>{fmtCell(val(r, c), c[2])}</Td>)}</tr>)}</tbody>
      </table>
    </div>
  ));

  // Price actions drill — each site/product shows EVERY competitor below us and its
  // delta, not just the cheapest one (a site can be undercut by many at once).
  const priceActionsDrill = (rows) => () => (rows.length === 0 ? <div style={{ color: "var(--steel)", fontSize: 13 }}>No price actions — we hold or beat the market everywhere.</div> : (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((a, i) => (
        <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", borderLeft: `4px solid ${a.type === "undercut" ? "var(--red)" : "var(--ok)"}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div><b style={{ color: "var(--navy)" }}>{a.site}</b> <span style={{ color: "var(--steel)", fontSize: 12 }}>{a.product}</span></div>
            <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: a.type === "undercut" ? "var(--red)" : "var(--ok)", whiteSpace: "nowrap" }}>
              {a.type === "undercut" ? `${a.undercutCount} below us` : "below market"}
            </div>
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 2 }}>Our price ${Number(a.da).toFixed(3)}</div>
          {a.type === "undercut" ? (
            <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8 }}>
              <thead><tr style={{ color: "var(--steel)", textAlign: "left" }}><th style={{ fontWeight: 600, padding: "2px 0" }}>Competitor</th><th style={{ fontWeight: 600, textAlign: "right" }}>Price</th><th style={{ fontWeight: 600, textAlign: "right" }}>Δ vs us</th></tr></thead>
              <tbody>{(a.undercutters || []).map((u, j) => (
                <tr key={j} style={{ borderTop: "1px solid var(--line)" }}>
                  <Td style={{ fontWeight: j === 0 ? 700 : 400, color: j === 0 ? "var(--red)" : undefined }}>{j === 0 ? "* " : ""}{u.station}</Td>
                  <Td right style={{ fontWeight: j === 0 ? 700 : 400, color: j === 0 ? "var(--red)" : undefined }}>${Number(u.price).toFixed(3)}</Td>
                  <Td right><span style={{ color: "var(--red)", fontWeight: 700 }}>−${Number(u.gap).toFixed(3)}</span></Td>
                </tr>
              ))}</tbody>
            </table>
          ) : (
            <div className="mono" style={{ fontSize: 12, marginTop: 6 }}><span style={{ color: "var(--ok)", fontWeight: 700 }}>${Number(a.gap).toFixed(3)}</span> under market avg ${Number(a.ref).toFixed(3)} — room to raise</div>
          )}
        </div>
      ))}
    </div>
  ));

  const defs = [
    { tab: "wetstock", title: "High-loss sites", tone: (ws?.critical || 0) ? "red" : wetCrit.length ? "amber" : "ok", rows: wetCrit, cols: [["Site", "site"], ["Delivery", "deliveryLoss", L], ["Site", "siteLoss", L], ["Total", "totalLoss", L], ["%", "lossPct", "%"]] },
    { tab: "retail", title: "Sites to dispatch", tone: risks.length ? "red" : dispatch.length ? "amber" : "ok", rows: dispatch, cols: [["Site", "site"], ["Product", "product"], ["Now", "stock", L], ["End of shift", "projectedEndShift", L], ["Cover", "daysCover", "d"]] },
    { tab: "retail", title: "Not reporting", tone: nonSub.some((c) => c.pct === 0) ? "red" : nonSub.length ? "amber" : "ok", rows: nonSub, cols: [["Site", "site"], ["Compliance", "pct", "%"], ["Sales", "salesDays"], ["Stock", "stockDays"]] },
    { tab: "retail", title: "Price actions", tone: priceAct.length ? "amber" : "ok", rows: priceAct,
      cols: [["Site", "site"], ["Product", "product"], ["Lowest rival", (a) => a.type === "underpriced" ? "we're below mkt" : `${a.competitor || "?"} $${Number(a.ref || 0).toFixed(3)}`], ["Cut", "gap", "$"]],
      subFn: (a) => a.type === "underpriced"
        ? `${a.site} ${a.product} — we're $${Number(a.gap).toFixed(3)} under market`
        : `${a.site} ${a.product} — ${a.competitor} $${Number(a.ref).toFixed(3)} vs our $${Number(a.da).toFixed(3)}`,
      render: priceActionsDrill(priceAct) },
    { tab: "logistics", title: "Open / overdue trips", tone: openTrips.some((t) => t.daysOpen >= 2) ? "red" : openTrips.length ? "amber" : "ok", rows: openTrips, cols: [["Trip", "tripNo"], ["Truck", "truck"], ["Route", (r) => (r.drops || []).join(", ")], ["Delivered", "coveragePct", "%"], ["Open", "daysOpen", "d"]], render: () => <OpenTripsPanel rows={openTrips} onReload={() => setReloadKey((k) => k + 1)} /> },
    { tab: "logistics", title: "High-loss trucks", tone: highLossTrucks.length ? "red" : "ok", rows: highLossTrucks, cols: [["Truck", "transporter"], ["Driver", (t) => t.driver || "—"], ["Loads", "loads"], ["Loss", "loss", L], ["%", "lossPct", "%"]] },
    { tab: "logistics", title: "Flagged deliveries", tone: flaggedDeliv.length ? "amber" : "ok", rows: flaggedDeliv, cols: [["DN", "id"], ["Truck", "truckName"], ["Loss", "combinedLoss", L], ["%", "lossPct", "%"]] },
    { tab: "inventory", title: "Negative warehouse stock", tone: negWh.length ? "red" : "ok", rows: negWh, cols: [["Warehouse", "name"], ["Diesel", (w) => w.products?.Diesel || 0, L], ["Blend", (w) => w.products?.Blend || 0, L], ["ULP", (w) => w.products?.ULP || 0, L]] },
    { tab: "fleet", title: "Efficiency laggards", tone: laggards.length ? "amber" : "ok", rows: laggards, cols: [["Truck", "vehicle"], ["km/L", "kmpl"], ["vs median", "vsMedian", "%"], ["90d km", "km", L]] },
    { tab: "fleet", title: "Fuel-draw exceptions", tone: fdExc.length ? "red" : "ok", rows: fdExc, cols: [["Vehicle", (e) => e.vehicle || e.driver], ["Flag", "kind"], ["Detail", (e) => (e.kind === "over-draw" ? "+" + L(e.overBy) + "L" : L(e.odoGap) + "km gap")], ["Date", (e) => fmtD(e.date)]] },
    { tab: "fleetstatus", title: "Trucks in workshop", tone: inWorkshop.length ? "amber" : "ok", rows: inWorkshop, cols: [["Vehicle", "vehicle"], ["Fault", (c) => c.fault || c.title || "—"], ["Days", "days", "d"]] },
    { tab: "fleetstatus", title: "Repeat workshop visits", tone: recurring.length ? "amber" : "ok", rows: recurring, cols: [["Vehicle", "vehicle"], ["Mostly", "top"], ["Visits", "cases"]] },
  ].map((c) => ({ ...c, id: c.tab + ":" + c.title, fp: fpOf(c.rows.map((r) => String(val(r, c.cols[0]))).sort()), n: c.rows.length, sub: c.rows.slice(0, 3).map(c.subFn || ((r) => c.cols.slice(0, 2).map((col) => fmtCell(val(r, col), col[2])).join(" · "))) }));
  // rank action items by SEVERITY: red first, then amber, then all-clear; within a
  // tone the fuller queue (more items) comes first. Stable for equal severity.
  const TONE_RANK = { red: 0, amber: 1, ok: 2 };
  const cards = defs.filter((c) => has(c.tab)).sort((a, b) => (TONE_RANK[a.tone] - TONE_RANK[b.tone]) || (b.n - a.n));
  // A card the user snoozed stays parked ONLY while its contents are unchanged — a new
  // exception (different fingerprint) breaks the snooze so it can't hide a fresh problem.
  const isSnoozed = (c) => { const s = snoozes[c.id]; return !!(s && s.fingerprint === c.fp && new Date(s.until) > new Date()); };
  const activeCards = cards.filter((c) => !isSnoozed(c) && c.n > 0);
  const clearCards = cards.filter((c) => !isSnoozed(c) && c.n === 0);
  const snoozedCards = cards.filter(isSnoozed);
  const doSnooze = async (c) => { const until = snoozeUntilTomorrow(); setSnoozes((p) => ({ ...p, [c.id]: { cardId: c.id, fingerprint: c.fp, until } })); try { await postWatchSnooze({ cardId: c.id, fingerprint: c.fp, until }); } catch { /* outbox */ } };
  const unSnooze = async (c) => { setSnoozes((p) => { const n = { ...p }; delete n[c.id]; return n; }); try { await postWatchSnooze({ cardId: c.id, fingerprint: c.fp, until: new Date(Date.now() - 1000).toISOString() }); } catch { /* ignore */ } };
  const hour = new Date().getHours();
  const greet = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  return (
    <Wrap>
      <SectionHead title={`Good ${greet}${me?.name ? ", " + me.name.split(" ")[0] : ""}`} sub="Watchlist — tap any card for the full list" />
      <PeriodBar period={period} range={range} onPeriod={setPeriod} onRange={setRange} showLabel={false} />
      <div className="mono" style={{ fontSize: 11, color: "var(--steel)", margin: "-4px 2px 8px" }}>Observations over: <b style={{ color: "var(--navy)" }}>{win.label}</b></div>
      <RefreshBar data={ex} busy={!loaded} onRefresh={() => setReloadKey((k) => k + 1)} />
      {!loaded && !ex && !Object.keys(errs).length && <Panel><div style={{ color: "var(--steel)" }}>Loading…</div></Panel>}
      {loaded && !ex && !hl && !rt && !ws && Object.keys(errs).length > 0 && (
        <Note tone="red" title="Couldn't load your watchlist">
          {Object.values(errs)[0]} <button className="pill-ghost" style={{ padding: "6px 12px", marginTop: 8 }} onClick={() => setReloadKey((k) => k + 1)}>Retry</button>
        </Note>
      )}
      {loaded && (ex || hl || rt || ws) && Object.keys(errs).length > 0 && (
        <Note tone="amber" title="Some data didn't load">The {Object.keys(errs).join(", ")} feed{Object.keys(errs).length === 1 ? "" : "s"} failed — cards below may be incomplete. <button className="pill-ghost" style={{ padding: "6px 12px", marginTop: 8 }} onClick={() => setReloadKey((k) => k + 1)}>Retry</button></Note>
      )}
      {loaded && !Object.keys(errs).length && cards.length === 0 && <Note tone="ok" title="Nothing needs your attention right now" />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12 }}>
        {[...activeCards, ...clearCards].map((c, i) => (
          <Panel key={c.id} onClick={() => setDrill({ title: c.title, sub: `${c.n} item${c.n === 1 ? "" : "s"}`, render: c.render || drillTable(c.rows, c.cols) })} style={{ borderLeft: `4px solid ${TONE[c.tone]}`, cursor: "pointer", position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div className="lbl" style={{ marginBottom: 0 }}>{c.title}</div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: TONE[c.tone] }}>{c.n}</div>
            </div>
            {c.sub.length ? c.sub.map((s, j) => <div key={j} className="mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</div>)
              : <div style={{ fontSize: 11, color: "var(--ok)", marginTop: 3 }}>All clear ✓</div>}
            {c.n > 0 && (
              <button className="pill-ghost" onClick={(e) => { e.stopPropagation(); doSnooze(c); }}
                style={{ position: "absolute", bottom: 6, right: 30, fontSize: 10.5, padding: "3px 8px", color: "var(--steel)" }}>Snooze</button>
            )}
            <span aria-hidden style={{ position: "absolute", bottom: 8, right: 12, color: "var(--steel)", fontSize: 14, opacity: .5 }}>›</span>
          </Panel>
        ))}
      </div>
      {snoozedCards.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="lbl" style={{ marginBottom: 6, color: "var(--steel)" }}>Snoozed — parked until tomorrow or a change</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {snoozedCards.map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px", opacity: 0.75 }}>
                <div onClick={() => setDrill({ title: c.title, sub: `${c.n} item${c.n === 1 ? "" : "s"}`, render: c.render || drillTable(c.rows, c.cols) })} style={{ cursor: "pointer", flex: 1, minWidth: 0 }}>
                  <span className="lbl" style={{ marginBottom: 0 }}>{c.title}</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--steel)", marginLeft: 8 }}>{c.n} item{c.n === 1 ? "" : "s"} · snoozed</span>
                </div>
                <button className="pill-ghost" onClick={() => unSnooze(c)} style={{ fontSize: 11, padding: "4px 10px", whiteSpace: "nowrap" }}>Reopen</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {drill && <DetailSheet title={drill.title} sub={drill.sub} onClose={() => setDrill(null)}>{drill.render()}</DetailSheet>}
    </Wrap>
  );
}

export function ExecutiveDashboard() {
  const [period, setPeriod] = useState("today");   // Overview defaults to Today (latest complete data day)
  const [range, setRange] = useState(() => { const t = new Date(); t.setDate(t.getDate() - 1); const f = new Date(t); f.setDate(f.getDate() - 6); return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) }; });
  const { tab, setTab, back, prev } = useNavStack("overview");
  const SECTIONS = [["overview", "Overview"], ["sales", "Sales"], ["prices", "Prices"], ["supply", "Inventory"], ["fleet", "Fleet"], ["workshop", "Workshop"]];
  // Drill-down that lands on the EXACT section: switch tab, then scroll that
  // section (by id) into view once it renders. Use goTo(tab, sectionId).
  const [focusSec, setFocusSec] = useState(null);
  // goTo(tab) scrolls to the top of that tab's content; goTo(tab, "sec-x") scrolls
  // to a specific section within it. Either way the drill lands ON the content.
  const goTo = (t, sec) => { setTab(t); setFocusSec(sec || "exec-top"); };
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [drill, setDrill] = useState(null);   // { title, sub, render } — drill-down sheet
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const [f, t] = period === "range" ? [range.from, range.to] : [null, null];
    if (period === "range" && !(f && t)) return;
    setD(null); setErr(null);
    getExecutive(period, f, t).then(setD).catch((e) => setErr(e.message));
  }, [period, range.from, range.to, reloadKey]);
  // after a goTo(), scroll the targeted section into view once it has rendered
  useEffect(() => {
    if (!focusSec) return;
    const id = focusSec;
    const timer = setTimeout(() => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); setFocusSec(null); }, 90);
    return () => clearTimeout(timer);
  }, [tab, focusSec, d]);
  const k = d?.kpis;
  const pLabel = { yesterday: "Yesterday", today: "Today", month: "This month", year: "This year", range: "Range" }[period];
  // noun used in comparative labels ("vs the same MONTH last year", "vs the previous MONTH")
  const cmpWord = { yesterday: "day", today: "day", month: "month", year: "period", range: "range" }[period] || "period";
  const asOfLabel = d?.asOf
    ? (period === "today" ? `${fmtD(d.asOf.date)} · ${d.asOf.shiftLabel}`
      : period === "yesterday" ? fmtD(d.asOf.date)
      : period === "range" ? `${fmtD(range.from)} → ${fmtD(range.to)}`
      : `to ${fmtD(d.asOf.date)}`)
    : "";

  return (
    <div className="wrap">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, margin: "2px 2px 12px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, color: "var(--navy)" }}>Executive summary</h2>
          {asOfLabel && <div className="mono" style={{ fontSize: 11, color: d?.asOf?.isPartial && period === "today" ? "var(--amber)" : "var(--steel)", marginTop: 3 }}>Showing {pLabel.toLowerCase()} · {asOfLabel}</div>}
        </div>
        <div style={{ minWidth: 240, flex: "0 1 340px" }}>
          <Segmented options={[["today", "Today"], ["yesterday", "Yesterday"], ["month", "Month"], ["year", "Year"], ["range", "Range"]]} value={period} onChange={setPeriod} />
          {period === "range" && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: -8, marginBottom: 12, flexWrap: "wrap" }}>
              <input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} style={{ maxWidth: 150 }} />
              <span style={{ color: "var(--steel)" }}>→</span>
              <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} style={{ maxWidth: 150 }} />
            </div>
          )}
        </div>
      </div>
      <RefreshBar data={d} busy={!d && !err} onRefresh={() => setReloadKey((k) => k + 1)} />
      {err && <Note tone="red" title="Could not load">{err}</Note>}
      {!d && !err && <Panel><div style={{ color: "var(--steel)" }}>Loading…</div></Panel>}
      {d && (
        <>
          <div id="exec-top" style={{ scrollMarginTop: 8 }}><Segmented value={tab} onChange={setTab} options={SECTIONS} /></div>
          <BackBar prev={prev} options={SECTIONS} onBack={back} />

          {/* ---------------- OVERVIEW — bird's-eye ---------------- */}
          {tab === "overview" && <>
            {period === "today" && d.asOf?.isPartial &&
              <Note tone="amber" title={`${d.asOf.shiftLabel}`}>Figures are for {fmtD(d.asOf.date)} so far. The remaining shift has not been submitted yet.{d.kpis?.deltas?.shiftAware ? " Comparisons are like-for-like — this day shift vs the previous day shift." : ""}</Note>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 12, marginBottom: 12 }}>
              <Hero label="FUEL SOLD" value={compact(k.salesLitres)} unit="L" sub={`${compact(k.dieselSales)}L diesel · ${compact(k.blendSales)}L blend${k.ulpSales ? " · " + compact(k.ulpSales) + "L ULP" : ""}`} delta={k.deltas?.sales} onClick={() => goTo("sales")} />
              <Hero label="REVENUE" value={"$" + compact(k.cash)} sub={k.revenueMix ? `fuel $${compact(k.revenueMix.pump.revenue)} + commission $${compact(k.revenueMix.coupon.commission)}` : null} accent="#6BC048" onClick={() => goTo("sales")} />
              {k.margin && <Hero label="GROSS MARGIN" value={"$" + compact(k.margin.total)} accent="#C8A24B" onClick={() => goTo("sales")} />}
              <Hero label="DELIVERED" value={compact(k.litresDelivered)} unit="L" sub={`${k.deliveries} loads${k.deliveryLoss ? " · " + compact(k.deliveryLoss) + "L loss" : ""}`} delta={k.deltas?.delivered}
                onClick={() => setDrill({ title: "Delivered & loss — by product", sub: `${compact(k.litresDelivered)} L in ${k.deliveries} loads`, render: () => deliveriesProductTable(d.supply.deliveriesByProduct) })} />
              <Hero label="SITE DAYS COVER" value={k.siteDaysCover ?? "—"} unit="days" sub={`${k.stockoutCount} at risk`} accent="#8FB8FF" onClick={() => goTo("supply", "sec-stockout")} />
            </div>
            {(k.deltas?.sales != null || k.deltas?.delivered != null) && (
              <div style={{ fontSize: 11, color: "var(--steel)", margin: "-4px 2px 12px" }}>
                ▲▼ badges compare with the {k.deltas?.shiftAware ? "previous day shift (like-for-like)" : `previous ${period === "today" || period === "yesterday" ? "day" : period}`}. Fuller comparison in the panel below.
              </div>
            )}
            {/* how we compare — day-before, same day last month, MTD vs last month */}
            {d.overviewCompare && <ComparisonPanel cmp={d.overviewCompare} />}
            {/* revenue by tender — cash, DA card, coupon commission (pure revenue) */}
            {k.tenderMix && <TenderMixPanel label="Revenue by tender" parts={[["Cash", k.tenderMix.cash, "#2B3990"], ["DA card", k.tenderMix.daCard, "#6BC048"], ["Petrotrade commission", k.tenderMix.commission, "#8FB8FF"]]} />}
            {/* sales channel — DA own-channel vs Petrotrade volume + growth */}
            {k.channelSplit && <ChannelSplitPanel ch={k.channelSplit} />}
            {/* full stock position, split by where it is */}
            <Panel style={{ marginBottom: 12 }} onClick={() => goTo("supply")}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <div className="lbl" style={{ marginBottom: 0 }}>Fuel on hand — where it is</div>
                <div style={{ textAlign: "right" }}>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--navy)" }}>{compact(k.stockTotal)} L</div>
                  {k.stockValue ? <div className="mono" style={{ fontSize: 11.5, color: "var(--steel)" }}>≈ ${compact(k.stockValue)} working capital</div> : null}
                </div>
              </div>
              <StockBar parts={[["Sites", k.stockSites, "#2B3990"], ["Warehouses", k.stockWarehouse, "#6BC048"], ["In transit", k.stockTransit, "#C07A00"]]} total={k.stockTotal} />
              <div style={{ fontSize: 11, color: "var(--steel)", marginTop: 8, textAlign: "right" }}>See full inventory ›</div>
            </Panel>
            {/* per-unit economics: sell / cost / margin per litre, per product */}
            {k.margin && <MarginPanel margin={k.margin} />}
            {/* price overview — our price vs market average & minimum */}
            {d.prices?.byProduct && (
              <Panel style={{ marginBottom: 12, padding: 0, overflow: "hidden" }} onClick={() => goTo("prices")}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px 8px" }}>
                  <div className="lbl" style={{ marginBottom: 0 }}>DA price vs market ›</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--steel)" }}>{d.prices.asOf ? `as of ${fmtD(d.prices.asOf)}` : ""}</div>
                </div>
                <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "var(--navy)", color: "#fff" }}>
                    <Th>Product</Th><Th right>DA</Th><Th right>Mkt avg</Th><Th right>Mkt min</Th></tr></thead>
                  <tbody>{["Blend", "Diesel"].map((p) => {
                    const x = d.prices.byProduct[p] || {};
                    const dearAvg = x.vsAvg != null && x.vsAvg > 0;   // above market avg = dearer
                    const dearMin = x.vsMin != null && x.vsMin > 0;
                    return (
                      <tr key={p} style={{ borderTop: "1px solid var(--line)" }}>
                        <Td>{p}</Td>
                        <Td right style={{ fontWeight: 700 }}>{x.da != null ? "$" + x.da.toFixed(3) : "—"}</Td>
                        <Td right style={{ color: dearAvg ? "var(--red)" : "var(--ok)" }}>{x.mktAvg != null ? "$" + x.mktAvg.toFixed(3) : "—"}{x.vsAvg != null ? <span style={{ fontSize: 11, color: "var(--steel)" }}> {x.vsAvg > 0 ? "+" : ""}{x.vsAvg.toFixed(3)}</span> : null}</Td>
                        <Td right style={{ color: dearMin ? "var(--amber)" : "var(--ok)" }}>{x.mktMin != null ? "$" + x.mktMin.toFixed(3) : "—"}</Td>
                      </tr>
                    );
                  })}</tbody>
                </table>
                <div style={{ fontSize: 11, color: "var(--steel)", padding: "6px 14px 10px" }}>Green = at/below market · red = above market average</div>
              </Panel>
            )}
            {/* quick alerts */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="card" style={{ padding: 14, borderLeft: `4px solid ${k.stockoutCount ? "var(--red)" : "var(--ok)"}`, cursor: "pointer" }} onClick={() => goTo("supply", "sec-stockout")}>
                <div className="mono" style={{ fontSize: 24, fontWeight: 600, color: k.stockoutCount ? "var(--red)" : "var(--ok)" }}>{k.stockoutCount}</div>
                <div className="lbl" style={{ marginBottom: 0 }}>Sites at stock-out risk →</div>
              </div>
              <div className="card" style={{ padding: 14, borderLeft: `4px solid ${d.workshop?.counts?.workshop ? "var(--amber)" : "var(--ok)"}`, cursor: "pointer" }} onClick={() => goTo("workshop")}>
                <div className="mono" style={{ fontSize: 24, fontWeight: 600, color: d.workshop?.counts?.workshop ? "var(--amber)" : "var(--ok)" }}>{d.workshop?.counts?.workshop ?? "—"}</div>
                <div className="lbl" style={{ marginBottom: 0 }}>Trucks in workshop →</div>
              </div>
            </div>
            {/* 30-day trend — kept at the very bottom */}
            {d.trend && d.trend.length > 1 && (
              <Panel style={{ marginTop: 12, marginBottom: 0 }}>
                <div className="lbl" style={{ marginBottom: 8 }}>Last 30 days</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11.5, color: "var(--steel)", marginBottom: 2 }}>
                  <span>Sales volume</span><span className="mono">{compact(d.trend[d.trend.length - 1].litres)} L latest</span>
                </div>
                <Sparkline points={d.trend} color="#2B3990" />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11.5, color: "var(--steel)", margin: "10px 0 2px" }}>
                  <span>Revenue</span><span className="mono">${compact(d.trend[d.trend.length - 1].revenue)} latest</span>
                </div>
                <Sparkline points={d.trend.map((t) => ({ litres: t.revenue }))} color="#6BC048" />
              </Panel>
            )}
          </>}

          {/* ---------------- SALES ---------------- */}
          {tab === "sales" && <>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <ExportBtn onClick={() => exportExecSales(d)} />
              {d.kpis?.margin && <button className="pill-ghost" onClick={() => exportExecMargin(d)} style={{ padding: "10px 16px", whiteSpace: "nowrap" }}>Export margin</button>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 14 }}>
              <Hero label="BLEND SOLD" value={compact(d.sales.blend)} unit="L"
                onClick={() => setDrill({ title: "Blend sold — by site", sub: `${compact(d.sales.blend)} L across the period`, render: siteSalesDrill(d.sales.sites, [["Blend (L)", "blend"]], "blend") })} />
              <Hero label="DIESEL SOLD" value={compact(d.sales.diesel)} unit="L" accent="#8FB8FF"
                onClick={() => setDrill({ title: "Diesel sold — by site", sub: `${compact(d.sales.diesel)} L across the period`, render: siteSalesDrill(d.sales.sites, [["Diesel (L)", "diesel"]], "diesel") })} />
              <Hero label="ULP SOLD" value={compact(d.sales.ulp)} unit="L" accent="#C07A00"
                onClick={() => setDrill({ title: "ULP sold — by site", sub: `${compact(d.sales.ulp)} L across the period · pump-metered`, render: siteSalesDrill(d.sales.sites, [["ULP (L)", "ulp"]], "ulp") })} />
              <Hero label="TOTAL VOLUME" value={compact(d.sales.totalVolume)} unit="L"
                onClick={() => setDrill({ title: "Total volume — by site", sub: `${compact(d.sales.totalVolume)} L · diesel + blend + ULP`, render: siteSalesDrill(d.sales.sites, [["Diesel", "diesel"], ["Blend", "blend"], ["ULP", "ulp"], ["Total", "litres"]], "litres") })} />
              <Hero label="REVENUE" value={"$" + compact(d.sales.cash)} sub={d.sales.revenueMix ? `pump $${compact(d.sales.revenueMix.pump.revenue)} + coupon $${compact(d.sales.revenueMix.coupon.commission)}` : "invoiced · Sage"} accent="#6BC048"
                onClick={() => setDrill({ title: "Revenue — by site", sub: `Invoiced (Sage) $${compact(d.sales.cash)}`, render: siteSalesDrill(d.sales.sites, [["Volume (L)", "litres"], ["Revenue", "cash", money0]], "cash") })} />
              {d.sales.margin && <Hero label="GROSS MARGIN" value={"$" + compact(d.sales.margin.total)} sub={`${(d.sales.margin.cpl * 100).toFixed(1)}c/L · invoiced − cost`} accent="#C8A24B" />}
            </div>
            {d.sales.margin && <MarginPanel margin={d.sales.margin} />}
            {d.sales.tenderMix && <TenderMixPanel label="Revenue by tender" parts={[["Cash", d.sales.tenderMix.cash, "#2B3990"], ["DA card", d.sales.tenderMix.daCard, "#6BC048"], ["Petrotrade commission", d.sales.tenderMix.commission, "#8FB8FF"]]} />}
            {d.sales.channelSplit && <ChannelSplitPanel ch={d.sales.channelSplit} />}
            {d.sales.revenueMix && <RevenueMixPanel mix={d.sales.revenueMix} />}
            {d.overviewCompare && <ComparisonPanel cmp={d.overviewCompare} />}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
              <Panel style={{ padding: 0, overflow: "hidden" }}>
                <div className="lbl" style={{ padding: "12px 14px 8px" }}>Top sites by volume</div>
                <RankTable rows={d.sales.top} tone="var(--ok)" />
              </Panel>
              <Panel style={{ padding: 0, overflow: "hidden" }}>
                <div className="lbl" style={{ padding: "12px 14px 8px" }}>Lowest-selling sites</div>
                <RankTable rows={d.sales.bottom} tone="var(--amber)" />
              </Panel>
            </div>
          </>}

          {/* ---------------- PRICES ---------------- */}
          {tab === "prices" && <ExecPrices prices={d.prices} onDrill={setDrill} />}

          {/* ---------------- FUEL INVENTORY (where the fuel is) ---------------- */}
          {tab === "supply" && <>
            <SectionHead title="Fuel inventory" sub="Where every litre is — depots, trucks, sites" />
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}><ExportBtn onClick={() => exportExecInventory(d)} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 14 }}>
              <Stat label="At sites" value={compact(d.supply.sites)} unit="L" sub={`${(d.supply.siteList || []).length} sites`}
                onClick={() => setDrill({ title: "At sites — stock by product", sub: `${compact(d.supply.sites)} L across ${(d.supply.siteList || []).length} sites`, render: siteSalesDrill(d.supply.siteList, [["Diesel", "diesel"], ["Blend", "blend"], ["Total", "total"]], "total") })} />
              <Stat label="In warehouses" value={compact(d.supply.warehouse)} unit="L" sub={`${(d.supply.warehouses || []).length} depots`}
                onClick={() => setDrill({ title: "In warehouses — stock by product", sub: `${compact(d.supply.warehouse)} L on hand`, render: warehouseStockDrill(d.supply.warehouses) })} />
              <Stat label="On trucks" value={compact(d.supply.transit)} unit="L" sub={`${(d.supply.trucks || []).length} trips`} />
              <Stat label="Total" value={compact(d.supply.total)} unit="L" />
            </div>
            <Panel style={{ marginBottom: 14, padding: 0, overflow: "hidden" }}>
              <div className="lbl" style={{ padding: "12px 14px 8px" }}>Warehouses</div>
              <div style={{ overflowX: "auto" }}>
                <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Warehouse</Th><Th right>Diesel</Th><Th right>Blend</Th><Th right>ULP</Th><Th right>Total</Th></tr></thead>
                  <tbody>{(d.supply.warehouses || []).map((w) => (
                    <Fragment key={w.name}>
                      <tr style={{ borderTop: "1px solid var(--line)" }}>
                        <Td style={{ fontWeight: 600, color: "var(--navy)" }}>{w.name}</Td>
                        <Td right>{L(w.products.Diesel)}</Td>
                        <Td right style={{ color: w.products.Blend < 0 ? "var(--red)" : undefined }}>{L(w.products.Blend)}</Td>
                        <Td right style={{ color: w.products.ULP < 0 ? "var(--red)" : undefined }}>{L(w.products.ULP)}</Td>
                        <Td right style={{ fontWeight: 700, color: w.stock < 0 ? "var(--red)" : "var(--navy)" }}>{L(w.stock)}</Td>
                      </tr>
                      {w.productAsOf && ["Diesel", "Blend", "ULP"].some((p) => w.productAsOf[p]) && (
                        <tr><td colSpan={5} style={{ fontSize: 10.5, padding: "0 11px 7px 14px" }}>
                          <span style={{ color: "var(--steel)" }}>counted: </span>
                          {["Diesel", "Blend", "ULP"].filter((p) => w.productAsOf[p]).map((p, i) => {
                            const stale = (new Date() - new Date(w.productAsOf[p])) > 45 * 864e5;
                            return <span key={p} style={{ color: stale ? "var(--red)" : "var(--steel)", fontWeight: stale ? 700 : 400 }}>{i > 0 ? "  ·  " : ""}{p} {fmtD(w.productAsOf[p])}{stale ? " ⚠ stale" : ""}</span>;
                          })}
                        </td></tr>
                      )}
                    </Fragment>
                  ))}</tbody>
                </table>
              </div>
            </Panel>
            {/* trucks — goods in transit */}
            <Panel style={{ marginBottom: 14, padding: 0, overflow: "hidden" }}>
              <div className="lbl" style={{ padding: "12px 14px 8px" }}>On trucks — goods in transit</div>
              {(d.supply.trucks || []).length === 0 ? <div style={{ color: "var(--steel)", fontSize: 13, padding: "0 14px 14px" }}>Nothing in transit.</div> : (
                <div style={{ overflowX: "auto" }}>
                  <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Truck</Th><Th>Trip</Th><Th>Product</Th><Th right>Litres</Th><Th>Route</Th></tr></thead>
                    <tbody>{d.supply.trucks.map((t) => (
                      <tr key={t.tripNo} style={{ borderTop: "1px solid var(--line)" }}>
                        <Td style={{ fontWeight: 600, color: "var(--navy)" }}>{t.truck}</Td>
                        <Td style={{ color: "var(--steel)" }}>{t.tripNo}</Td>
                        <Td>{t.product}</Td>
                        <Td right style={{ fontWeight: 700 }}>{L(t.litres)}</Td>
                        <Td style={{ color: "var(--steel)" }}>{t.from} → {(t.to || []).join(", ")}</Td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </Panel>
            {/* deliveries + loss, split by product */}
            <Panel style={{ marginBottom: 14, padding: 0, overflow: "hidden" }}>
              <div className="lbl" style={{ padding: "12px 14px 8px" }}>Delivered &amp; loss — by product</div>
              {deliveriesProductTable(d.supply.deliveriesByProduct)}
            </Panel>
            {(() => { const watchSites = new Set((d.stockout || []).filter((s) => s.level === "watch").map((s) => s.site)).size;
              const border = k.stockoutCount ? "var(--red)" : (d.stockout || []).length ? "var(--amber)" : "var(--ok)";
              const heading = k.stockoutCount ? `${k.stockoutCount} ${k.stockoutCount === 1 ? "site" : "sites"} at stock-out risk`
                : watchSites ? `${watchSites} ${watchSites === 1 ? "site" : "sites"} low on cover — watch`
                : "All sites have healthy stock cover";
              return (
            <Panel id="sec-stockout" style={{ borderLeft: `4px solid ${border}`, scrollMarginTop: 12 }}>
              <div className="disp" style={{ fontWeight: 700, color: "var(--navy)", marginBottom: 2 }}>{heading}</div>
              <div style={{ fontSize: 11, color: "var(--steel)", marginBottom: 8 }}>At risk = under 1 day's cover (⚠), or under 5,000 L with under 2 days' cover — by product. Everything else is comfortably covered.</div>
              {(d.stockout || []).length === 0 ? <div style={{ fontSize: 12, color: "var(--steel)" }}>No product is at stock-out risk right now.</div> : (
                <div style={{ overflowX: "auto" }}>
                  <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Site</Th><Th>Product</Th><Th right>Cover</Th><Th right>Now</Th><Th right>End of shift</Th></tr></thead>
                    <tbody>{["Diesel", "Blend"].flatMap((prod) => (d.stockout || []).filter((s) => s.product === prod)).map((s) => {
                      const col = s.level === "risk" ? "var(--red)" : "var(--amber)";
                      return (
                        <tr key={s.site + s.product} style={{ borderTop: "1px solid var(--line)", background: s.level === "risk" ? "#FDECEA" : undefined }}>
                          <Td style={{ fontWeight: 600, color: "var(--navy)" }}>{s.level === "risk" ? "⚠ " : ""}{s.site}</Td>
                          <Td style={{ color: "var(--steel)" }}>{s.product}</Td>
                          <Td right style={{ fontWeight: 700, color: col }}>{s.daysCover}d</Td>
                          <Td right>{L(s.stock)}</Td>
                          <Td right style={{ color: "var(--steel)" }}>{s.projectedEndShift != null ? "~" + L(Math.max(0, s.projectedEndShift)) : "—"}</Td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              )}
            </Panel>
              ); })()}
          </>}

          {/* ---------------- FLEET ---------------- */}
          {tab === "fleet" && <>
            {d.fleet?.stale && <Note tone="amber" title="Card feed is a little behind">Distance and efficiency are the latest available — up to {fmtD(d.fleet.asOf)}. Newer card draws haven't posted yet.</Note>}
            {!d.fleet?.asOf && <Note tone="amber" title="No card-draw data">Distance and efficiency come from fuel-card odometer readings; none are recorded for this period.</Note>}
            {(d.fleet?.vehicles || []).length > 0 && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}><ExportBtn onClick={() => exportExecFleet(d)} /></div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 12, marginBottom: 12 }}>
              <Hero label="DISTANCE" value={compact(k.km)} unit="km" sub={d.fleet?.asOf ? `to ${fmtD(d.fleet.asOf)}` : "—"} accent="#8FB8FF" />
              <Hero label="FUEL EFFICIENCY" value={k.kmpl ?? "—"} unit="km/L" sub={d.fleet?.basis === "rolling-90d" ? "fleet avg · 90-day" : "fleet avg"} accent="#6BC048" />
              <Hero label="FUEL DRAWN" value={compact(d.fleet?.litres || 0)} unit="L" sub={`${d.fleet?.requests || 0} card draws`} />
            </div>
            {(d.fleet?.townKmpl != null || d.fleet?.roadKmpl != null) && (
              <div style={{ fontSize: 12, color: "var(--steel)", margin: "-2px 2px 12px", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "baseline" }}>
                <span>Town <b style={{ color: "var(--ink)" }}>{d.fleet.townKmpl ?? "—"}</b> km/L</span>
                <span>Road <b style={{ color: "var(--ink)" }}>{d.fleet.roadKmpl ?? "—"}</b> km/L</span>
                <span style={{ opacity: 0.7 }}>· split by leg distance (approx)</span>
              </div>
            )}
            {(d.fleet?.vehicles || []).length > 0 && (
              <Panel style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 14px 8px" }}>
                  <div className="lbl" style={{ marginBottom: 0 }}>Trucks by efficiency — worst first</div>
                  <div className="mono" style={{ fontSize: 11, color: d.fleet.laggards ? "var(--red)" : "var(--steel)" }}>{d.fleet.laggards} below par · median {d.fleet.median} km/L</div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Truck</Th><Th right>km/L</Th><Th right>vs median</Th><Th right>90-day km</Th></tr></thead>
                    <tbody>{d.fleet.vehicles.slice(0, 60).map((v) => (
                      <tr key={v.vehicle} style={{ borderTop: "1px solid var(--line)", background: v.flag ? "#FDECEA" : "#fff" }}>
                        <Td>{v.flag ? "⚠ " : ""}{v.vehicle}</Td>
                        <Td right style={{ fontWeight: 700, color: v.flag ? "var(--red)" : undefined }}>{v.kmpl}</Td>
                        <Td right style={{ color: v.vsMedian < 0 ? "var(--red)" : "var(--ok)" }}>{v.vsMedian > 0 ? "+" : ""}{v.vsMedian}%</Td>
                        <Td right style={{ color: "var(--steel)" }}>{L(v.km)}</Td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: "var(--steel)", padding: "6px 14px 10px" }}>By truck — a truck's odometer is continuous regardless of driver. Flagged = below {d.fleet.effFloor} km/L. Rolling 90-day.</div>
              </Panel>
            )}
            {(d.fleet?.drivers || []).length > 0 && (
              <Panel style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
                <div className="lbl" style={{ padding: "12px 14px 8px" }}>Drivers by efficiency — worst first · tap for per-truck</div>
                <div style={{ overflowX: "auto" }}>
                  <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Driver</Th><Th right>km/L</Th><Th right>vs median</Th><Th right>Trucks</Th></tr></thead>
                    <tbody>{d.fleet.drivers.slice(0, 60).map((dr) => (
                      <tr key={dr.driver} onClick={() => setDrill({ title: dr.driver, sub: `${dr.kmpl} km/L overall · ${dr.trucks.length} truck${dr.trucks.length === 1 ? "" : "s"}`, render: () => driverTruckTable(dr) })} style={{ borderTop: "1px solid var(--line)", background: dr.flag ? "#FDECEA" : "#fff", cursor: "pointer" }}>
                        <Td>{dr.flag ? "⚠ " : ""}{dr.driver}<span style={{ color: "var(--steel)" }}> ›</span></Td>
                        <Td right style={{ fontWeight: 700, color: dr.flag ? "var(--red)" : undefined }}>{dr.kmpl}</Td>
                        <Td right style={{ color: dr.vsMedian < 0 ? "var(--red)" : "var(--ok)" }}>{dr.vsMedian > 0 ? "+" : ""}{dr.vsMedian}%</Td>
                        <Td right style={{ color: "var(--steel)" }}>{dr.trucks.length}</Td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: "var(--steel)", padding: "6px 14px 10px" }}>Tap a driver to see how they perform on each truck they've driven.</div>
              </Panel>
            )}
            {(d.fleet?.exceptions || []).length > 0 && (
              <Panel style={{ marginBottom: 12, borderLeft: "4px solid var(--red)", padding: 0, overflow: "hidden" }}>
                <div className="lbl" style={{ padding: "12px 14px 8px", color: "var(--navy)" }}>Fuel-draw exceptions — {d.fleet.exceptionCount} to review</div>
                <div style={{ overflowX: "auto" }}>
                  <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Vehicle / driver</Th><Th>Flag</Th><Th right>Detail</Th><Th right>Date</Th></tr></thead>
                    <tbody>{d.fleet.exceptions.slice(0, 30).map((e, i) => (
                      <tr key={e.ref + i} style={{ borderTop: "1px solid var(--line)" }}>
                        <Td>{e.vehicle || e.driver}<div style={{ fontSize: 10, color: "var(--steel)" }}>{e.driver}</div></Td>
                        <Td><span style={{ color: e.kind === "over-draw" ? "var(--red)" : "var(--amber)" }}>{e.kind}</span></Td>
                        <Td right>{e.kind === "over-draw" ? `+${L(e.overBy)} L over` : `${L(e.odoGap)} km gap`}</Td>
                        <Td right style={{ color: "var(--steel)" }}>{fmtD(e.date)}</Td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: "var(--steel)", padding: "6px 14px 10px" }}>Odometer photo vs typed &gt;5 km apart, or litres drawn over what was approved.</div>
              </Panel>
            )}
            <Note tone="blue" title="How this is measured">Distance is the sum of odometer gaps between consecutive card draws per vehicle. Town legs run ~1.70 km/L and open-road ~2.52 km/L; a blended fleet figure is shown here.</Note>
          </>}

          {/* ---------------- WORKSHOP ---------------- */}
          {tab === "workshop" && <>
            {!d.workshop && <Note tone="amber" title="Workshop data unavailable" />}
            {d.workshop && <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12, marginBottom: 14 }}>
                <Stat label="Availability" value={d.workshop.availability != null ? d.workshop.availability + "%" : "—"} tone={d.workshop.availability != null && d.workshop.availability < 90 ? "amber" : "ok"} />
                <Stat label="In workshop" value={d.workshop.counts.workshop} unit={`/ ${d.workshop.counts.total}`} tone={d.workshop.counts.workshop ? "amber" : "ok"} />
                <Stat label="Avg downtime" value={d.workshop.meanDowntime != null ? d.workshop.meanDowntime : "—"} unit="days" />
                <Stat label="Repeat vehicles" value={(d.workshop.recurring || []).length} tone={(d.workshop.recurring || []).length ? "amber" : "ok"} />
              </div>
              {(d.workshop.recurring || []).length > 0 && (
                <Panel style={{ marginBottom: 14, padding: 0, overflow: "hidden" }}>
                  <div className="lbl" style={{ padding: "12px 14px 8px" }}>Recurring — vehicles back in the workshop repeatedly</div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Vehicle</Th><Th>Mostly</Th><Th right>Visits</Th></tr></thead>
                      <tbody>{d.workshop.recurring.slice(0, 10).map((r) => (
                        <tr key={r.vehicle} style={{ borderTop: "1px solid var(--line)" }}>
                          <Td style={{ fontWeight: 600, color: "var(--navy)" }}>{r.vehicle}</Td>
                          <Td style={{ color: "var(--steel)" }}>{r.top || "—"}</Td>
                          <Td right style={{ fontWeight: 700, color: r.cases >= 3 ? "var(--red)" : "var(--amber)" }}>{r.cases}</Td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </Panel>
              )}
              <Panel style={{ padding: 0, overflow: "hidden" }}>
                <div className="lbl" style={{ padding: "12px 14px 8px" }}>Open workshop cases</div>
                {d.workshop.openCases.length === 0 ? <div style={{ color: "var(--steel)", fontSize: 13, padding: "0 14px 14px" }}>No trucks currently in the workshop.</div> : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Vehicle</Th><Th>Fault</Th><Th>Severity</Th><Th right>Days</Th></tr></thead>
                      <tbody>{d.workshop.openCases.map((c) => (
                        <tr key={c.ref} onClick={() => setDrill({ title: c.vehicle, sub: `${c.ref || ""}${c.severity ? " · " + c.severity : ""}`, render: workshopCaseDetail(c) })}
                          style={{ borderTop: "1px solid var(--line)", cursor: "pointer" }}>
                          <Td style={{ fontWeight: 600, color: "var(--navy)" }}>{c.vehicle}</Td>
                          <Td style={{ color: "var(--steel)" }}>{c.description || c.title}</Td>
                          <Td style={{ fontWeight: 700, color: EXEC_SEV[String(c.severity).toLowerCase()] || "var(--steel)", textTransform: "uppercase", fontSize: 11 }}>{c.severity || "—"}</Td>
                          <Td right style={{ fontWeight: 700, color: c.days >= 7 ? "var(--red)" : "var(--navy)" }}>{c.days}d</Td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </>}
          </>}
        </>
      )}
      {drill && <DetailSheet title={drill.title} sub={drill.sub} onClose={() => setDrill(null)}>{drill.render()}</DetailSheet>}
    </div>
  );
}

/* Executive price detail — DA vs market by product, by region, and the full
   per-site breakdown (tap a site to see our price against each competitor). */
function ExecPrices({ prices, onDrill }) {
  const [q, setQ] = useState("");
  if (!prices || !prices.byProduct) return <Note tone="amber" title="No price data">No price surveys have been submitted for this period yet.</Note>;
  const money3 = (x) => (x != null ? "$" + Number(x).toFixed(3) : "—");
  const bySite = prices.bySite || [];
  const filtered = q ? bySite.filter((s) => s.site.toLowerCase().includes(q.toLowerCase()) || (s.region || "").toLowerCase().includes(q.toLowerCase())) : bySite;
  const mkt = s => s || {};
  const siteDetail = (s) => () => (
    <>
      <div className="mono" style={{ fontSize: 12, color: "var(--steel)", marginBottom: 10 }}>{s.region}</div>
      <Panel style={{ padding: 0, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ overflowX: "auto" }}>
        <table className="mono" style={{ width: "100%", minWidth: 340, borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Station</Th><Th right>Blend</Th><Th right>Diesel</Th></tr></thead>
          <tbody>
            <tr style={{ background: "#EEF2FF" }}>
              <Td style={{ fontWeight: 700, color: "var(--blue)" }}>DA (us)</Td>
              <Td right style={{ fontWeight: 700 }}>{money3(s.da.blend)}</Td>
              <Td right style={{ fontWeight: 700 }}>{money3(s.da.diesel)}</Td>
            </tr>
            {(s.competitors || []).map((c) => (
              <tr key={c.station} style={{ borderTop: "1px solid var(--line)" }}>
                <Td>{c.station}</Td>
                <Td right style={{ color: c.blend != null && s.da.blend != null ? (s.da.blend <= c.blend ? "var(--ok)" : "var(--red)") : "var(--ink)" }}>{money3(c.blend)}</Td>
                <Td right style={{ color: c.diesel != null && s.da.diesel != null ? (s.da.diesel <= c.diesel ? "var(--ok)" : "var(--red)") : "var(--ink)" }}>{money3(c.diesel)}</Td>
              </tr>
            ))}
            {/* market min / avg / max across the competitors surveyed here */}
            {[["Market min", "min"], ["Market avg", "avg"], ["Market max", "max"]].map(([lbl, k]) => (
              <tr key={k} style={{ borderTop: k === "min" ? "2px solid var(--navy)" : "1px solid var(--line)", background: "#F7F9FC" }}>
                <Td style={{ fontWeight: 600, color: "var(--steel)" }}>{lbl}</Td>
                <Td right style={{ fontWeight: 600 }}>{money3(mkt(s.market?.blend)[k])}</Td>
                <Td right style={{ fontWeight: 600 }}>{money3(mkt(s.market?.diesel)[k])}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Panel>
      <div style={{ fontSize: 11, color: "var(--steel)" }}>Green = a competitor we match or beat · red = they undercut us · market rows span the {(s.competitors || []).length} competitor{(s.competitors || []).length === 1 ? "" : "s"} surveyed here.</div>
    </>
  );
  return (
    <>
      <SectionHead title="Pricing" sub={prices.asOf ? `Latest survey — ${fmtD(prices.asOf)}` : "Latest price surveys"} />
      {/* price actions — where a competitor undercuts us, or we're below market */}
      {(prices.actions || []).length > 0 && (
        <Panel style={{ marginBottom: 12, padding: 0, overflow: "hidden", borderLeft: "4px solid var(--amber)" }}>
          <div className="lbl" style={{ padding: "12px 14px 8px" }}>Price actions — {prices.actions.length} to review</div>
          <div className="mono" style={{ fontSize: 12 }}>{prices.actions.map((a, i) => (
            <div key={a.site + a.product + i} style={{ borderTop: "1px solid var(--line)", padding: "9px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontWeight: 600, color: "var(--navy)" }}>{a.site} <span style={{ color: "var(--steel)", fontWeight: 400 }}>{a.product}</span></span>
                <span style={{ fontWeight: 700, whiteSpace: "nowrap", color: a.type === "undercut" ? "var(--red)" : "var(--ok)" }}>{a.type === "undercut" ? "−" : "+"}${a.gap.toFixed(3)}</span>
              </div>
              <div style={{ color: "var(--steel)", marginTop: 3 }}>
                Ours ${Number(a.da).toFixed(3)}{a.type === "undercut"
                  ? <> · {a.undercutCount} below: {(a.undercutters || []).map((u, j) => (
                      <span key={j} style={{ color: j === 0 ? "var(--red)" : "var(--steel)", fontWeight: j === 0 ? 700 : 400 }}>{j > 0 ? " · " : ""}{j === 0 ? "* " : ""}{u.station} ${Number(u.price).toFixed(3)}</span>
                    ))}</>
                  : <> · ${Number(a.gap).toFixed(3)} under market avg ${Number(a.ref).toFixed(3)} — room to raise</>}
              </div>
            </div>
          ))}</div>
          <div style={{ fontSize: 12, color: "var(--steel)", padding: "8px 14px 12px", borderTop: "1px solid var(--line)" }}>The <b style={{ color: "var(--red)" }}>cheapest rival</b> is marked <b>*</b> in red. Gap = how far it sits below our price.</div>
        </Panel>
      )}
      {/* DA vs market by product */}
      <Panel style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
        <div className="lbl" style={{ margin: 0, padding: "12px 14px 8px" }}>DA price vs market</div>
        <div style={{ overflowX: "auto" }}>
        <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Product</Th><Th right>DA</Th><Th right>Mkt avg</Th><Th right>Mkt min</Th><Th right>vs avg</Th></tr></thead>
          <tbody>{["Blend", "Diesel"].map((p) => {
            const x = prices.byProduct[p] || {};
            const dear = x.vsAvg != null && x.vsAvg > 0;
            return (
              <tr key={p} style={{ borderTop: "1px solid var(--line)" }}>
                <Td>{p}</Td>
                <Td right style={{ fontWeight: 700 }}>{money3(x.da)}</Td>
                <Td right>{money3(x.mktAvg)}</Td>
                <Td right>{money3(x.mktMin)}</Td>
                <Td right style={{ fontWeight: 700, color: x.vsAvg == null ? "var(--steel)" : dear ? "var(--red)" : "var(--ok)" }}>{x.vsAvg == null ? "—" : (x.vsAvg > 0 ? "+" : "") + x.vsAvg.toFixed(3)}</Td>
              </tr>
            );
          })}</tbody>
        </table>
        </div>
        <div style={{ fontSize: 11, color: "var(--steel)", padding: "6px 14px 10px" }}>vs avg: how far our price sits above (red) or below (green) the market average.</div>
      </Panel>
      {/* by region */}
      {(prices.byRegion || []).length > 0 && (
        <Panel style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
          <div className="lbl" style={{ margin: 0, padding: "12px 14px 8px" }}>DA price by region</div>
          <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Region</Th><Th right>Blend</Th><Th right>Diesel</Th></tr></thead>
            <tbody>{prices.byRegion.map((r) => (
              <tr key={r.region} style={{ borderTop: "1px solid var(--line)" }}>
                <Td>{r.region}</Td><Td right>{money3(r.blend)}</Td><Td right>{money3(r.diesel)}</Td>
              </tr>
            ))}</tbody>
          </table>
        </Panel>
      )}
      {/* per-site detail table — full listing, at the bottom; tap a row to drill */}
      {bySite.length > 0 && (
        <Panel style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px 8px", gap: 10 }}>
            <div className="lbl" style={{ marginBottom: 0 }}>By site — DA price (tap a row for competitors)</div>
            <span className="mono" style={{ fontSize: 11, color: "var(--steel)" }}>{bySite.length}</span>
          </div>
          {bySite.length > 7 && <div style={{ padding: "0 14px 8px" }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search site or region…"
            style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid var(--line)", fontSize: 13, fontFamily: "'Barlow',system-ui,sans-serif", boxSizing: "border-box" }} /></div>}
          <div style={{ overflowX: "auto" }}>
            <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Site</Th><Th>Region</Th><Th right>Blend</Th><Th right>Diesel</Th><Th right></Th></tr></thead>
              <tbody>{filtered.map((s) => (
                <tr key={s.site} onClick={() => onDrill({ title: s.site, sub: `${s.region} · vs ${(s.competitors || []).length} competitors`, render: siteDetail(s) })}
                  style={{ borderTop: "1px solid var(--line)", cursor: "pointer" }}>
                  <Td style={{ fontWeight: 600, color: "var(--navy)" }}>{s.site}</Td>
                  <Td style={{ color: "var(--steel)" }}>{s.region}</Td>
                  <Td right>{money3(s.da.blend)}</Td>
                  <Td right>{money3(s.da.diesel)}</Td>
                  <Td right style={{ color: "var(--steel)" }}>›</Td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {filtered.length === 0 && <div style={{ color: "var(--steel)", fontSize: 13, padding: "10px 14px" }}>No matching sites.</div>}
        </Panel>
      )}
    </>
  );
}

/* Retail supervisor's fuel request — for their site's vehicles only. Simpler
   than the fleet wizard: pick a site car, litres, odometer, reason. */
export function RetailRequest({ me }) {
  const [vehicles, setVehicles] = useState([]);
  const [f, setF] = useState({ card: "", litres: "", odo: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { getSiteConfig().then((c) => setVehicles(c.vehicles || [])).catch((e) => window.dispatchEvent(new CustomEvent("da-load-error", { detail: "Couldn't load this site's vehicles — " + (e.message || "tap refresh.") }))); }, []);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const send = async (e) => {
    e.preventDefault(); setMsg(null);
    if (!f.card) return setMsg({ tone: "amber", title: "Almost there", body: "Pick a vehicle first." });
    if (!(Number(f.litres) > 0)) return setMsg({ tone: "amber", title: "Almost there", body: "Enter the litres to request." });
    setBusy(true);
    try {
      const veh = vehicles.find((v) => v.card === f.card);
      await postRequest({
        card: f.card, mode: "general", horse: veh?.name || "vehicle",
        station: me.site, odo: Number(f.odo) || 0, calcLitres: Number(f.litres),
        reason: f.reason, deviceTime: new Date().toISOString(),
      });
      setMsg({ tone: "ok", title: "Request sent", body: `${f.litres} L for ${veh?.name || f.card}` });
      setF({ card: "", litres: "", odo: "", reason: "" });
    } catch (err) { setMsg({ tone: "red", title: "Not sent", body: err.message }); }
    finally { setBusy(false); }
  };
  return (
    <Wrap>
      <SectionHead title="Fuel request" sub={`${me.site} vehicles`} />
      <Panel>
        <form onSubmit={send}>
          {msg && <Note tone={msg.tone} title={msg.title}>{msg.body}</Note>}
          {vehicles.length === 0 && <Note tone="amber" title="No vehicles assigned to your site">Ask an admin to add your site's cars in Master data.</Note>}
          <Field label="Vehicle">
            <Picker value={f.card} onChange={set("card")} placeholder="Select a vehicle…" title="Vehicle" options={vehicles.map((v) => ({ value: v.card, label: `${v.name} · ${v.card}` }))} />
          </Field>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><Field label="Litres"><Num value={f.litres} onChange={set("litres")} /></Field></div>
            <div style={{ flex: 1 }}><Field label="Odometer"><Num value={f.odo} onChange={set("odo")} /></Field></div>
          </div>
          <Field label="Reason"><input value={f.reason} onChange={(e) => set("reason")(e.target.value)} placeholder="e.g. deliveries, errand" /></Field>
          <button className="pill" disabled={busy} style={{ width: "100%" }}>{busy ? "Sending…" : "Send request"}</button>
        </form>
      </Panel>
    </Wrap>
  );
}

// Wet-stock reconciliation — per-site variance (expected vs actual dip) from the
// day-end engine. Variance is a signal to investigate, NOT a pilferage figure.
export function WetstockView() {
  const [period, setPeriod] = useState("year");   // loss analysis is retrospective — default to the full picture; narrow with the selector
  const [range, setRange] = useState(defaultRange);
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (period === "range" && !(range.from && range.to)) return;
    const w = periodWindow(period, range);
    setD(null); setErr(null); getWetstock(w.days).then(setD).catch((e) => setErr(e.message));
  }, [period, range.from, range.to, reloadKey]);
  const TONE = { critical: "var(--red)", watch: "var(--amber)", ok: "var(--ok)" };
  const varCell = (v) => <Td right style={{ color: v < 0 ? "var(--red)" : v > 0 ? "var(--ok)" : "var(--steel)" }}>{v ? (v > 0 ? "+" : "") + L(v) : "—"}</Td>;
  return (
    <Wrap>
      <SectionHead title="High-loss sites" sub="Delivery + wet-stock losses per site — worst first" />
      <PeriodBar period={period} range={range} onPeriod={setPeriod} onRange={setRange} />
      <RefreshBar data={d} busy={!d && !err} onRefresh={() => setReloadKey((k) => k + 1)} />
      {d && d.sites && d.sites.length > 0 && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}><ExportBtn onClick={() => exportWetstock(d)} /></div>}
      {err && <Note tone="red" title="Could not load">{err}</Note>}
      {!d && !err && <Panel><div style={{ color: "var(--steel)" }}>Loading…</div></Panel>}
      {d && d.sites.length === 0 && <Note tone="amber" title="No day-end data yet" >The day-end reports haven’t synced for this window.</Note>}
      {d && d.sites.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <CountPill n={compact(d.net) + "L"} label={`Total loss · ${d.days}d`} tone={d.critical ? "red" : d.watch ? "amber" : "ok"} />
            {d.netValue != null && <CountPill n={"$" + compact(d.netValue)} label="Loss at cost" tone={d.netValue > 0 ? (d.critical ? "red" : "amber") : "ok"} />}
            <CountPill n={d.critical} label={`Critical (>${d.critAt ?? "1.0"}%)`} tone={d.critical ? "red" : "ok"} />
            <CountPill n={d.watch} label={`Watch (>${d.watchAt ?? "0.5"}%)`} tone={d.watch ? "amber" : "ok"} />
            {d.netRate != null && <CountPill n={d.netRate + "%"} label="Network rate" tone="ok" />}
          </div>
          <Panel style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "var(--navy)", color: "#fff" }}>
                  <Th>Site</Th><Th right>Sold</Th><Th right>Delivery</Th><Th right>Site</Th><Th right>Total loss</Th><Th right>$ cost</Th><Th right>%</Th></tr></thead>
                <tbody>{d.sites.map((s) => (
                  <tr key={s.site} style={{ borderTop: "1px solid var(--line)", background: s.status === "critical" ? "#FDECEA" : s.status === "watch" ? "#FFF7E6" : "#fff" }}>
                    <Td>{s.status === "critical" ? "⚠ " : ""}{s.site}</Td>
                    <Td right style={{ color: "var(--steel)" }}>{L(s.sold)}</Td>
                    <Td right style={{ color: s.deliveryLoss > 0 ? "var(--red)" : "var(--steel)" }}>{L(s.deliveryLoss)}</Td>
                    <Td right style={{ color: s.siteLoss > 0 ? "var(--red)" : "var(--steel)" }}>{L(s.siteLoss)}</Td>
                    <Td right style={{ fontWeight: 700, color: TONE[s.status] }}>{L(s.totalLoss)}</Td>
                    <Td right style={{ color: s.lossValue > 0 ? TONE[s.status] : "var(--steel)" }}>{s.lossValue != null ? "$" + compact(s.lossValue) : "—"}</Td>
                    <Td right style={{ color: TONE[s.status] }}>{s.lossPct != null ? s.lossPct + "%" : "—"}</Td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </Wrap>
  );
}

// CASH — banked-vs-expected per site. The third leg: did the money that the pumps
// should have made actually get declared and banked? Two signals: takings shortfall
// (expected − declared) and unbanked USD cash (held, not yet deposited).
// Channel split — DA own-channel VOLUME vs Petrotrade coupon volume, so we can see
// how the DA channel is growing (vs the same span last month). Litres, not $.
function ChannelSplitPanel({ ch }) {
  const grow = (g) => {
    if (g == null) return <span className="mono" style={{ fontSize: 12, color: "var(--steel)" }}>—</span>;
    const flat = Math.abs(g) < 0.5, col = flat ? "#8A94A6" : g < 0 ? "var(--red)" : "var(--ok)";
    return <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: col }}>{flat ? "→" : g < 0 ? "▼" : "▲"} {Math.abs(g)}%</span>;
  };
  const row = (label, vol, share, mtd, lm, g, strong) => (
    <tr style={{ borderTop: "1px solid var(--line)", background: strong ? "#EEF2FF" : undefined }}>
      <Td style={{ fontWeight: strong ? 700 : 600, color: strong ? "var(--blue)" : "var(--ink)" }}>{label}</Td>
      <Td right style={{ fontWeight: 700 }}>{compact(vol)} L</Td>
      <Td right style={{ color: "var(--steel)" }}>{share != null ? share + "%" : "—"}</Td>
      <Td right style={{ color: "var(--steel)" }}>{compact(mtd)} vs {compact(lm)}</Td>
      <Td right>{grow(g)}</Td>
    </tr>
  );
  return (
    <Panel style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
      <div className="lbl" style={{ padding: "12px 14px 8px" }}>Sales channel <span style={{ color: "var(--steel)", fontWeight: 400 }}>· DA own vs Petrotrade · volume</span></div>
      <div style={{ overflowX: "auto" }}>
        <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "var(--navy)", color: "#fff" }}>
            <Th>Channel</Th><Th right>Volume</Th><Th right>Share</Th><Th right>MTD vs last mo</Th><Th right>Growth</Th></tr></thead>
          <tbody>
            {row("DA (own channel)", ch.da, ch.daShare, ch.daMtd, ch.daLastMonth, ch.daGrowth, true)}
            {row("Petrotrade coupons", ch.petrotrade, +(100 - ch.daShare).toFixed(1), ch.ptMtd, ch.ptLastMonth, ch.ptGrowth, false)}
            {row("Total", ch.total, null, ch.totalMtd, ch.totalLastMonth, ch.totalGrowth, false)}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// Tender split — a single bar + labels, USD. `parts` are [label, value, color];
// zero-value tenders are dropped. Used for revenue-by-tender (Overview/Sales) and
// takings-by-tender (Cash tab) with different parts.
function TenderMixPanel({ parts, label }) {
  const $ = (v) => "$" + compact(v || 0);
  const p = (parts || []).filter(([, v]) => (v || 0) > 0);
  const total = p.reduce((a, x) => a + x[1], 0);
  const pct = (v) => (total > 0 ? Math.round((100 * (v || 0)) / total) : 0);
  return (
    <Panel style={{ marginBottom: 12 }}>
      <div className="lbl" style={{ marginBottom: 8 }}>{label} <span style={{ color: "var(--steel)", fontWeight: 400 }}>· USD</span></div>
      <StockBar parts={p} total={total} fmt={(v) => `${$(v)} · ${pct(v)}%`} />
    </Panel>
  );
}

// Per-site day-end reconciliation — the full picture from the Summary Status
// report: per-product dips → gain/loss, tank comment, cash & tender split.
function SiteDayendDrill({ site }) {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { getSiteDayend(site, 14).then(setD).catch((e) => setErr(e.message || "load failed")); }, [site]);
  const $ = (v) => "$" + compact(v || 0);
  if (err) return <Note tone="red" title="Could not load">{err}</Note>;
  if (!d) return <div style={{ color: "var(--steel)" }}>Loading…</div>;
  if (!(d.rows || []).length) return <Note tone="amber" title="No day-end data">No Summary Status rows for this site in the last {d.days} days.</Note>;
  return (
    <>
      {d.rows.map((day) => (
        <Panel key={day.date} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <div className="disp" style={{ fontWeight: 700, color: "var(--navy)" }}>{fmtD(day.date)}</div>
            <div className="mono" style={{ fontSize: 12, color: "var(--steel)" }}>takings {$(day.cash.totalSales)}</div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead><tr style={{ color: "var(--steel)", textAlign: "right" }}>
                <th style={{ textAlign: "left", fontWeight: 600, padding: "0 0 4px" }}>Product</th><th style={{ fontWeight: 600 }}>Start</th><th style={{ fontWeight: 600 }}>+Recv</th><th style={{ fontWeight: 600 }}>−Sold</th><th style={{ fontWeight: 600 }}>End</th><th style={{ fontWeight: 600 }}>Gain/Loss</th></tr></thead>
              <tbody>{day.products.map((p) => (
                <tr key={p.product} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "5px 0" }}>{p.product}</td>
                  <td style={{ textAlign: "right", color: "var(--steel)" }}>{L(p.startDip)}</td>
                  <td style={{ textAlign: "right", color: "var(--steel)" }}>{p.deliveries ? L(p.deliveries) : "—"}</td>
                  <td style={{ textAlign: "right", color: "var(--steel)" }}>{L(p.salesQty)}</td>
                  <td style={{ textAlign: "right" }}>{L(p.endDip)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: p.gainLoss > 5 ? "var(--red)" : p.gainLoss < -5 ? "var(--ok)" : "var(--steel)" }}>{p.gainLoss > 0 ? "−" : p.gainLoss < 0 ? "+" : ""}{L(Math.abs(p.gainLoss))}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {day.tankComment && <div style={{ fontSize: 11.5, color: "var(--steel)", marginTop: 7 }}>💬 <span style={{ fontStyle: "italic" }}>{day.tankComment}</span></div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 11.5, color: "var(--steel)", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
            <span>Cash <b style={{ color: "var(--ink)" }}>{$(day.cash.cashSale)}</b></span>
            <span>DA card <b style={{ color: "var(--ink)" }}>{$(day.tenders.daCard)}</b></span>
            {day.tenders.redan > 0 && <span>Redan <b style={{ color: "var(--ink)" }}>{$(day.tenders.redan)}</b></span>}
            {day.tenders.petrotrade > 0 && <span>Petrotrade <b style={{ color: "var(--ink)" }}>{$(day.tenders.petrotrade)}</b></span>}
            <span>Till {day.cash.cashDiff > 0 ? "short" : day.cash.cashDiff < 0 ? "over" : ""} <b style={{ color: Math.abs(day.cash.cashDiff) > 50 ? "var(--amber)" : "var(--ink)" }}>${Math.abs(day.cash.cashDiff).toFixed(2)}</b></span>
          </div>
        </Panel>
      ))}
    </>
  );
}

export function CashView() {
  const [period, setPeriod] = useState("month");
  const [range, setRange] = useState(defaultRange);
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (period === "range" && !(range.from && range.to)) return;
    const w = periodWindow(period, range);
    setD(null); setErr(null); getCash(w.days).then(setD).catch((e) => setErr(e.message));
  }, [period, range.from, range.to, reloadKey]);
  const TONE = { critical: "var(--red)", watch: "var(--amber)", ok: "var(--ok)" };
  const $ = (v) => "$" + compact(v);
  const [drill, setDrill] = useState(null);
  return (
    <Wrap>
      <SectionHead title="Cash collections" sub="Takings, tender mix & till variance per site — from the day-end report" />
      <PeriodBar period={period} range={range} onPeriod={setPeriod} onRange={setRange} />
      <RefreshBar data={d} busy={!d && !err} onRefresh={() => setReloadKey((k) => k + 1)} />
      {err && <Note tone="red" title="Could not load">{err}</Note>}
      {!d && !err && <Panel><div style={{ color: "var(--steel)" }}>Loading…</div></Panel>}
      {d && (d.sites || []).length === 0 && (
        <Note tone="amber" title="No day-end cash yet">The day-end Summary Status report hasn't synced for this window.</Note>
      )}
      {d && (d.sites || []).length > 0 && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <CountPill n={$(d.expected)} label={`Takings · ${d.days}d`} tone="ok" />
            <CountPill n={$(Math.abs(d.cashVarTotal))} label={`Till ${d.cashVarTotal >= 0 ? "short" : "over"}`} tone={Math.abs(d.cashVarTotal) > d.expected * 0.005 ? "amber" : "ok"} />
            <CountPill n={$(d.couponFloat)} label="Coupon float" tone="ok" />
            <CountPill n={$(Math.abs(d.unaccounted))} label="Unaccounted" tone={d.critical ? "red" : d.watch ? "amber" : "ok"} />
            {d.bankingTracked && <CountPill n={$(d.unbankedTotal)} label="Cash unbanked" tone={d.unbankedTotal > 0 ? "amber" : "ok"} />}
          </div>
          {d.tender && <TenderMixPanel label="How takings were tendered" parts={[["Cash", d.tender.cash, "#2B3990"], ["DA card", d.tender.daCard, "#6BC048"], ["Redan", d.tender.redan, "#C8A24B"], ["Petrotrade", d.tender.petro, "#8FB8FF"]]} />}
          <Panel style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "var(--navy)", color: "#fff" }}>
                  <Th>Site</Th><Th right>Takings</Th><Th right>Cash</Th><Th right>DA card</Th><Th right>Coupons</Th><Th right>Cash %</Th><Th right>Till +/−</Th></tr></thead>
                <tbody>{d.sites.map((s) => (
                  <tr key={s.site} onClick={() => setDrill(s.site)} style={{ borderTop: "1px solid var(--line)", cursor: "pointer", background: s.status === "critical" ? "#FDECEA" : s.status === "watch" ? "#FFF7E6" : "#fff" }}>
                    <Td>{s.status === "critical" ? "⚠ " : ""}{s.site}<span style={{ color: "var(--steel)" }}> ›</span></Td>
                    <Td right style={{ fontWeight: 700 }}>{$(s.expected)}</Td>
                    <Td right style={{ color: "var(--steel)" }}>{$(s.cashSale)}</Td>
                    <Td right style={{ color: "var(--steel)" }}>{$(s.daCard)}</Td>
                    <Td right style={{ color: "var(--steel)" }}>{$(s.coupons)}</Td>
                    <Td right>{s.cashMix != null ? s.cashMix + "%" : "—"}</Td>
                    <Td right style={{ color: Math.abs(s.cashVar) > 50 ? "var(--amber)" : "var(--steel)" }}>{s.cashVar ? "$" + compact(Math.abs(s.cashVar)) : "—"}</Td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
      {drill && <DetailSheet title={drill} sub="Day-end reconciliation · last 14 days" onClose={() => setDrill(null)}><SiteDayendDrill site={drill} /></DetailSheet>}
    </Wrap>
  );
}

// Submission-compliance scorecard — who reports stock/price/sales, worst first.
function ComplianceBoard({ rows }) {
  const days = rows[0]?.days || 14;
  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length) : 0;
  const bar = (n) => <span style={{ color: n >= days ? "var(--ok)" : n === 0 ? "var(--red)" : "var(--amber)" }}>{n}/{days}</span>;
  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <CountPill n={avg + "%"} label={`Avg compliance · ${days}d`} tone={avg >= 80 ? "ok" : "amber"} />
        <CountPill n={rows.filter((r) => r.pct === 0).length} label="Never reported" tone={rows.some((r) => r.pct === 0) ? "red" : "ok"} />
        <CountPill n={rows.filter((r) => r.pct < 50).length} label="Under 50%" tone="amber" />
      </div>
      <Panel style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Site</Th><Th right>Score</Th><Th right>Sales</Th><Th right>Stock</Th><Th right>Price</Th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.site} style={{ borderTop: "1px solid var(--line)", background: r.pct === 0 ? "#FDECEA" : r.pct < 50 ? "#FFF7E6" : "#fff" }}>
                <Td>{r.pct < 50 ? "⚠ " : ""}{r.site}</Td>
                <Td right style={{ fontWeight: 700, color: r.pct >= 80 ? "var(--ok)" : r.pct === 0 ? "var(--red)" : "var(--amber)" }}>{r.pct}%</Td>
                <Td right>{bar(r.salesDays)}</Td><Td right>{bar(r.stockDays)}</Td><Td right>{bar(r.priceDays)}</Td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
      <div style={{ fontSize: 11, color: "var(--steel)", marginTop: 8 }}>Days each site reported in the last {days}. Chase the red/amber managers.</div>
    </>
  );
}

/* ============================================================ *
 *  RETAIL DASHBOARD (approver/admin) — stock / price / sales
 * ============================================================ */
export function RetailDashboard() {
  // Default to the latest day that actually has data (the server figures this
  // out when no date is sent) — so as soon as a shift's figures come in they
  // show, and before that it falls back to the previous day. The user can then
  // pick any other date.
  // default to YESTERDAY — reporting runs a day late, so today has no complete
  // figures yet; yesterday is the last full trading day.
  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); });
  const [which, setWhich] = useState("stock");
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [drill, setDrill] = useState(null);
  const load = useCallback(() => {
    setData(null); setErr(null);
    getRetail(date).then((d) => { setData(d); if (!date && d.date) setDate(d.date); }).catch((e) => setErr(e.message));
  }, [date]);
  useEffect(() => { load(); }, [load]);
  // tap any site (on any board) → one sheet with its full picture for the day
  const openSite = (site) => setDrill({ title: site.name, sub: `${site.region ? site.region + " · " : ""}${fmtD(data.date)}`, render: retailSiteDetail(data, site) });

  return (
    <Wrap>
      <SectionHead title="Retail sites" sub={`Stock · Price · Sales${data?.date ? " — showing " + fmtD(data.date) : ""}`} />
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {(() => { const ymd = (o) => { const d = new Date(); d.setDate(d.getDate() - o); return d.toISOString().slice(0, 10); }; const yday = ymd(1), tday = ymd(0);
          return [["Yesterday", yday], ["Today", tday]].map(([lab, val]) => (
            <button key={lab} className={"pill" + ((date || data?.date) === val ? "" : "-ghost")} onClick={() => setDate(val)} style={{ padding: "9px 14px" }}>{lab}</button>
          )); })()}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 160 }} />
        {data && <ExportBtn onClick={() => exportRetail(which, data)} />}
      </div>
      <Segmented options={[["stock", "Stock"], ["price", "Price"], ["sales", "Sales"], ["compliance", "Compliance"]]} value={which} onChange={setWhich} />
      <RefreshBar data={data} busy={!data && !err} onRefresh={load} />
      {err && <Note tone="red" title="Could not load">{err}</Note>}
      {!data && !err && <Panel><div style={{ color: "var(--steel)" }}>Loading…</div></Panel>}
      {data && which === "stock" && <StockBoard d={data} onSite={openSite} />}
      {data && which === "price" && <PriceBoard d={data} onSite={openSite} />}
      {data && which === "sales" && <SalesBoard d={data} onSite={openSite} />}
      {data && which === "compliance" && <ComplianceBoard rows={data.compliance || []} />}
      {drill && <DetailSheet title={drill.title} sub={drill.sub} onClose={() => setDrill(null)}>{drill.render()}</DetailSheet>}
    </Wrap>
  );
}

// One site's full day: stock (both shifts), sales (both shifts), price vs market.
function retailSiteDetail(d, site) {
  const tbl = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
  const head = { background: "var(--navy)", color: "#fff" };
  return () => {
    const st = { day: d.stock.day[site.id], night: d.stock.night[site.id] };
    const sl = { day: d.sales.day[site.id], night: d.sales.night[site.id] };
    const pr = d.price.bySite[site.id];
    const comps = pr && Array.isArray(pr.lines) ? pr.lines.filter((l) => !l.isDA && l.price > 0) : [];
    const na = <span style={{ color: "var(--steel)" }}>—</span>;
    return (
      <>
        <Panel style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
          <div className="lbl" style={{ padding: "12px 14px 8px" }}>Stock on hand</div>
          <div style={{ overflowX: "auto" }}>
            <table className="mono" style={tbl}>
              <thead><tr style={head}><Th>Shift</Th><Th right>Blend</Th><Th right>Diesel</Th></tr></thead>
              <tbody>{["day", "night"].map((sh) => { const v = st[sh]; return (
                <tr key={sh} style={{ borderTop: "1px solid var(--line)" }}>
                  <Td style={{ textTransform: "capitalize" }}>{sh}</Td>
                  <Td right>{v ? L(v.blend) : na}</Td><Td right>{v ? L(v.diesel) : na}</Td>
                </tr>
              ); })}</tbody>
            </table>
          </div>
        </Panel>
        <Panel style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
          <div className="lbl" style={{ padding: "12px 14px 8px" }}>Sales</div>
          <div style={{ overflowX: "auto" }}>
            <table className="mono" style={tbl}>
              <thead><tr style={head}><Th>Shift</Th><Th right>Blend</Th><Th right>Diesel</Th></tr></thead>
              <tbody>{["day", "night"].map((sh) => { const v = sl[sh]; return (
                <tr key={sh} style={{ borderTop: "1px solid var(--line)" }}>
                  <Td style={{ textTransform: "capitalize" }}>{sh}</Td>
                  <Td right>{v ? L(v.blendSales) : na}</Td><Td right>{v ? L(v.dieselSales) : na}</Td>
                </tr>
              ); })}
              {(sl.day || sl.night) && (
                <tr style={{ borderTop: "2px solid var(--navy)", background: "#F4F6FA", fontWeight: 700 }}>
                  <Td style={{ fontWeight: 700 }}>Total</Td>
                  <Td right>{L((sl.day?.blendSales || 0) + (sl.night?.blendSales || 0))}</Td>
                  <Td right>{L((sl.day?.dieselSales || 0) + (sl.night?.dieselSales || 0))}</Td>
                </tr>
              )}</tbody>
            </table>
          </div>
        </Panel>
        {pr ? (
          <>
            <Panel style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
              <div className="lbl" style={{ padding: "12px 14px 8px" }}>Price vs market</div>
              <div style={{ overflowX: "auto" }}>
                <table className="mono" style={tbl}>
                  <thead><tr style={head}><Th>Fuel</Th><Th right>DA</Th><Th right>Mkt avg</Th><Th right>Δ vs mkt</Th></tr></thead>
                  <tbody>{["Blend", "Diesel"].map((fuel) => { const a = pr.analysis[fuel]; if (!a || a.da == null) return null; return (
                    <tr key={fuel} style={{ borderTop: "1px solid var(--line)" }}>
                      <Td>{fuel}</Td>
                      <Td right style={{ fontWeight: 700 }}>{money(a.da)}</Td>
                      <Td right>{money(a.avg)}</Td>
                      <Td right style={{ fontWeight: 700, color: a.gap == null ? "var(--steel)" : a.gap > 0 ? "var(--red)" : "var(--ok)" }}>{a.gap == null ? "—" : (a.gap > 0 ? "+" : "") + money(a.gap)}</Td>
                    </tr>
                  ); })}</tbody>
                </table>
              </div>
            </Panel>
            {comps.length > 0 && (
              <Panel style={{ padding: 0, overflow: "hidden" }}>
                <div className="lbl" style={{ padding: "12px 14px 8px" }}>Competitors vs us</div>
                <div style={{ overflowX: "auto" }}>
                  <table className="mono" style={tbl}>
                    <thead><tr style={head}><Th>Station</Th><Th>Fuel</Th><Th right>Price</Th><Th right>Δ vs us</Th></tr></thead>
                    <tbody>{comps.map((l, i) => {
                      const cfuel = l.fuelType === "Petrol" ? "Blend" : l.fuelType;
                      const da = pr.analysis[cfuel]?.da;
                      const delta = da != null && l.price != null ? +(l.price - da).toFixed(3) : null;
                      return (
                        <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                          <Td>{l.station}</Td><Td style={{ color: "var(--steel)" }}>{cfuel}</Td>
                          <Td right>{money(l.price)}</Td>
                          <Td right style={{ fontWeight: 700, color: delta == null ? "var(--steel)" : delta > 0 ? "var(--ok)" : delta < 0 ? "var(--red)" : "var(--steel)" }}>{delta == null ? "—" : (delta > 0 ? "+" : "") + money(delta)}</Td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: "var(--steel)", padding: "8px 14px 12px" }}>Δ vs our price · <span style={{ color: "var(--ok)" }}>green = we're cheaper</span> · <span style={{ color: "var(--red)" }}>red = they undercut us</span></div>
              </Panel>
            )}
          </>
        ) : <Note tone="amber" title="No price survey">No competitor prices were submitted for this site on {fmtD(d.date)}.</Note>}
      </>
    );
  };
}

const CountPill = ({ n, total, label, tone = "blue" }) => {
  const c = { blue: "#2B3990", ok: "#4C9E2A", amber: "#C07A00", red: "#D63B2E" }[tone];
  return (
    <div style={{ flex: 1, background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", textAlign: "center" }}>
      <div className="mono" style={{ fontSize: 24, fontWeight: 600, color: c }}>{n}{total != null && <span style={{ fontSize: 14, color: "var(--steel)" }}>/{total}</span>}</div>
      <div className="lbl" style={{ marginBottom: 0 }}>{label}</div>
    </div>
  );
};
const MissingList = ({ names }) => (
  names.length === 0 ? <Note tone="ok" title="All sites reported" /> :
  <Note tone="amber" title={`${names.length} not yet in`}>{names.join(" · ")}</Note>
);

function StockBoard({ d, onSite }) {
  const [shift, setShift] = useState(() => pickShift((sh) => Object.keys(d.stock[sh] || {}).length > 0, "day"));
  const s = d.stock[shift]; const total = d.sites.length;
  const submitted = Object.keys(s).length;
  const t = d.stock.totals[shift];
  return (
    <>
      <Segmented options={[["day", "Day shift"], ["night", "Night shift"]]} value={shift} onChange={setShift} />
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <CountPill n={submitted} total={total} label="Reported" tone={submitted >= total ? "ok" : "amber"} />
      </div>
      {d.stock.lowStock?.length > 0 && <Note tone="red" title={`${d.stock.lowStock.length} low on stock (< 5,000 L)`}>{d.stock.lowStock.join(" · ")}</Note>}
      <MissingList names={d.stock.missing[shift]} />
      <Panel style={{ padding: 0, overflow: "hidden" }}>
        <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "var(--navy)", color: "#fff" }}>
            <Th>Site</Th><Th right>Blend</Th><Th right>Diesel</Th></tr></thead>
          <tbody>{d.sites.slice().sort((a, b) => a.name.localeCompare(b.name)).map((site) => { const v = s[site.id]; return (
            <tr key={site.id} onClick={() => onSite && onSite(site)} style={{ borderTop: "1px solid var(--line)", background: v ? "#fff" : "#FBFAF6", cursor: onSite ? "pointer" : undefined }}>
              <Td>{site.name}{onSite && <span style={{ color: "var(--steel)" }}> ›</span>}</Td>
              <Td right style={{ color: v && v.low ? "var(--red)" : undefined }}>{v ? L(v.blend) : "—"}</Td>
              <Td right style={{ color: v && v.low ? "var(--red)" : undefined }}>{v ? L(v.diesel) : "—"}</Td></tr>
          ); })}
          <tr style={{ borderTop: "2px solid var(--navy)", background: "#F4F6FA" }}>
            <Td style={{ fontWeight: 700 }}>Total on hand</Td>
            <Td right style={{ fontWeight: 700 }}>{L(t.blend)}</Td>
            <Td right style={{ fontWeight: 700 }}>{L(t.diesel)}</Td>
          </tr></tbody>
        </table>
      </Panel>
    </>
  );
}

function SalesBoard({ d, onSite }) {
  // Open on the freshest complete shift for the clock (see naturalShift); the
  // executive can still switch to the other shift or the Day + Night total.
  const [shift, setShift] = useState(() => pickShift((sh) => sh !== "total" && Object.keys(d.sales[sh] || {}).length > 0, "total"));
  // "total" = day + night combined per site
  const isTotal = shift === "total";
  const combine = (id) => {
    const dd = d.sales.day[id], nn = d.sales.night[id];
    if (!dd && !nn) return undefined;
    return { blendSales: (dd?.blendSales || 0) + (nn?.blendSales || 0), dieselSales: (dd?.dieselSales || 0) + (nn?.dieselSales || 0) };
  };
  const s = isTotal ? Object.fromEntries(d.sites.map((x) => [x.id, combine(x.id)]).filter(([, v]) => v)) : d.sales[shift];
  const total = d.sites.length;
  const submitted = Object.keys(s).length;
  const t = isTotal
    ? { blendSales: d.sales.totals.day.blendSales + d.sales.totals.night.blendSales, dieselSales: d.sales.totals.day.dieselSales + d.sales.totals.night.dieselSales }
    : d.sales.totals[shift];
  return (
    <>
      <Segmented options={[["day", "Day"], ["night", "Night"], ["total", "Day + Night"]]} value={shift} onChange={setShift} />
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <CountPill n={submitted} total={total} label="Reported" tone={submitted >= total ? "ok" : "amber"} />
      </div>
      {!isTotal && <MissingList names={d.sales.missing[shift]} />}
      {d.hasDayEnd
        ? <Note tone="ok" title="Final — from the day-end report">The authoritative whole-day figure is the day-end report. The shift numbers here are the sites' indicative submissions; the variance below is each submission netted against the final.</Note>
        : <Note tone="blue" title="Indicative so far">These are the sites' shift submissions. The final, authoritative day total comes from the day-end report (usually in next morning).</Note>}
      {d.hasDayEnd && (d.reconciliation || []).some((r) => r.final && Math.abs(r.variance) > 200) && (
        <Panel style={{ marginBottom: 14, padding: 0, overflow: "hidden" }}>
          <div className="lbl" style={{ padding: "12px 14px 8px" }}>Submitted vs final (day-end) — variance</div>
          <div style={{ overflowX: "auto" }}>
            <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Site</Th><Th right>Submitted</Th><Th right>Final</Th><Th right>Variance</Th></tr></thead>
              <tbody>{d.reconciliation.filter((r) => r.final).slice(0, 20).map((r) => (
                <tr key={r.site} style={{ borderTop: "1px solid var(--line)" }}>
                  <Td>{r.site}</Td><Td right style={{ color: "var(--steel)" }}>{L(r.submitted)}</Td><Td right>{L(r.authoritative)}</Td>
                  <Td right style={{ fontWeight: 700, color: Math.abs(r.variance) > 1000 ? "var(--red)" : Math.abs(r.variance) > 300 ? "var(--amber)" : "var(--ok)" }}>{r.variance > 0 ? "+" : ""}{L(r.variance)}</Td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: "var(--steel)", padding: "6px 14px 10px" }}>Submitted = site's day+night reports · Final = day-end report (authoritative). Big gaps = a site mis-reporting its shift figures.</div>
        </Panel>
      )}
      <Panel style={{ padding: 0, overflow: "hidden" }}>
        <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "var(--navy)", color: "#fff" }}>
            <Th>Site</Th><Th right>Blend sold</Th><Th right>Diesel sold</Th></tr></thead>
          <tbody>{d.sites.slice().sort((a, b) => {
            const va = s[a.id], vb = s[b.id];
            const ta = va ? (Number(va.blendSales) || 0) + (Number(va.dieselSales) || 0) : -1;
            const tb = vb ? (Number(vb.blendSales) || 0) + (Number(vb.dieselSales) || 0) : -1;
            return tb - ta;   // biggest sales volume first
          }).map((site) => { const v = s[site.id]; return (
            <tr key={site.id} onClick={() => onSite && onSite(site)} style={{ borderTop: "1px solid var(--line)", background: v ? "#fff" : "#FBFAF6", cursor: onSite ? "pointer" : undefined }}>
              <Td>{site.name}{onSite && <span style={{ color: "var(--steel)" }}> ›</span>}</Td>
              <Td right>{v ? L(v.blendSales) : "—"}</Td><Td right>{v ? L(v.dieselSales) : "—"}</Td></tr>
          ); })}
          <tr style={{ borderTop: "2px solid var(--navy)", background: "#F4F6FA" }}>
            <Td style={{ fontWeight: 700 }}>Total</Td>
            <Td right style={{ fontWeight: 700 }}>{L(t.blendSales)}</Td>
            <Td right style={{ fontWeight: 700 }}>{L(t.dieselSales)}</Td>
          </tr></tbody>
        </table>
      </Panel>
    </>
  );
}

function PriceBoard({ d, onSite }) {
  const entries = Object.entries(d.price.bySite);
  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <CountPill n={entries.length} total={d.sites.length} label="Surveys in" tone={entries.length >= d.sites.length ? "ok" : "amber"} />
      </div>
      <MissingList names={d.price.missing} />
      <Panel style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Site</Th><Th>Fuel</Th><Th right>DA</Th><Th right>Mkt avg</Th><Th right>Δ vs mkt</Th><Th right>Comp</Th></tr></thead>
            <tbody>{entries.map(([id, p]) => {
              const site = d.sites.find((s) => String(s.id) === String(id)) || { id, name: id };
              const fuels = ["Blend", "Diesel"].filter((f) => p.analysis[f] && p.analysis[f].da != null);
              if (!fuels.length) return null;
              return fuels.map((fuel, fi) => { const a = p.analysis[fuel]; return (
                <tr key={id + fuel} onClick={onSite ? () => onSite(site) : undefined}
                  style={{ borderTop: fi === 0 ? "1px solid var(--line)" : "none", cursor: onSite ? "pointer" : undefined }}>
                  <Td style={{ fontWeight: fi === 0 ? 600 : 400, color: fi === 0 ? "var(--navy)" : "transparent" }}>{fi === 0 ? site.name : "·"}</Td>
                  <Td style={{ color: "var(--steel)" }}>{fuel}</Td>
                  <Td right style={{ fontWeight: 700 }}>{money(a.da)}</Td>
                  <Td right>{money(a.avg)}</Td>
                  <Td right style={{ color: a.gap == null ? "var(--steel)" : a.gap > 0 ? "var(--red)" : "var(--ok)" }}>{a.gap == null ? "—" : (a.gap > 0 ? "+" : "") + money(a.gap)}</Td>
                  <Td right style={{ color: "var(--steel)" }}>{a.competitors}</Td>
                </tr>
              ); });
            })}</tbody>
          </table>
        </div>
      </Panel>
      <div style={{ fontSize: 11, color: "var(--steel)", marginTop: 8 }}>Δ vs market average · <span style={{ color: "var(--red)" }}>red = we're dearer</span> · <span style={{ color: "var(--ok)" }}>green = below market</span>{onSite ? " · tap a row for competitor prices" : ""}.</div>
    </>
  );
}

/* ============================================================ *
 *  HAULAGE — delivery note + recon submission, and dashboard
 * ============================================================ */
// ASTM D1250 VCF (client mirror of server/vcf.js) for the live loss preview.
const VCF_ALPHA = { Diesel: 0.000840, Petrol: 0.001200, Blend: 0.001000, Ethanol: 0.001000 };
const vcf = (tempC, commodity) => {
  const T = tempC == null || tempC === "" || Number.isNaN(Number(tempC)) ? 20 : Number(tempC);
  const a = VCF_ALPHA[commodity] || 0.0009, dT = T - 20;
  return Math.exp(-a * dT * (1 + 0.8 * a * dT));
};

export function DeliverySubmit({ me }) {
  const emptyTank = { tank: "", product: "", openMm: "", openL: "", closeMm: "", closeL: "", temp: "" };
  const [f, setF] = useState({ dnDate: todayISO(), tripNo: "", site: "", commodity: "Diesel", density: "", qtyLoaded: "", truckReg: "", truckName: "", trailer: "", note: "" });
  const [sites, setSites] = useState([]);
  const [trips, setTrips] = useState([]);
  const [tanks, setTanks] = useState([]);            // per site-tank dips
  const [comps, setComps] = useState([{ comp: "1", mm: "", litres: "", temp: "" }]); // truck compartments
  const [done, setDone] = useState(null);            // { dnNo }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  useEffect(() => {
    getSites().then((r) => setSites(r.sites || [])).catch((e) => window.dispatchEvent(new CustomEvent("da-load-error", { detail: "Couldn't load sites — " + (e.message || "tap refresh.") })));
    getMyTrips().then((r) => setTrips(r.trips || [])).catch((e) => window.dispatchEvent(new CustomEvent("da-load-error", { detail: "Couldn't load scheduled trips — " + (e.message || "tap refresh.") })));
  }, []);
  // load the site's tanks when the site changes
  useEffect(() => {
    if (!f.site) { setTanks([]); return; }
    getSiteConfig(f.site).then((c) => setTanks((c.tanks || []).map((t) => ({ ...emptyTank, tank: t.label, product: t.product }))))
      .catch((e) => { setTanks([]); window.dispatchEvent(new CustomEvent("da-load-error", { detail: "Couldn't load this site's tanks — " + (e.message || "tap refresh.") })); });
  }, [f.site]);
  const num = (x) => Number(x) || 0;
  const setTank = (i, k, v) => setTanks((ts) => ts.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const setComp = (i, k, v) => setComps((cs) => cs.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const deliveredOf = (t) => Math.max(0, num(t.closeL) - num(t.openL));
  const siteDip = tanks.reduce((a, t) => a + deliveredOf(t), 0);
  const truckDip = comps.reduce((a, c) => a + num(c.litres), 0);
  const qtyLoaded = num(f.qtyLoaded) || truckDip;
  const pickTrip = (tn) => {
    const t = trips.find((x) => x.tripNo === tn);
    setF((s) => ({ ...s, tripNo: tn, ...(t ? { commodity: t.product, truckName: t.truck || s.truckName, truckReg: t.truckReg || s.truckReg, trailer: t.trailer || s.trailer, qtyLoaded: String(t.qty || s.qtyLoaded), site: (t.drops && t.drops[0] && t.drops[0].site) || s.site } : {}) }));
  };
  // temperature-corrected loss preview
  const preview = useMemo(() => {
    if (!qtyLoaded || !siteDip) return null;
    const siteTemps = tanks.map((t) => num(t.temp)).filter(Boolean);
    const st = siteTemps.length ? siteTemps.reduce((a, b) => a + b, 0) / siteTemps.length : 20;
    const siteCorr = Math.round(siteDip * vcf(st, f.commodity));
    const raw = +(qtyLoaded - siteDip).toFixed(1), adj = +(qtyLoaded - siteCorr).toFixed(1);
    return { raw, rawPct: +((raw / qtyLoaded) * 100).toFixed(2), adj, adjPct: +((adj / qtyLoaded) * 100).toFixed(2) };
  }, [qtyLoaded, siteDip, tanks, f.commodity]);

  const trip = trips.find((t) => t.tripNo === f.tripNo);
  const tripDrops = trip?.drops || [];
  const pickDrop = (siteName) => {
    const d = tripDrops.find((x) => x.site === siteName);
    setF((s) => ({ ...s, site: siteName, ...(d && d.qty ? { qtyLoaded: String(d.qty) } : {}) }));
  };
  const valid = f.tripNo && f.site && f.density && tanks.some((t) => t.closeL !== "" && t.openL !== "");
  const send = async (e) => {
    e.preventDefault(); setMsg(null);
    if (!f.tripNo) return setMsg({ tone: "amber", title: "Almost there", body: "Pick the scheduled trip this delivery is for." });
    if (!f.site) return setMsg({ tone: "amber", title: "Almost there", body: "Pick the drop site." });
    if (!(Number(f.density) > 0)) return setMsg({ tone: "amber", title: "Almost there", body: "Enter the density." });
    if (!tanks.some((t) => t.closeL !== "" && t.openL !== "")) return setMsg({ tone: "amber", title: "Almost there", body: "Enter at least one tank's opening and closing dip." });
    setBusy(true);
    try {
      const r = await postAppDelivery({
        dnDate: f.dnDate, tripNo: f.tripNo || null, site: f.site, commodity: f.commodity,
        density: f.density, qtyLoaded, truckReg: f.truckReg, truckName: f.truckName, trailer: f.trailer, note: f.note,
        siteTanks: tanks.filter((t) => t.closeL !== "" || t.openL !== ""),
        truckComps: comps.filter((c) => c.litres !== ""),
        deviceTime: new Date().toISOString(),
      });
      setDone({ dnNo: r.dnNo, vcf: r.vcf });
    } catch (err) { setMsg({ tone: "red", title: "Not submitted", body: err.message }); }
    finally { setBusy(false); }
  };

  if (done) return (
    <Wrap>
      <SectionHead title="Delivery note" sub="Awaiting dual approval" />
      <Panel>
        <Note tone="ok" title={`Delivery note ${done.dnNo} captured`}>It's recorded and awaiting sign-off. Both the driver and the receiving site must approve it before it posts.</Note>
        {done.vcf && <div className="mono" style={{ fontSize: 13, color: "var(--steel)", marginBottom: 12 }}>Combined loss {L(done.vcf.combinedLoss)} L · temp-corrected {done.vcf.adjustedLossPct}%</div>}
        <button className="pill" style={{ width: "100%" }} onClick={() => { setDone(null); setF((s) => ({ ...s, tripNo: "", qtyLoaded: "", note: "" })); setTanks((ts) => ts.map((t) => ({ ...emptyTank, tank: t.tank, product: t.product }))); setComps([{ comp: "1", mm: "", litres: "", temp: "" }]); }}>New delivery note</button>
      </Panel>
    </Wrap>
  );

  return (
    <Wrap>
      <SectionHead title="Delivery note" sub="Dipped per tank (mm → L), density once, temperature-corrected" />
      <Panel>
        <form onSubmit={send}>
          {msg && <Note tone={msg.tone} title={msg.title}>{msg.body}</Note>}
          {trips.length === 0
            ? <Note tone="amber" title="No scheduled trips">A delivery must be planned first. Logistics schedules the trip, then it appears here to deliver against.</Note>
            : <Field label="Scheduled trip"><Picker value={f.tripNo} onChange={pickTrip} placeholder="Select the trip…" title="Scheduled trip"
                options={trips.map((t) => ({ value: t.tripNo, label: `${t.tripNo} — ${t.warehouse} ${L(t.qty)}L ${t.product}` }))} /></Field>}
          {/* trip context — pre-populated from the schedule, not re-entered */}
          {trip && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "2px 0 12px" }}>
              {[["Truck", f.truckName], ["Reg", f.truckReg], ["From", trip.warehouse], ["Product", f.commodity]].filter((x) => x[1]).map(([k, v]) => (
                <span key={k} className="mono" style={{ fontSize: 11, padding: "3px 9px", borderRadius: 100, background: "#F4F6FA", color: "var(--steel)" }}>{k}: <b style={{ color: "var(--navy)" }}>{v}</b></span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 170px" }}><Field label="Drop site">
              <Picker value={f.site} onChange={pickDrop} disabled={!f.tripNo} placeholder={f.tripNo ? "Select drop…" : "Pick a trip first"} title="Drop site"
                options={tripDrops.map((d) => ({ value: d.site, label: `${d.site} · ${L(d.qty)}L` }))} /></Field></div>
            <div style={{ flex: "1 1 100px" }}><Field label="Date"><input type="date" value={f.dnDate} onChange={(e) => set("dnDate")(e.target.value)} /></Field></div>
          </div>
          {/* quantity loaded — at the top */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 150px" }}><Field label="Quantity loaded at depot (L)"><Num value={f.qtyLoaded} onChange={set("qtyLoaded")} placeholder="litres" /></Field></div>
            <div style={{ flex: "1 1 100px" }}><Field label="Density"><Num value={f.density} onChange={set("density")} placeholder="0.836" /></Field></div>
          </div>

          {/* truck compartments */}
          <div className="lbl" style={{ marginTop: 4 }}>Truck compartments — dip</div>
          {comps.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input style={{ flex: "0 0 46px" }} value={c.comp} onChange={(e) => setComp(i, "comp", e.target.value)} placeholder="C#" />
              <input style={{ flex: 1 }} inputMode="decimal" value={c.mm} onChange={(e) => setComp(i, "mm", e.target.value.replace(/[^\d.]/g, ""))} placeholder="mm" />
              <input style={{ flex: 1 }} inputMode="decimal" value={c.litres} onChange={(e) => setComp(i, "litres", e.target.value.replace(/[^\d.]/g, ""))} placeholder="litres" />
              <input style={{ flex: "0 0 56px" }} inputMode="decimal" value={c.temp} onChange={(e) => setComp(i, "temp", e.target.value.replace(/[^\d.]/g, ""))} placeholder="°C" />
              {comps.length > 1 && <button type="button" className="pill-ghost" style={{ padding: "8px 10px" }} onClick={() => setComps((cs) => cs.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
          <button type="button" className="pill-ghost" style={{ width: "100%", marginBottom: 6 }} onClick={() => setComps((cs) => [...cs, { comp: String(cs.length + 1), mm: "", litres: "", temp: "" }])}>+ Compartment</button>
          <div className="mono" style={{ fontSize: 12, textAlign: "right", color: "var(--steel)", marginBottom: 12 }}>Truck dip total: <b>{L(truckDip)} L</b></div>

          {/* site tanks — opening / closing dips */}
          <div className="lbl">Site tanks — opening &amp; closing dip {f.site ? `at ${f.site}` : ""}</div>
          {tanks.length === 0 ? <div style={{ fontSize: 12, color: "var(--steel)", marginBottom: 10 }}>Choose a site to load its tanks.</div> :
            tanks.map((t, i) => (
              <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: "var(--navy)" }}>{t.tank}</span>
                  <span className="mono" style={{ fontSize: 12, color: "var(--ok)" }}>+{L(deliveredOf(t))} L</span>
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input style={{ flex: 1 }} inputMode="decimal" value={t.openMm} onChange={(e) => setTank(i, "openMm", e.target.value.replace(/[^\d.]/g, ""))} placeholder="open mm" />
                  <input style={{ flex: 1 }} inputMode="decimal" value={t.openL} onChange={(e) => setTank(i, "openL", e.target.value.replace(/[^\d.]/g, ""))} placeholder="open L" />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input style={{ flex: 1 }} inputMode="decimal" value={t.closeMm} onChange={(e) => setTank(i, "closeMm", e.target.value.replace(/[^\d.]/g, ""))} placeholder="close mm" />
                  <input style={{ flex: 1 }} inputMode="decimal" value={t.closeL} onChange={(e) => setTank(i, "closeL", e.target.value.replace(/[^\d.]/g, ""))} placeholder="close L" />
                  <input style={{ flex: "0 0 56px" }} inputMode="decimal" value={t.temp} onChange={(e) => setTank(i, "temp", e.target.value.replace(/[^\d.]/g, ""))} placeholder="°C" />
                </div>
              </div>))}
          <div className="mono" style={{ fontSize: 12, textAlign: "right", color: "var(--navy)", margin: "2px 0 10px" }}>Delivered (site dip): <b>{L(siteDip)} L</b></div>
          {preview && (
            <Note tone={preview.adjPct > 0.3 ? "red" : "ok"} title={`Loss ${L(preview.adj)} L · ${preview.adjPct}% (temp-corrected)`}>
              Raw {L(preview.raw)} L ({preview.rawPct}%) → corrected to 20 °C using density {f.density || "—"}. {preview.adjPct > 0.3 ? "Above the 0.3% benchmark — will be flagged." : "Within benchmark."}
            </Note>
          )}
          <Field label="Notes (optional)"><input value={f.note} onChange={(e) => set("note")(e.target.value)} /></Field>
          <button className="pill" disabled={busy} style={{ width: "100%" }}>{busy ? "Submitting…" : "Submit for approval"}</button>
          <div style={{ fontSize: 11, color: "var(--steel)", textAlign: "center", marginTop: 8 }}>The DN number is generated automatically. Both driver and site must approve before it posts.</div>
        </form>
      </Panel>
    </Wrap>
  );
}

/* Dual approval — driver and receiving site each sign off a delivery note
   before it posts. Shows the full note (tank dips, losses) for review. */
export function DeliveryApprovals({ me }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);   // dnNo expanded
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const load = useCallback(() => { setLoadErr(null); getPendingDeliveries().then((r) => setList(r.deliveries || [])).catch((e) => { setList(null); setLoadErr(e.message || "Couldn't load the approval queue."); }); }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (dn, outcome) => {
    setBusy(dn + outcome); setMsg(null);
    try { await approveDelivery(dn, { outcome }); setMsg({ tone: outcome === "approved" ? "ok" : "amber", title: outcome === "approved" ? `${dn} approved` : `${dn} sent back` }); load(); setOpen(null); }
    catch (e) { setMsg({ tone: "red", title: "Failed", body: e.message }); }
    finally { setBusy(""); }
  };
  return (
    <Wrap>
      <SectionHead title="Approve deliveries" sub="Sign off delivery notes before they post" />
      {msg && <Note tone={msg.tone} title={msg.title}>{msg.body}</Note>}
      {loadErr && <Note tone="red" title="Couldn't load the queue">{loadErr} <button type="button" className="pill-ghost" style={{ marginTop: 8, padding: "6px 14px" }} onClick={load}>Retry</button></Note>}
      {loadErr ? null :
        list == null ? <Panel><div style={{ color: "var(--steel)" }}>Loading…</div></Panel> :
        list.length === 0 ? <Panel><div style={{ color: "var(--steel)", fontSize: 14 }}>Nothing waiting on you. 🎉</div></Panel> :
          list.map((d) => (
            <Panel key={d.dnNo} style={{ marginBottom: 10, padding: 0, overflow: "hidden" }}>
              <button type="button" onClick={() => setOpen(open === d.dnNo ? null : d.dnNo)} style={{ width: "100%", textAlign: "left", background: "#fff", border: "none", padding: "13px 15px", cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="mono" style={{ fontWeight: 700, color: "var(--navy)" }}>{d.dnNo}</span>
                  <span className="mono" style={{ fontSize: 13 }}>{L(d.siteDip)} L {d.commodity}</span>
                </div>
                <div className="mono" style={{ fontSize: 12, color: "var(--steel)", marginTop: 3 }}>{d.site} · {d.truck || "—"}{d.tripNo ? " · " + d.tripNo : ""} · {d.date}</div>
                <div style={{ fontSize: 11, color: "var(--steel)", marginTop: 2 }}>{d.approvals?.driver ? "✓ driver" : "◦ driver"} · {d.approvals?.site ? "✓ site" : "◦ site"} — tap to review</div>
              </button>
              {open === d.dnNo && (
                <div style={{ padding: "0 15px 14px", borderTop: "1px solid var(--line)" }}>
                  <div className="mono" style={{ fontSize: 12, color: "var(--steel)", margin: "10px 0 8px" }}>
                    Loaded {L(d.qtyLoaded)}L · truck dip {L(d.truckDip)}L · delivered {L(d.siteDip)}L · density {d.density ?? "—"}<br />
                    Loss {L(d.combinedLoss)}L · temp-corrected {d.adjustedLossPct ?? "—"}%
                  </div>
                  <div className="lbl" style={{ marginBottom: 4 }}>Tank dips</div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Tank</Th><Th right>Open</Th><Th right>Close</Th><Th right>Delivered</Th><Th right>°C</Th></tr></thead>
                      <tbody>{(d.siteTanks || []).map((t, i) => (
                        <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                          <Td style={{ fontWeight: 600 }}>{t.tank}</Td>
                          <Td right style={{ color: "var(--steel)" }}>{t.openMm}mm / {L(t.openL)}L</Td>
                          <Td right style={{ color: "var(--steel)" }}>{t.closeMm}mm / {L(t.closeL)}L</Td>
                          <Td right style={{ fontWeight: 700, color: "var(--ok)" }}>{L(t.deliveredL)}L</Td>
                          <Td right style={{ color: "var(--steel)" }}>{t.temp || "—"}</Td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button className="pill pill-lime" disabled={!!busy} onClick={() => act(d.dnNo, "approved")}>{busy === d.dnNo + "approved" ? "…" : "Approve"}</button>
                    <button className="pill-ghost" disabled={!!busy} style={{ flex: "0 0 auto", color: "var(--red)", borderColor: "var(--red)" }} onClick={() => act(d.dnNo, "rejected")}>Reject</button>
                  </div>
                </div>
              )}
            </Panel>
          ))}
    </Wrap>
  );
}

const emptyLine = () => ({ product: "Diesel", litres: "" });
export function ReconSubmit({ me }) {
  const [warehouse, setWarehouse] = useState("Msasa");
  const [date, setDate] = useState(todayISO());
  const [opening, setOpening] = useState([{ product: "Petrol", litres: "" }, { product: "Diesel", litres: "" }]);
  const [receipts, setReceipts] = useState([]);
  const [dispatched, setDispatched] = useState([]);
  const [closing, setClosing] = useState([{ product: "Petrol", litres: "" }, { product: "Diesel", litres: "" }]);
  const [inTransit, setInTransit] = useState([{ product: "Petrol", litres: "" }, { product: "Diesel", litres: "" }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // opening = the previous count's closing (auto), so reconciliation is low-friction
  useEffect(() => {
    getWarehouseConfig(warehouse).then((c) => {
      if (c.lastClosing?.length) setOpening(c.lastClosing.map((x) => ({ product: x.product, litres: x.litres })));
      if (c.lastInTransit?.length) setInTransit(c.lastInTransit.map((x) => ({ product: x.product, litres: x.litres })));
    }).catch(() => {});
  }, [warehouse]);

  // live reconciliation: opening + receipts − dispatched  vs  counted closing
  const recon = useMemo(() => {
    const sum = (arr) => arr.reduce((a, r) => a + (Number(r.litres) || 0), 0);
    const theoretical = sum(opening) + sum(receipts) - sum(dispatched);
    const counted = sum(closing);
    const diff = counted - theoretical;
    return { theoretical, counted, diff, status: Math.abs(diff) <= 500 ? "balanced" : "discrepancy" };
  }, [opening, receipts, dispatched, closing]);

  const send = async (e) => {
    e.preventDefault(); setMsg(null); setBusy(true);
    const clean = (arr, keys) => arr.map((r) => Object.fromEntries(keys.map((k) => [k, ["product", "supplier"].includes(k) ? r[k] : (r[k] === "" ? null : Number(r[k]))]))).filter((r) => r.litres);
    try {
      await postRecon({
        warehouse, tradingDate: date,
        opening: clean(opening, ["product", "litres"]),
        receipts: clean(receipts, ["product", "trucks", "litres", "supplier"]),
        deliveries: clean(dispatched, ["product", "litres", "truck_plate"]),
        closing: clean(closing, ["product", "litres"]),
        inTransit: clean(inTransit, ["product", "litres"]),
        deviceTime: new Date().toISOString(),
      });
      setMsg({ tone: "ok", title: "Warehouse updated", body: `${warehouse} · ${date}` });
    } catch (err) { setMsg({ tone: "red", title: "Not submitted", body: err.message }); }
    finally { setBusy(false); }
  };

  return (
    <Wrap>
      <SectionHead title="Warehouse" sub="Yard stock, in-transit, and the daily reconciliation" />
      {(me?.kind === "logistics" || me?.kind === "depot") && <ReminderBar me={me} />}
      <Panel>
        <form onSubmit={send}>
          {msg && <Note tone={msg.tone} title={msg.title}>{msg.body}</Note>}
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><Field label="Warehouse">
              <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>{["Msasa", "Feruka", "Bulawayo"].map((w) => <option key={w}>{w}</option>)}</select></Field></div>
            <div style={{ flex: 1 }}><Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
          </div>
          <LineGroup title="Opening (auto — yesterday's closing)" rows={opening} setRows={setOpening} cols={[["product", "Product", "product"], ["litres", "Litres", "num"]]} make={emptyLine} />
          <LineGroup title="Receipts in" rows={receipts} setRows={setReceipts} cols={[["product", "Product", "product"], ["trucks", "Trucks", "num"], ["litres", "Litres", "num"], ["supplier", "Supplier", "text"]]} make={() => ({ product: "Petrol", trucks: "", litres: "", supplier: "" })} />
          <LineGroup title="Dispatched to trucks" rows={dispatched} setRows={setDispatched} cols={[["product", "Product", "product"], ["litres", "Litres", "num"], ["truck_plate", "Plate", "text"]]} make={() => ({ product: "Diesel", litres: "", truck_plate: "" })} />
          <LineGroup title="Closing — counted in the yard" rows={closing} setRows={setClosing} cols={[["product", "Product", "product"], ["litres", "Litres", "num"]]} make={emptyLine} />
          <Note tone={recon.status === "balanced" ? "ok" : "red"} title={`Reconciliation: ${recon.status}`}>
            Opening + receipts − dispatched = <b>{L(recon.theoretical)}</b> vs counted <b>{L(recon.counted)}</b> · diff <b>{L(recon.diff)} L</b>
          </Note>
          <LineGroup title="Goods in transit — in trucks now" rows={inTransit} setRows={setInTransit} cols={[["product", "Product", "product"], ["litres", "Litres", "num"]]} make={emptyLine} />
          <div style={{ fontSize: 11, color: "var(--steel)", margin: "-6px 2px 14px" }}>Delivery notes automatically reduce goods-in-transit.</div>
          {submitBtn(busy, "Update warehouse")}
        </form>
      </Panel>
    </Wrap>
  );
}

// Firm-wide inventory: warehouses → trucks → sites.
export function InventoryView() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const { tab, setTab, back, prev } = useNavStack("warehouses");
  const SECTIONS = [["warehouses", "By depot"], ["trucks", "On trucks"], ["sites", "By site"]];
  const [drill, setDrill] = useState(null);
  useEffect(() => { getInventory().then(setD).catch((e) => setErr(e.message)); }, []);
  const PROD_COL = { Diesel: "#2B3990", Blend: "#C07A00", ULP: "#6BC048" };
  // inbound trucks heading to a given site (goods in transit)
  const inboundTo = (siteName) => (d?.trucks || []).filter((t) => (t.to || []).some((x) => String(x).toLowerCase() === String(siteName).toLowerCase()));
  const siteDrill = (s) => () => {
    const inbound = inboundTo(s.site);
    return (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
          <Stat label="Blend" value={L(s.blend)} unit="L" />
          <Stat label="Diesel" value={L(s.diesel)} unit="L" />
          <Stat label="Total" value={L(s.total)} unit="L" tone={s.total < 5000 ? "red" : undefined} />
        </div>
        <Panel style={{ padding: 0, overflow: "hidden" }}>
          <div className="lbl" style={{ padding: "12px 14px 6px" }}>Inbound — fuel on its way here</div>
          {inbound.length === 0 ? <div style={{ color: "var(--steel)", fontSize: 13, padding: "0 14px 12px" }}>Nothing in transit to this site right now.</div> :
            <div style={{ overflowX: "auto" }}>
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Truck</Th><Th>Trip</Th><Th>Product</Th><Th right>Litres</Th></tr></thead>
                <tbody>{inbound.map((t) => (
                  <tr key={t.tripNo} style={{ borderTop: "1px solid var(--line)" }}>
                    <Td style={{ fontWeight: 700, color: "var(--navy)" }}>{t.truck}</Td>
                    <Td style={{ color: "var(--steel)" }}>{t.tripNo}</Td>
                    <Td>{t.product}</Td>
                    <Td right style={{ fontWeight: 700 }}>{L(t.litres)}</Td>
                  </tr>
                ))}</tbody>
              </table>
            </div>}
        </Panel>
        {s.total < 5000 && inbound.length === 0 && <Note tone="amber" title="Low and nothing inbound">This site is under 5,000 L with no delivery scheduled — consider dispatching.</Note>}
      </>
    );
  };
  return (
    <div className="wrap">
      <SectionHead title="Inventory" sub="A running record — every litre the firm holds" />
      {err && <Note tone="red" title="Could not load">{err}</Note>}
      {!d && !err && <Panel><div style={{ color: "var(--steel)" }}>Loading…</div></Panel>}
      {d && (
        <>
          <div style={{ marginBottom: 14 }}>
            <Hero label="TOTAL FUEL ON HAND" value={compact(d.grandTotal)} unit="L"
              sub={d.grandValue ? `≈ $${compact(d.grandValue)} working capital · at landed cost` : "depots + transit + sites"} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 14 }}>
            <Stat label="At depots" value={compact(d.warehouseTotal)} unit="L" sub={d.warehouseValue ? `$${compact(d.warehouseValue)} · ${d.warehouses.length} depots` : `${d.warehouses.length} warehouses`} />
            <Stat label="In transit" value={compact(d.transitNow)} unit="L" tone="amber" sub={d.transitValue ? `$${compact(d.transitValue)} · on trucks` : "on trucks"} />
            <Stat label="At sites" value={compact(d.sitesTotal)} unit="L" sub={d.sitesValue ? `$${compact(d.sitesValue)} · ${d.siteCount} sites` : `${d.siteCount} sites`} />
          </div>
          <Segmented value={tab} onChange={setTab} options={SECTIONS} />
          <BackBar prev={prev} options={SECTIONS} onBack={back} />
          {tab === "warehouses" && (
            <Panel style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Warehouse</Th><Th right>Diesel</Th><Th right>Blend</Th><Th right>ULP</Th><Th right>In transit</Th><Th right>Total</Th></tr></thead>
                  <tbody>{d.warehouses.map((w) => (
                    <Fragment key={w.name}>
                      <tr style={{ borderTop: "1px solid var(--line)" }}>
                        <Td style={{ fontWeight: 600, color: "var(--navy)" }}>{w.name}</Td>
                        <Td right>{L(w.products.Diesel)}</Td>
                        <Td right style={{ color: w.products.Blend < 0 ? "var(--red)" : undefined }}>{L(w.products.Blend)}</Td>
                        <Td right style={{ color: w.products.ULP < 0 ? "var(--red)" : undefined }}>{L(w.products.ULP)}</Td>
                        <Td right style={{ color: "var(--steel)" }}>{w.transit > 0 ? L(w.transit) : "—"}</Td>
                        <Td right style={{ fontWeight: 700, color: w.stock < 0 ? "var(--red)" : "var(--navy)" }}>{L(w.stock)}</Td>
                      </tr>
                      {w.productAsOf && ["Diesel", "Blend", "ULP"].some((p) => w.productAsOf[p]) && (
                        <tr><td colSpan={6} style={{ fontSize: 10.5, padding: "0 11px 7px 14px" }}>
                          <span style={{ color: "var(--steel)" }}>counted: </span>
                          {["Diesel", "Blend", "ULP"].filter((p) => w.productAsOf[p]).map((p, i) => {
                            const stale = (new Date() - new Date(w.productAsOf[p])) > 45 * 864e5;
                            return <span key={p} style={{ color: stale ? "var(--red)" : "var(--steel)", fontWeight: stale ? 700 : 400 }}>{i > 0 ? "  ·  " : ""}{p} {fmtD(w.productAsOf[p])}{stale ? " ⚠ stale" : ""}</span>;
                          })}
                        </td></tr>
                      )}
                    </Fragment>
                  ))}</tbody>
                </table>
              </div>
              {d.warehouses.some((w) => w.stock < 0) && <div style={{ fontSize: 11, color: "var(--red)", padding: "8px 14px 12px" }}>Negative bucket — set an opening stocktake in the Warehouse tab.</div>}
            </Panel>
          )}
          {tab === "trucks" && (
            <Panel style={{ padding: 0, overflow: "hidden" }}>
              {(d.trucks || []).length === 0 ? <div style={{ color: "var(--steel)", fontSize: 13, padding: "14px" }}>No fuel in transit right now.</div> : (
                <div style={{ overflowX: "auto" }}>
                  <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Truck</Th><Th>Trip</Th><Th>Product</Th><Th right>Litres</Th><Th>Route</Th></tr></thead>
                    <tbody>{d.trucks.map((t) => (
                      <tr key={t.tripNo} style={{ borderTop: "1px solid var(--line)" }}>
                        <Td style={{ fontWeight: 600, color: "var(--navy)" }}>{t.truck}</Td>
                        <Td style={{ color: "var(--steel)" }}>{t.tripNo}</Td>
                        <Td style={{ color: PROD_COL[t.product] }}>{t.product}</Td>
                        <Td right style={{ fontWeight: 700 }}>{L(t.litres)}</Td>
                        <Td style={{ color: "var(--steel)" }}>{t.from} → {(t.to || []).join(", ")}</Td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}
          {tab === "sites" && (
            <Panel style={{ padding: 0, overflow: "hidden" }}>
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Site</Th><Th right>Blend</Th><Th right>Diesel</Th><Th right>Total</Th></tr></thead>
                <tbody>{d.sites.map((s) => (
                  <tr key={s.site} onClick={() => setDrill({ title: s.site, sub: "Stock & inbound deliveries", render: siteDrill(s) })}
                    style={{ borderTop: "1px solid var(--line)", background: s.total < 5000 ? "#FDECEA" : "#fff", cursor: "pointer" }}>
                    <Td>{s.site}</Td><Td right>{L(s.blend)}</Td><Td right>{L(s.diesel)}</Td>
                    <Td right style={{ fontWeight: 700, color: s.total < 5000 ? "var(--red)" : undefined }}>{L(s.total)} ›</Td>
                  </tr>
                ))}</tbody>
              </table>
            </Panel>
          )}
        </>
      )}
      {drill && <DetailSheet title={drill.title} sub={drill.sub} onClose={() => setDrill(null)}>{drill.render()}</DetailSheet>}
    </div>
  );
}

/* Schedule delivery — logistics sets up a trip: fuel taken from a warehouse, a
   truck + driver, and the sites to drop at with a quantity each. Scheduling the
   trip moves the fuel to goods-in-transit and puts a pending trip on the
   driver's profile. The system generates the trip number. */
export function ScheduleDelivery({ me, drivers = [], horses = [] }) {
  const [sites, setSites] = useState([]);
  const [trips, setTrips] = useState([]);
  const [bal, setBal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [f, setF] = useState({ warehouse: "Msasa", product: "Diesel", tripDate: todayISO(), driverCard: "", truckName: "", truckReg: "", trailer: "" });
  const [drops, setDrops] = useState([{ site: "", qty: "" }]);
  const [editing, setEditing] = useState(null);   // tripNo being edited, or null
  const [cancelling, setCancelling] = useState(null); // tripNo being cancelled
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const resetForm = () => { setEditing(null); setF({ warehouse: "Msasa", product: "Diesel", tripDate: todayISO(), driverCard: "", truckName: "", truckReg: "", trailer: "" }); setDrops([{ site: "", qty: "" }]); };
  const startEdit = (t) => {
    setMsg(null); setEditing(t.tripNo);
    setF({ warehouse: t.warehouse, product: t.product, tripDate: t.date || todayISO(), driverCard: t.driverCard || "", truckName: t.truck || "", truckReg: t.truckReg || "", trailer: t.trailer || "" });
    setDrops((t.drops && t.drops.length ? t.drops : [{ site: "", qty: "" }]).map((d) => ({ site: d.site, qty: String(d.qty) })));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const doCancel = async (t) => {
    setCancelling(t.tripNo); setMsg(null);
    try { await cancelTrip(t.tripNo); setMsg({ tone: "ok", title: `Trip ${t.tripNo} cancelled`, body: "It's off the schedule and the fuel is back in the warehouse." }); if (editing === t.tripNo) resetForm(); load(); }
    catch (x) { setMsg({ tone: "red", title: "Couldn't cancel", body: x.message }); }
    finally { setCancelling(null); }
  };
  const load = useCallback(() => {
    getSites().then((r) => setSites(r.sites || [])).catch((e) => window.dispatchEvent(new CustomEvent("da-load-error", { detail: "Couldn't load sites — " + (e.message || "tap refresh.") })));
    getTrips().then((r) => setTrips(r.trips || [])).catch((e) => window.dispatchEvent(new CustomEvent("da-load-error", { detail: "Couldn't load scheduled trips — " + (e.message || "tap refresh.") })));
    getWarehouseBalances().then(setBal).catch((e) => window.dispatchEvent(new CustomEvent("da-load-error", { detail: "Couldn't load depot stock (over-stock guard off) — " + (e.message || "tap refresh.") })));
  }, []);
  useEffect(() => { load(); }, [load]);

  const dropTotal = drops.reduce((a, d) => a + (Number(d.qty) || 0), 0);
  const whStock = bal?.warehouses.find((w) => w.name === f.warehouse)?.products?.[f.product] ?? null;
  const overStock = whStock != null && dropTotal > whStock;
  const setDrop = (i, k, v) => setDrops((ds) => ds.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const valid = f.driverCard && drops.some((d) => d.site && Number(d.qty) > 0) && !overStock;

  const send = async (e) => {
    e.preventDefault(); setMsg(null);
    if (!f.driverCard) return setMsg({ tone: "amber", title: "Almost there", body: "Pick the driver for this trip." });
    if (!drops.some((d) => d.site && Number(d.qty) > 0)) return setMsg({ tone: "amber", title: "Almost there", body: "Add at least one drop site with litres." });
    if (overStock) return setMsg({ tone: "amber", title: "Not enough stock", body: `The drops (${L(dropTotal)} L) exceed ${f.warehouse} ${f.product} available (${L(whStock)} L).` });
    setBusy(true);
    try {
      const clean = drops.filter((d) => d.site && Number(d.qty) > 0).map((d) => ({ site: d.site, qty: Number(d.qty) }));
      const payload = { ...f, qty: dropTotal, drops: clean, deviceTime: new Date().toISOString() };
      if (editing) {
        await editTrip(editing, payload);
        setMsg({ tone: "ok", title: `Trip ${editing} updated`, body: `${L(dropTotal)} L ${f.product} · ${clean.length} drop${clean.length === 1 ? "" : "s"}` });
        resetForm();
      } else {
        const r = await postTrip(payload);
        setMsg({ tone: "ok", title: `Trip ${r.tripNo} scheduled`, body: `${L(dropTotal)} L ${f.product} · ${clean.length} drop${clean.length === 1 ? "" : "s"}` });
        setDrops([{ site: "", qty: "" }]);
      }
      load();
    } catch (x) { setMsg({ tone: "red", title: editing ? "Couldn't update" : "Not scheduled", body: x.message }); }
    finally { setBusy(false); }
  };
  const STAT = { scheduled: ["#C07A00", "#FEF4E6"], in_progress: ["#2B3990", "#EAEEFB"], delivered: ["#4C9E2A", "#EBF6E7"] };
  return (
    <Wrap>
      <SectionHead title="Schedule delivery" sub="Set up a trip — the driver sees it as a pending job" />
      <Panel style={{ marginBottom: 14 }}>
        <form onSubmit={send}>
          {editing && <Note tone="blue" title={`Editing ${editing}`}>Change anything below and save. <button type="button" className="pill-ghost" style={{ marginTop: 8, padding: "6px 14px" }} onClick={resetForm}>Cancel edit</button></Note>}
          {msg && <Note tone={msg.tone} title={msg.title}>{msg.body}</Note>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 150px" }}><Field label="From warehouse"><Picker value={f.warehouse} onChange={set("warehouse")} options={["Msasa", "Feruka"]} /></Field></div>
            <div style={{ flex: "1 1 150px" }}><Field label="Product"><Picker value={f.product} onChange={set("product")} options={["Diesel", "Blend", "ULP"]} /></Field></div>
          </div>
          {whStock != null && <div className="mono" style={{ fontSize: 11, color: overStock ? "var(--red)" : "var(--steel)", marginTop: -6, marginBottom: 10 }}>{f.warehouse} {f.product} available: <b>{L(whStock)} L</b>{overStock ? " — drops exceed this" : ""}</div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 160px" }}><Field label="Driver"><Picker value={f.driverCard} onChange={set("driverCard")} placeholder="Select driver…" title="Driver" options={drivers.map((d) => ({ value: d.card, label: d.name }))} /></Field></div>
            <div style={{ flex: "1 1 120px" }}><Field label="Truck"><Picker value={f.truckName} title="Truck" placeholder="Truck…"
              onChange={(v) => { const h = horses.find((x) => x.code === v); setF((s) => ({ ...s, truckName: v, trailer: h?.trailer || s.trailer })); }}
              options={horses.map((h) => h.code)} /></Field></div>
            <div style={{ flex: "1 1 120px" }}><Field label="Trip date"><input type="date" value={f.tripDate} onChange={(e) => set("tripDate")(e.target.value)} /></Field></div>
          </div>
          {f.truckName && f.trailer && <div className="mono" style={{ fontSize: 11, color: "var(--steel)", marginTop: -4, marginBottom: 10 }}>{f.truckName} · trailer {f.trailer} <span style={{ color: "#9AA6B8" }}>(from master data)</span></div>}
          {/* drops */}
          <div className="lbl" style={{ marginBottom: 6 }}>Drops — site &amp; litres</div>
          {drops.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <div style={{ flex: 2, minWidth: 0 }}><Picker value={d.site} onChange={(v) => setDrop(i, "site", v)} placeholder="Site…" title="Drop site" options={sites.map((s) => s.name)} /></div>
              <input style={{ flex: 1 }} inputMode="decimal" placeholder="litres" value={d.qty} onChange={(e) => setDrop(i, "qty", e.target.value.replace(/[^\d.]/g, ""))} />
              {drops.length > 1 && <button type="button" className="pill-ghost" style={{ padding: "8px 11px" }} onClick={() => setDrops((ds) => ds.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
          <button type="button" className="pill-ghost" style={{ width: "100%", marginBottom: 12 }} onClick={() => setDrops((ds) => [...ds, { site: "", qty: "" }])}>+ Add drop</button>
          <div className="mono" style={{ fontSize: 13, textAlign: "right", marginBottom: 10, color: "var(--navy)" }}>Load total: <b>{L(dropTotal)} L</b></div>
          <button className="pill" disabled={busy} style={{ width: "100%" }}>{busy ? (editing ? "Saving…" : "Scheduling…") : (editing ? "Save changes" : "Schedule trip")}</button>
        </form>
      </Panel>
      {/* recent trips */}
      <Panel style={{ padding: 0, overflow: "hidden" }}>
        <div className="lbl" style={{ padding: "12px 14px 6px" }}>Recent trips</div>
        {trips.length === 0 ? <div style={{ padding: "0 14px 14px", color: "var(--steel)", fontSize: 13 }}>No trips scheduled yet.</div> :
          trips.map((t) => {
            const c = STAT[t.status] || STAT.scheduled;
            return (
              <div key={t.tripNo} style={{ padding: "11px 14px", borderTop: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span className="mono" style={{ fontWeight: 700, color: "var(--navy)" }}>{t.tripNo}</span>
                  <span className="disp" style={{ fontSize: 11, fontWeight: 700, color: c[0], background: c[1], padding: "2px 8px", borderRadius: 100 }}>{t.status.replace("_", " ")}</span>
                </div>
                <div className="mono" style={{ fontSize: 12, color: "var(--steel)", marginTop: 3 }}>
                  {t.date} · {t.warehouse} → {L(t.qty)}L {t.product} · {t.driver || "—"}{t.truck ? " · " + t.truck : ""}
                </div>
                <div style={{ fontSize: 11, color: "var(--steel)", marginTop: 2 }}>{(t.drops || []).map((d) => `${d.site} ${L(d.qty)}L`).join(" · ")}</div>
                {/* logistics can amend/cancel a trip until deliveries start */}
                {t.status === "scheduled" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
                    <button type="button" className="pill-ghost" style={{ padding: "6px 14px", fontSize: 12 }} onClick={() => startEdit(t)}>Edit</button>
                    <button type="button" className="pill-ghost" disabled={cancelling === t.tripNo} style={{ padding: "6px 14px", fontSize: 12, color: "var(--red)", borderColor: "var(--red)" }} onClick={() => doCancel(t)}>{cancelling === t.tripNo ? "Cancelling…" : "Cancel"}</button>
                  </div>
                )}
              </div>
            );
          })}
      </Panel>
    </Wrap>
  );
}

/* Warehouse imports + running balance — replaces the manual reconciliation. The
   logistics team logs each fuel purchase into a warehouse; the balance is a
   running record (opening + imports − dispatched). */
// Full detail behind one recorded import (purchase).
function importDetail(imp) {
  const row = (label, val) => (
    <tr style={{ borderTop: "1px solid var(--line)" }}><Td style={{ color: "var(--steel)" }}>{label}</Td><Td right>{val}</Td></tr>
  );
  const m = (v) => (v == null ? "—" : "$" + Number(v).toFixed(3));
  return () => (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        <Stat label="Litres" value={L(imp.quantity)} />
        <Stat label="$/L incl" value={imp.priceIncl != null ? m(imp.priceIncl) : "—"} />
        <Stat label="Value" value={imp.value != null ? "$" + compact(imp.value) : "—"} tone="ok" />
      </div>
      <Panel style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {row("Supplier", imp.supplier || "—")}
              {row("Product", imp.product)}
              {row("Warehouse", imp.warehouse)}
              {row("Date", fmtD(imp.date))}
              {row("Price excl. duty", m(imp.priceExcl))}
              {row("Duty", m(imp.duties))}
              {row("Price incl. duty", m(imp.priceIncl))}
              {imp.orderNo && row("Order no.", imp.orderNo)}
            </tbody>
          </table>
        </div>
      </Panel>
      {imp.note && <Panel style={{ marginTop: 12 }}><div className="lbl" style={{ marginBottom: 4 }}>Note</div><div style={{ fontSize: 13 }}>{imp.note}</div></Panel>}
    </>
  );
}
// A depot's product split + its recent imports.
function depotDetail(w, imports) {
  const mine = (imports || []).filter((i) => i.warehouse === w.name);
  return () => (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        {["Diesel", "Blend", "ULP"].map((p) => <Stat key={p} label={p} value={L(w.products[p])} unit="L" />)}
      </div>
      <Panel style={{ padding: 0, overflow: "hidden" }}>
        <div className="lbl" style={{ padding: "12px 14px 6px" }}>Recent imports here</div>
        {mine.length === 0 ? <div style={{ padding: "0 14px 14px", color: "var(--steel)", fontSize: 13 }}>No imports logged for this depot yet.</div> : (
          <div style={{ overflowX: "auto" }}>
          <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Date</Th><Th>Product</Th><Th right>Litres</Th><Th right>$/L</Th></tr></thead>
            <tbody>{mine.map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                <Td>{r.date}</Td><Td>{r.product}</Td><Td right>{L(r.quantity)}</Td><Td right>{r.priceIncl != null ? r.priceIncl.toFixed(3) : "—"}</Td>
              </tr>
            ))}</tbody>
          </table>
          </div>
        )}
      </Panel>
    </>
  );
}

export function WarehouseImports({ me }) {
  const SUP = ["Opening balance", "Trafigura", "Kemexon", "Strauss", "Glencore", "Other"];
  const [bal, setBal] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [drill, setDrill] = useState(null);
  const [f, setF] = useState({ warehouse: "Msasa", product: "Diesel", supplier: "Trafigura", importDate: todayISO(), quantity: "", priceExcl: "", duties: "", orderNo: "", petrolPrice: "", blendRatio: "0.2", ethanolPrice: "1.10" });
  const isBlend = f.product === "Blend";
  const blendPrice = (Number(f.petrolPrice) || 0) * (1 - (Number(f.blendRatio) || 0)) + (Number(f.ethanolPrice) || 0) * (Number(f.blendRatio) || 0);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const load = useCallback(() => { getWarehouseBalances().then(setBal).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  const incl = (Number(f.priceExcl) || 0) + (Number(f.duties) || 0);
  const send = async (e) => {
    e.preventDefault(); setMsg(null);
    if (!f.supplier) return setMsg({ tone: "amber", title: "Almost there", body: "Pick a supplier (or “Opening balance”)." });
    if (!(Number(f.quantity) > 0)) return setMsg({ tone: "amber", title: "Almost there", body: "Enter the quantity received (litres)." });
    if (isBlend && !(Number(f.petrolPrice) > 0)) return setMsg({ tone: "amber", title: "Almost there", body: "Enter the petrol price so the blend cost can be worked out." });
    setBusy(true);
    try {
      await postWarehouseImport({ ...f, quantity: Number(f.quantity), deviceTime: new Date().toISOString() });
      setMsg({ tone: "ok", title: "Import recorded", body: `${L(Number(f.quantity))} L ${f.product} into ${f.warehouse}` });
      setF((s) => ({ ...s, quantity: "", orderNo: "" }));
      load();
    } catch (x) { setMsg({ tone: "red", title: "Not saved", body: x.message }); }
    finally { setBusy(false); }
  };
  const PROD_COL = { Diesel: "#2B3990", Blend: "#C07A00", ULP: "#6BC048" };
  return (
    <Wrap>
      <SectionHead title="Warehouse" sub="Record fuel imports · running balance per depot" />
      {/* running balances */}
      {err && <Note tone="red" title="Could not load balances">{err}</Note>}
      {bal && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 16 }}>
          {bal.warehouses.map((w) => (
            <div key={w.name} className="card" role="button" tabIndex={0}
              onClick={() => setDrill({ title: w.name, sub: `${compact(w.stock)} L on hand`, render: depotDetail(w, bal.recentImports) })}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrill({ title: w.name, sub: `${compact(w.stock)} L on hand`, render: depotDetail(w, bal.recentImports) }); } }}
              style={{ padding: "13px 15px", cursor: "pointer", position: "relative" }}>
              <span aria-hidden style={{ position: "absolute", top: 10, right: 12, color: "var(--steel)", opacity: .5 }}>›</span>
              <div className="lbl" style={{ marginBottom: 3 }}>{w.name}</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 600, color: w.stock < 0 ? "var(--red)" : "var(--navy)", lineHeight: 1 }}>{compact(w.stock)}<span style={{ fontSize: 12, color: "var(--steel)", marginLeft: 3 }}>L</span></div>
              <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
                {["Diesel", "Blend", "ULP"].map((p) => <span key={p} className="mono" style={{ fontSize: 11, padding: "1px 6px", borderRadius: 100, background: "#F4F6FA", color: PROD_COL[p] }}>{compact(w.products[p])}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}
      {/* import form */}
      <Panel style={{ marginBottom: 14 }}>
        <form onSubmit={send}>
          {msg && <Note tone={msg.tone} title={msg.title}>{msg.body}</Note>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 150px" }}><Field label="Warehouse"><Picker value={f.warehouse} onChange={set("warehouse")} options={["Msasa", "Feruka"]} /></Field></div>
            <div style={{ flex: "1 1 150px" }}><Field label="Product"><Picker value={f.product} onChange={set("product")} options={["Diesel", "Blend", "ULP"]} /></Field></div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 150px" }}><Field label="Supplier"><Picker value={f.supplier} onChange={set("supplier")} title="Supplier" options={SUP} /></Field></div>
            <div style={{ flex: "1 1 140px" }}><Field label="Date"><input type="date" value={f.importDate} onChange={(e) => set("importDate")(e.target.value)} /></Field></div>
          </div>
          <Field label="Quantity received (L)"><Num value={f.quantity} onChange={set("quantity")} placeholder="e.g. 400000" /></Field>
          {isBlend ? (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 110px" }}><Field label="Petrol incl-duty ($/L)"><Num value={f.petrolPrice} onChange={set("petrolPrice")} placeholder="2.107" /></Field></div>
                <div style={{ flex: "1 1 90px" }}><Field label="Ethanol ratio"><Num value={f.blendRatio} onChange={set("blendRatio")} placeholder="0.2" /></Field></div>
                <div style={{ flex: "1 1 100px" }}><Field label="Ethanol ($/L)"><Num value={f.ethanolPrice} onChange={set("ethanolPrice")} placeholder="1.10" /></Field></div>
              </div>
              {f.petrolPrice ? <div className="mono" style={{ fontSize: 12, color: "var(--steel)", marginTop: -6, marginBottom: 12 }}>Blend cost: <b style={{ color: "var(--navy)" }}>${blendPrice.toFixed(4)}/L</b> <span style={{ color: "var(--steel)" }}>= petrol ×{(1 - (Number(f.blendRatio) || 0)).toFixed(2)} + ethanol ×{f.blendRatio}</span> · total ${compact(blendPrice * (Number(f.quantity) || 0))}</div> : null}
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 120px" }}><Field label="Price ex-duty (US$/L)"><Num value={f.priceExcl} onChange={set("priceExcl")} placeholder="0.747" /></Field></div>
                <div style={{ flex: "1 1 120px" }}><Field label="Duties (US$/L)"><Num value={f.duties} onChange={set("duties")} placeholder="0.553" /></Field></div>
              </div>
              {(f.priceExcl || f.duties) ? <div className="mono" style={{ fontSize: 12, color: "var(--steel)", marginTop: -6, marginBottom: 12 }}>Landed cost: <b style={{ color: "var(--navy)" }}>${incl.toFixed(4)}/L</b> · total ${compact(incl * (Number(f.quantity) || 0))}</div> : null}
            </>
          )}
          <Field label="Order / invoice no. (optional)"><input value={f.orderNo} onChange={(e) => set("orderNo")(e.target.value)} placeholder="e.g. MBV 0215953" /></Field>
          <button className="pill" disabled={busy} style={{ width: "100%" }}>{busy ? "Saving…" : "Record import"}</button>
        </form>
      </Panel>
      {/* recent imports */}
      {bal && bal.recentImports.length > 0 && (
        <Panel style={{ padding: 0, overflow: "hidden" }}>
          <div className="lbl" style={{ padding: "12px 14px 6px" }}>Recent imports</div>
          <div style={{ overflowX: "auto" }}>
          <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Date</Th><Th>Depot</Th><Th>Product</Th><Th right>Litres</Th><Th right>$/L</Th></tr></thead>
            <tbody>{bal.recentImports.map((r, i) => (
              <tr key={i} onClick={() => setDrill({ title: `${r.supplier || "Import"} · ${r.product}`, sub: `${r.warehouse} · ${fmtD(r.date)}`, render: importDetail(r) })}
                style={{ borderTop: "1px solid var(--line)", cursor: "pointer" }}>
                <Td>{r.date}</Td><Td>{r.warehouse}</Td><Td>{r.product} ›</Td><Td right>{L(r.quantity)}</Td><Td right>{r.priceIncl != null ? r.priceIncl.toFixed(3) : "—"}</Td>
              </tr>
            ))}</tbody>
          </table>
          </div>
        </Panel>
      )}
      {drill && <DetailSheet title={drill.title} sub={drill.sub} onClose={() => setDrill(null)}>{drill.render()}</DetailSheet>}
    </Wrap>
  );
}

function LineGroup({ title, rows, setRows, cols, make }) {
  const set = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div style={{ marginBottom: 16 }}>
      <span className="lbl">{title}</span>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          {cols.map(([k, ph, type]) => type === "product" ? (
            <select key={k} style={{ flex: 1 }} value={r[k]} onChange={(e) => set(i, k, e.target.value)}>
              {["Petrol", "Diesel", "Ethanol", "Blend"].map((p) => <option key={p}>{p}</option>)}
            </select>
          ) : (
            <input key={k} style={{ flex: 1 }} inputMode={type === "num" ? "decimal" : "text"} placeholder={ph} value={r[k]} onChange={(e) => set(i, k, e.target.value)} />
          ))}
          <button type="button" className="pill-ghost" style={{ padding: "8px 11px" }} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="pill-ghost" style={{ width: "100%" }} onClick={() => setRows((rs) => [...rs, make()])}>+ Add row</button>
    </div>
  );
}

// Full dip/VCF/loss breakdown behind one delivery note.
function deliveryDetail(d) {
  const row = (label, val, extra) => (
    <tr style={{ borderTop: "1px solid var(--line)" }}><Td style={{ color: "var(--steel)" }}>{label}</Td><Td right style={extra}>{val}</Td></tr>
  );
  const grp = (title, rows) => (
    <Panel style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
      <div className="lbl" style={{ padding: "12px 14px 6px" }}>{title}</div>
      <div style={{ overflowX: "auto" }}>
        <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><tbody>{rows}</tbody></table>
      </div>
    </Panel>
  );
  const n = (v, u = " L") => (v == null ? "—" : L(v) + u);
  return () => (
    <>
      <div className="mono" style={{ fontSize: 12, color: "var(--steel)", marginBottom: 10 }}>{d.loadedFrom || "?"} → {d.deliveredTo || "?"} · {d.date || ""}{d.truckReg ? " · " + d.truckReg : ""}</div>
      {grp("Quantities", <>
        {row("Loaded at depot", n(d.qtyLoaded))}
        {row("Truck dip", n(d.truckDip))}
        {row("Site dip (received)", n(d.siteDip))}
        {d.density != null && row("Density", d.density + " kg/L")}
      </>)}
      {(d.truckTemp != null || d.siteTemp != null || d.truckCorrected != null) && grp("Temperature correction (ASTM D1250)", <>
        {d.truckTemp != null && row("Truck temp", d.truckTemp + " °C")}
        {d.siteTemp != null && row("Site temp", d.siteTemp + " °C")}
        {d.truckCorrected != null && row("Truck @ 20°C", n(d.truckCorrected))}
        {d.siteCorrected != null && row("Site @ 20°C", n(d.siteCorrected))}
      </>)}
      <Panel style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
        <div className="lbl" style={{ padding: "12px 14px 6px" }}>Loss</div>
        <div style={{ overflowX: "auto" }}>
          <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><tbody>
            {row("In transit", n(d.transitLoss))}
            {row("On discharge", n(d.dischargeLoss))}
            {row("Combined (raw)", n(d.combinedLoss) + (d.lossPct != null ? ` (${d.lossPct}%)` : ""), { fontWeight: 700 })}
            {d.adjustedLoss != null && row("Temp-adjusted", n(d.adjustedLoss) + (d.adjustedLossPct != null ? ` (${d.adjustedLossPct}%)` : ""), { fontWeight: 700, color: d.flagged ? "var(--red)" : "var(--ok)" })}
          </tbody></table>
        </div>
        <div style={{ fontSize: 11, color: "var(--steel)", padding: "6px 14px 10px" }}>{d.flagged ? "Above the 0.3% benchmark on the temperature-corrected figure — worth a look." : "Within the 0.3% benchmark — a hot load isn't a real loss."}</div>
      </Panel>
      {(d.receivedBy || d.notes || d.hasPhoto) && (
        <Panel>
          {(d.receivedBy || d.orderNo) && (
            <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: d.notes || d.hasPhoto ? 8 : 0 }}><tbody>
              {d.receivedBy && row("Received by", d.receivedBy)}
              {d.orderNo && row("Order no.", d.orderNo)}
            </tbody></table>
          )}
          {d.notes && <div style={{ fontSize: 13 }}>{d.notes}</div>}
          {d.hasPhoto && <div style={{ fontSize: 11, color: "var(--ok)", marginTop: 6 }}>📷 Photo on file</div>}
        </Panel>
      )}
    </>
  );
}

export function LogisticsDashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [which, setWhich] = useState("deliveries");
  const [period, setPeriod] = useState("year");   // delivery analysis is retrospective — default to the full picture
  const [range, setRange] = useState(defaultRange);
  const [drill, setDrill] = useState(null);
  const load = useCallback(() => {
    if (period === "range" && !(range.from && range.to)) return;
    const w = periodWindow(period, range);
    setData(null); setErr(null); getHaulage(w.days).then(setData).catch((e) => setErr(e.message));
  }, [period, range.from, range.to]);
  useEffect(() => { load(); }, [load]);

  // delivery performance summary + worst-first ordering
  const perf = useMemo(() => {
    const ds = data?.deliveries || [];
    const loaded = ds.reduce((a, d) => a + (d.qtyLoaded || 0), 0);
    const loss = ds.reduce((a, d) => a + (d.combinedLoss || 0), 0);
    const flagged = ds.filter((d) => d.flagged);
    const sorted = [...ds].sort((a, b) => (Number(b.flagged) - Number(a.flagged)) || ((b.lossPct || 0) - (a.lossPct || 0)));
    return { loaded, loss, lossPct: loaded ? +((loss / loaded) * 100).toFixed(2) : null, count: ds.length, flagged: flagged.length, sorted };
  }, [data]);

  // deliveries + loss split by product (Diesel / Petrol / Blend)
  const byProduct = useMemo(() => {
    const m = {};
    for (const d of data?.deliveries || []) {
      const p = d.commodity || "Unknown";
      m[p] = m[p] || { product: p, loads: 0, loaded: 0, received: 0, loss: 0 };
      m[p].loads++; m[p].loaded += d.qtyLoaded || 0; m[p].received += d.siteDip || 0; m[p].loss += d.combinedLoss || 0;
    }
    return Object.values(m).map((p) => ({ ...p, lossPct: p.loaded > 0 ? +((p.loss / p.loaded) * 100).toFixed(2) : null })).sort((a, b) => b.loaded - a.loaded);
  }, [data]);

  return (
    <Wrap>
      <SectionHead title="Deliveries" sub="Delivery performance — worst first" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div style={{ flex: "1 1 240px" }}><PeriodBar period={period} range={range} onPeriod={setPeriod} onRange={setRange} /></div>
        {data && <ExportBtn onClick={() => exportHaulage("deliveries", data)} />}
      </div>
      <RefreshBar data={data} busy={!data && !err} onRefresh={load} />
      {err && <Note tone="red" title="Could not load">{err}</Note>}
      {!data && !err && <Panel><div style={{ color: "var(--steel)" }}>Loading…</div></Panel>}
      {data && (
        data.deliveries.length === 0 ? <Note tone="blue" title="No delivery notes in this period" /> : <>
          {/* performance summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 14 }}>
            <CountPill n={perf.count} label="Deliveries" />
            <CountPill n={L(perf.loaded)} label="Litres" />
            <CountPill n={perf.lossPct == null ? "—" : perf.lossPct + "%"} label="Loss" tone={perf.lossPct != null && perf.lossPct > 0.3 ? "red" : "ok"} />
            <CountPill n={perf.flagged} label="Flagged" tone={perf.flagged ? "red" : "ok"} />
          </div>
          {perf.flagged > 0 && <Note tone="red" title={`${perf.flagged} deliveries over the 0.3% benchmark — shown first`} />}
          {/* open / overdue trips — scheduled but not yet closed off */}
          {(data.openTrips || []).length > 0 && (
            <Panel style={{ marginBottom: 14, padding: 0, overflow: "hidden", borderLeft: "4px solid var(--amber)" }}>
              <div className="lbl" style={{ padding: "12px 14px 8px" }}>Open trips — scheduled, not yet closed ({data.openTrips.length})</div>
              <div style={{ overflowX: "auto" }}>
                <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Trip</Th><Th>Truck</Th><Th>Route</Th><Th right>Litres</Th><Th right>Open</Th></tr></thead>
                  <tbody>{data.openTrips.slice(0, 12).map((t) => (
                    <tr key={t.tripNo} style={{ borderTop: "1px solid var(--line)" }}>
                      <Td style={{ fontWeight: 600, color: "var(--navy)" }}>{t.tripNo}</Td>
                      <Td style={{ color: "var(--steel)" }}>{t.truck || t.driver || "—"}</Td>
                      <Td style={{ color: "var(--steel)" }}>{t.warehouse} → {t.drops.join(", ")}</Td>
                      <Td right>{L(t.qty)}</Td>
                      <Td right style={{ fontWeight: 700, color: t.daysOpen >= 2 ? "var(--red)" : "var(--amber)" }}>{t.daysOpen}d</Td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: "var(--steel)", padding: "6px 14px 10px" }}>Trips still active past their date — chase the delivery note or cancel.</div>
            </Panel>
          )}
          {/* delivered + loss, split by product */}
          <Panel style={{ marginBottom: 14, padding: 0, overflow: "hidden" }}>
            <div className="lbl" style={{ padding: "12px 14px 8px" }}>Delivered &amp; loss — by product</div>
            {deliveriesProductTable(byProduct)}
          </Panel>
          {/* loss league by truck + driver — high-loss first */}
          {(data.transporterLeague || []).length > 0 && (
            <Panel style={{ marginBottom: 14, padding: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 14px 8px" }}>
                <div className="lbl" style={{ marginBottom: 0 }}>Loss by truck &amp; driver — worst first</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--steel)" }}>{data.transporterLeague.filter((t) => t.highLoss).length} high-loss</div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Truck</Th><Th>Driver</Th><Th right>Loads</Th><Th right>Loss</Th><Th right>%</Th></tr></thead>
                  <tbody>{data.transporterLeague.slice(0, 30).map((t) => (
                    <tr key={t.transporter} style={{ borderTop: "1px solid var(--line)", background: t.highLoss ? "#FDECEA" : "#fff" }}>
                      <Td>{t.highLoss ? "⚠ " : ""}{t.transporter}</Td>
                      <Td style={{ color: "var(--steel)" }}>{t.driver || "—"}</Td>
                      <Td right>{t.loads}</Td>
                      <Td right>{L(t.loss)}</Td>
                      <Td right style={{ fontWeight: 700, color: t.lossPct != null && t.lossPct > 0.3 ? "var(--red)" : "var(--ok)" }}>{t.lossPct != null ? t.lossPct + "%" : "—"}</Td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: "var(--steel)", padding: "6px 14px 10px" }}>High-loss = average loss over the 0.3% benchmark for the period. Driver = the truck's most frequent driver.</div>
            </Panel>
          )}
          <Panel style={{ padding: 0, overflow: "hidden" }}>
            <div className="lbl" style={{ padding: "12px 14px 8px" }}>Deliveries — tap a row for the full note ({perf.sorted.length})</div>
            <div style={{ overflowX: "auto" }}>
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>DN</Th><Th>Product</Th><Th>Route</Th><Th right>Loaded</Th><Th right>Site dip</Th><Th right>Loss</Th><Th right>%</Th></tr></thead>
                <tbody>{perf.sorted.map((d) => (
                  <tr key={d.seq} onClick={() => setDrill({ title: `${d.id} · ${d.commodity || "—"}`, sub: `${d.loadedFrom || "?"} → ${d.deliveredTo || "?"}`, render: deliveryDetail(d) })}
                    style={{ borderTop: "1px solid var(--line)", background: d.flagged ? "#FDECEA" : undefined, cursor: "pointer" }}>
                    <Td style={{ fontWeight: 600, color: "var(--navy)" }}>{d.flagged ? "⚠ " : ""}{d.id}</Td>
                    <Td style={{ color: "var(--steel)" }}>{d.commodity || "—"}</Td>
                    <Td style={{ color: "var(--steel)" }}>{d.loadedFrom || "?"} → {d.deliveredTo || "?"}</Td>
                    <Td right>{L(d.qtyLoaded)}</Td>
                    <Td right>{L(d.siteDip)}</Td>
                    <Td right style={{ color: d.flagged ? "var(--red)" : "var(--ink)" }}>{d.combinedLoss == null ? "—" : L(d.combinedLoss)}</Td>
                    <Td right style={{ fontWeight: 700, color: d.flagged ? "var(--red)" : "var(--ok)" }}>{d.lossPct != null ? d.lossPct + "%" : "—"}</Td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
      {drill && <DetailSheet title={drill.title} sub={drill.sub} onClose={() => setDrill(null)}>{drill.render()}</DetailSheet>}
    </Wrap>
  );
}

/* ============================================================ *
 *  LUBRICANTS POS (retail) — sell lubricants; ZIMRA-fiscal ready
 * ============================================================ */
export function LubePOS({ me }) {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState({});           // id -> {name,pack,price,qty}
  const [pay, setPay] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { getLubeProducts().then((r) => setProducts(r.products)).catch((e) => window.dispatchEvent(new CustomEvent("da-load-error", { detail: "Couldn't load lube products — " + (e.message || "tap refresh.") }))); }, []);
  const add = (p) => setCart((c) => ({ ...c, [p.id]: { name: p.name, pack: p.pack, price: p.price, qty: (c[p.id]?.qty || 0) + 1 } }));
  const setQty = (id, q) => setCart((c) => { const n = { ...c }; const qty = Math.max(0, Number(q) || 0); if (!qty) delete n[id]; else n[id] = { ...n[id], qty }; return n; });
  const lines = Object.entries(cart);
  const total = lines.reduce((a, [, v]) => a + v.price * v.qty, 0);

  const sell = async () => {
    setBusy(true); setMsg(null);
    try {
      const items = lines.map(([, v]) => ({ name: v.name, pack: v.pack, qty: v.qty, unitPrice: v.price }));
      const r = await postLubeSale({ items, paymentMethod: pay, deviceTime: new Date().toISOString() });
      setMsg({ tone: "ok", title: `Sold · ${r.ref}`, body: `$${r.total.toFixed(2)} · ${pay} · fiscal ${r.fiscal}` });
      setCart({});
    } catch (err) { setMsg({ tone: "red", title: "Not recorded", body: err.message }); }
    finally { setBusy(false); }
  };

  return (
    <Wrap>
      <SectionHead title="Lubricants" sub={me?.site ? `${me.site} · point of sale` : "Point of sale"} />
      {msg && <Note tone={msg.tone} title={msg.title}>{msg.body}</Note>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
        {products.map((p) => (
          <button key={p.id} onClick={() => add(p)} className="card" style={{ padding: 12, textAlign: "left", background: cart[p.id] ? "#EAEEFB" : "#fff" }}>
            <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.2 }}>{p.name}</div>
            <div style={{ fontSize: 11, color: "var(--steel)" }}>{p.pack}</div>
            <div className="mono" style={{ fontWeight: 700, color: "var(--blue)", marginTop: 4 }}>${p.price.toFixed(2)}{cart[p.id] ? ` ×${cart[p.id].qty}` : ""}</div>
          </button>
        ))}
      </div>
      {lines.length > 0 && (
        <Panel style={{ marginBottom: 90 }}>
          <div className="lbl" style={{ marginBottom: 8 }}>Cart</div>
          {lines.map(([id, v]) => (
            <div key={id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{v.name}</div><div style={{ fontSize: 11, color: "var(--steel)" }}>{v.pack} · ${v.price.toFixed(2)}</div></div>
              <Num style={{ width: 64 }} value={v.qty} onChange={(q) => setQty(id, q)} />
              <div className="mono" style={{ width: 64, textAlign: "right", fontWeight: 700 }}>${(v.price * v.qty).toFixed(2)}</div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 4 }}>
            <div className="disp" style={{ fontWeight: 700, color: "var(--navy)", fontSize: 18 }}>Total ${total.toFixed(2)}</div>
            <select value={pay} onChange={(e) => setPay(e.target.value)} style={{ maxWidth: 130 }}>{["cash", "card", "mobile"].map((m) => <option key={m}>{m}</option>)}</select>
          </div>
          <button className="pill pill-lime" disabled={busy} style={{ width: "100%", marginTop: 12 }} onClick={sell}>{busy ? "Recording…" : `Take payment · $${total.toFixed(2)}`}</button>
          <div style={{ fontSize: 11, color: "var(--steel)", textAlign: "center", marginTop: 6 }}>Receipt is recorded now; ZIMRA fiscalisation is applied when the VFD is connected.</div>
        </Panel>
      )}
    </Wrap>
  );
}

export function LubeSales() {
  const [d, setD] = useState(null);
  const [days, setDays] = useState(7);
  const [err, setErr] = useState(null);
  useEffect(() => { setD(null); getLubeSales(days).then(setD).catch((e) => setErr(e.message)); }, [days]);
  return (
    <Wrap>
      <SectionHead title="Lubricant sales" sub="Point-of-sale takings" />
      <div style={{ marginBottom: 12 }}>
        <Segmented options={[["1", "Today"], ["7", "7 days"], ["30", "30 days"]]} value={String(days)} onChange={(v) => setDays(Number(v))} />
      </div>
      {err && <Note tone="red" title="Could not load">{err}</Note>}
      {!d && !err && <Panel><div style={{ color: "var(--steel)" }}>Loading…</div></Panel>}
      {d && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <CountPill n={`$${d.total.toFixed(0)}`} label="Takings" tone="ok" />
            <CountPill n={d.count} label="Sales" />
          </div>
          {d.sales.length === 0 ? <Note tone="blue" title="No sales in this period" /> : (
            <Panel style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Ref</Th><Th>Date</Th><Th>Payment</Th><Th>Items</Th><Th right>Total</Th></tr></thead>
                  <tbody>{d.sales.map((s) => (
                    <tr key={s.ref} style={{ borderTop: "1px solid var(--line)" }}>
                      <Td style={{ fontWeight: 600, color: "var(--navy)" }}>{s.ref}</Td>
                      <Td style={{ color: "var(--steel)" }}>{new Date(s.at).toLocaleDateString()}</Td>
                      <Td style={{ color: "var(--steel)" }}>{s.payment}</Td>
                      <Td style={{ color: "var(--steel)" }}>{(s.items || []).map((i) => `${i.qty}× ${i.name}`).join(", ")}</Td>
                      <Td right style={{ fontWeight: 700 }}>${s.total.toFixed(2)}</Td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid var(--navy)", background: "#F4F6FA" }}>
                    <Td colSpan={4} style={{ fontWeight: 700 }}>Total takings</Td>
                    <Td right style={{ fontWeight: 700 }}>${d.total.toFixed(2)}</Td>
                  </tr></tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </Wrap>
  );
}

/* ============================================================ *
 *  YARD / WORKSHOP — log trucks in, daily updates, close cases
 * ============================================================ */
const SEV = { low: "#4C9E2A", medium: "#C07A00", high: "#D63B2E", critical: "#8B1A10" };

// Yard staff: report a truck in, post daily updates, close when ready.
export function YardWorkshop({ me }) {
  const [data, setData] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState("open"); // open list vs new
  const load = useCallback(() => { getYard().then(setData).catch((e) => setErr(e.message)); getYardVehicles().then((r) => setVehicles(r.vehicles)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <Wrap>
      <SectionHead title="Yard workshop" sub="Log repairs, post morning & evening updates" />
      {me && <ReminderBar me={me} />}
      <Segmented options={[["open", `In workshop${data ? ` (${data.counts.workshop})` : ""}`], ["new", "Log a truck in"]]} value={tab} onChange={setTab} />
      {err && <Note tone="red" title="Could not load">{err}</Note>}
      {tab === "new" && <YardOpenForm vehicles={vehicles} onSaved={() => { load(); setTab("open"); }} />}
      {tab === "open" && (!data ? <Panel><div style={{ color: "var(--steel)" }}>Loading…</div></Panel> :
        data.openCases.length === 0 ? <Note tone="ok" title="No trucks in the workshop" /> :
        data.openCases.map((c) => <YardCase key={c.ref} c={c} onChanged={load} />))}
    </Wrap>
  );
}

function YardOpenForm({ vehicles, onSaved }) {
  const [f, setF] = useState({ vehicle: "", category: "Fault", severity: "medium", description: "", odometer: "" });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const send = async (e) => {
    e.preventDefault(); setMsg(null);
    if (!f.vehicle) return setMsg({ tone: "amber", title: "Almost there", body: "Pick the truck / vehicle." });
    if (!f.description.trim()) return setMsg({ tone: "amber", title: "Almost there", body: "Describe the fault or job." });
    setBusy(true);
    try { const r = await yardOpen({ ...f, deviceTime: new Date().toISOString() }); setMsg({ tone: "ok", title: `Logged in · ${r.ref}`, body: `${f.vehicle}` }); setF((s) => ({ ...s, vehicle: "", description: "", odometer: "" })); onSaved(); }
    catch (err) { setMsg({ tone: "red", title: "Not logged", body: err.message }); }
    finally { setBusy(false); }
  };
  return (
    <Panel>
      <form onSubmit={send}>
        {msg && <Note tone={msg.tone} title={msg.title}>{msg.body}</Note>}
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Truck / vehicle">
            <Picker value={f.vehicle} onChange={set("vehicle")} placeholder="Select…" title="Truck / vehicle" options={vehicles.map((v) => ({ value: v.code, label: `${v.code}${v.description ? ` · ${v.description}` : ""}` }))} /></Field></div>
          <div style={{ flex: 1 }}><Field label="Type">
            <Picker value={f.category} onChange={set("category")} options={["Fault", "Service", "Repair", "Inspection"]} /></Field></div>
        </div>
        <Field label="Severity"><Segmented options={[["low", "Low"], ["medium", "Med"], ["high", "High"], ["critical", "Critical"]]} value={f.severity} onChange={set("severity")} /></Field>
        <Field label="Fault / job (what's wrong)"><input value={f.description} onChange={(e) => set("description")(e.target.value)} placeholder="e.g. Tanker weld, COF preps, alternator" /></Field>
        <Field label="Odometer (optional)"><Num value={f.odometer} onChange={set("odometer")} /></Field>
        <button className="pill" disabled={busy} style={{ width: "100%" }}>{busy ? "Logging…" : "Log into workshop"}</button>
      </form>
    </Panel>
  );
}

function YardCase({ c, onChanged }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(null);
  const addUpdate = async () => {
    setMsg(null);
    if (!note.trim()) return setMsg({ tone: "amber", title: "Add a note", body: "Type today's update first." });
    setBusy(true);
    try { await yardUpdate({ ref: c.ref, note: note.trim(), deviceTime: new Date().toISOString() }); setNote(""); onChanged(); }
    catch (e) { setMsg({ tone: "red", title: "Update not saved", body: e.message }); }
    finally { setBusy(false); }
  };
  const close = async () => {
    setMsg(null); setBusy(true);
    try { await yardClose({ ref: c.ref, deviceTime: new Date().toISOString() }); onChanged(); }
    catch (e) { setMsg({ tone: "red", title: "Couldn't close the case", body: e.message }); }
    finally { setBusy(false); }
  };
  return (
    <Panel style={{ marginBottom: 10, borderLeft: `4px solid ${SEV[c.severity] || "var(--steel)"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="disp" style={{ fontWeight: 700, color: "var(--navy)", fontSize: 16 }}>{c.vehicle} · {c.category}</div>
        <div className="mono" style={{ fontSize: 12, color: c.days > 3 ? "var(--red)" : "var(--steel)" }}>{c.days}d in workshop</div>
      </div>
      <div style={{ fontSize: 13, margin: "4px 0 8px" }}>{c.description || c.title || "—"}</div>
      {msg && <Note tone={msg.tone} title={msg.title}>{msg.body}</Note>}
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ flex: 1 }} placeholder="Today's update…" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="pill" disabled={busy} style={{ padding: "9px 14px", flex: "0 0 auto" }} onClick={addUpdate}>Update</button>
        <button type="button" className="pill-lime" disabled={busy} style={{ padding: "9px 14px", flex: "0 0 auto" }} onClick={close}>Ready</button>
      </div>
      <button type="button" className="pill-ghost" style={{ marginTop: 8, padding: "6px 12px", fontSize: 12 }} onClick={() => setOpen((o) => !o)}>{open ? "Hide" : `History (${c.entries.length})`}</button>
      {open && <div style={{ marginTop: 8 }}>{c.entries.slice().reverse().map((e, i) => (
        <div key={i} className="mono" style={{ fontSize: 11, color: "var(--steel)", padding: "4px 0", borderTop: "1px solid var(--line)" }}>
          <b style={{ color: "var(--navy)" }}>{e.type}</b> · {new Date(e.at).toLocaleDateString()} · {e.note} <span style={{ opacity: .7 }}>— {e.by}</span>
        </div>))}</div>}
    </Panel>
  );
}

// Executive / manager: truck status at a glance.
export function TruckStatus() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [drill, setDrill] = useState(null);
  useEffect(() => { getYard().then(setD).catch((e) => setErr(e.message)); }, []);
  const openCase = (c) => setDrill({ title: c.vehicle, sub: `${c.ref || ""}${c.severity ? " · " + c.severity : ""}`, render: workshopCaseDetail(c) });
  const openVehicle = (v) => {
    const c = d.openCases.find((x) => String(x.vehicle) === String(v.code) || String(x.vehicle).includes(v.code));
    if (v.inWorkshop && c) return openCase(c);
    setDrill({ title: v.code, sub: v.inWorkshop ? `In workshop · ${v.days}d` : "Active", render: () => (
      v.inWorkshop
        ? <Panel><div className="lbl" style={{ marginBottom: 4 }}>Fault</div><div style={{ fontSize: 14 }}>{v.fault || "In the workshop — no detail recorded."}</div><div className="mono" style={{ fontSize: 12, color: "var(--steel)", marginTop: 8 }}>{v.days} days in workshop</div></Panel>
        : <Note tone="ok" title="Ready to run">This truck is active and not in the workshop.</Note>
    ) });
  };
  return (
    <Wrap>
      <SectionHead title="Fleet status" sub="Which trucks are running, which are in the workshop" />
      {err && <Note tone="red" title="Could not load">{err}</Note>}
      {!d && !err && <Panel><div style={{ color: "var(--steel)" }}>Loading…</div></Panel>}
      {d && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 14 }}>
            <CountPill n={d.counts.total} label="Fleet" />
            <CountPill n={d.counts.active} label="Active" tone="ok" />
            <CountPill n={d.counts.workshop} label="In workshop" tone={d.counts.workshop ? "red" : "ok"} />
          </div>
          {d.openCases.length > 0 && (
            <Panel style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
              <div className="lbl" style={{ padding: "12px 14px 8px" }}>In the workshop — longest first</div>
              <div style={{ overflowX: "auto" }}>
                <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "var(--navy)", color: "#fff" }}><Th>Vehicle</Th><Th>Fault</Th><Th>Severity</Th><Th right>Days</Th></tr></thead>
                  <tbody>{d.openCases.map((c) => (
                    <tr key={c.ref} onClick={() => openCase(c)} style={{ borderTop: "1px solid var(--line)", cursor: "pointer" }}>
                      <Td style={{ fontWeight: 600, color: "var(--navy)" }}>{c.vehicle}</Td>
                      <Td style={{ color: "var(--steel)" }}>{c.description || c.category}</Td>
                      <Td><span className="pill" style={{ padding: "1px 8px", fontSize: 11, background: SEV[c.severity] || "var(--steel)", boxShadow: "none", borderRadius: 100 }}>{c.severity}</span></Td>
                      <Td right style={{ fontWeight: 700, color: c.days > 3 ? "var(--red)" : "var(--navy)" }}>{c.days}d</Td>
                    </tr>))}</tbody>
                </table>
              </div>
            </Panel>
          )}
          <Panel style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(64px,1fr))", gap: 6, padding: 10 }}>
              {d.vehicles.map((v) => (
                <div key={v.code} title={v.fault || "Active"} role="button" tabIndex={0} onClick={() => openVehicle(v)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openVehicle(v); } }}
                  style={{ textAlign: "center", padding: "8px 4px", borderRadius: 10, background: v.inWorkshop ? "#FDECEA" : "#EBF6E7", border: `1px solid ${v.inWorkshop ? "var(--red)" : "var(--ok)"}`, cursor: "pointer" }}>
                  <div className="mono" style={{ fontWeight: 700, fontSize: 13 }}>{v.code}</div>
                  <div style={{ fontSize: 11, color: v.inWorkshop ? "var(--red)" : "var(--ok)" }}>{v.inWorkshop ? `${v.days}d` : "ready"}</div>
                </div>))}
            </div>
          </Panel>
          {drill && <DetailSheet title={drill.title} sub={drill.sub} onClose={() => setDrill(null)}>{drill.render()}</DetailSheet>}
        </>
      )}
    </Wrap>
  );
}

/* ============================================================ *
 *  MASTER DATA — create a site manager (admin/approver)
 * ============================================================ */
const ROLE_OPTIONS = [
  ["retail_supervisor", "Retail supervisor", true],
  ["operations_manager", "Operations manager", false],
  ["fleet_manager", "Fleet manager", false],
  ["executive", "Executive", false],
];
export function SiteManagerCreate() {
  const [sites, setSites] = useState([]);
  const [f, setF] = useState({ role: "retail_supervisor", login: "", name: "", pin: "", site: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { getSites().then((r) => setSites(r.sites)).catch(() => {}); }, [msg]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const siteScoped = ROLE_OPTIONS.find((r) => r[0] === f.role)?.[2];
  const send = async (e) => {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      const r = await addSiteManager(f);
      setMsg({ tone: "ok", title: "User created", body: `${f.name} · ${f.role.replace(/_/g, " ")}${r.site ? ` → ${r.site}` : ""}` });
      setF({ role: f.role, login: "", name: "", pin: "", site: "" });
    } catch (err) { setMsg({ tone: "red", title: "Not created", body: err.message }); }
    finally { setBusy(false); }
  };
  return (
    <Panel style={{ marginTop: 14 }}>
      <div className="disp" style={{ fontWeight: 700, color: "var(--navy)", marginBottom: 10 }}>Add a user</div>
      <form onSubmit={send}>
        {msg && <Note tone={msg.tone} title={msg.title}>{msg.body}</Note>}
        <Field label="Role">
          <Picker value={f.role} onChange={(v) => setF((s) => ({ ...s, role: v }))} title="Role" options={ROLE_OPTIONS.map(([k, label]) => ({ value: k, label }))} />
        </Field>
        {siteScoped && (
          <Field label="Site">
            <Picker value={f.site} onChange={(v) => setF((s) => ({ ...s, site: v }))} placeholder="Select a site…" title="Site"
              options={sites.map((s) => ({ value: s.name, label: `${s.name}${s.hasManager ? " (has supervisor)" : ""}` }))} />
          </Field>
        )}
        <Field label="Name"><input value={f.name} onChange={set("name")} placeholder="Full name" /></Field>
        <Field label="Login (username)"><input value={f.login} onChange={set("login")} placeholder="e.g. byomain" /></Field>
        <Field label="PIN (min 4 digits)"><input value={f.pin} onChange={set("pin")} inputMode="numeric" /></Field>
        <button className="pill" disabled={busy} style={{ width: "100%" }}>{busy ? "Creating…" : "Create user"}</button>
      </form>
    </Panel>
  );
}

/* Small table cells */
const Th = ({ children, right }) => <th style={{ padding: "9px 11px", textAlign: right ? "right" : "left", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, letterSpacing: ".04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{children}</th>;
// numbers (right-aligned cells) use tabular figures so columns line up like a ledger
const Td = ({ children, right, style, colSpan }) => <td colSpan={colSpan} style={{ padding: "8px 11px", textAlign: right ? "right" : "left", ...(right ? { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } : null), ...style }}>{children}</td>;
