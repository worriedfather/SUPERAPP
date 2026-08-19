/* In-app option picker — replaces native <select> so the OS dropdown never
   shows. Small option sets render as tappable chips; longer lists open a styled
   bottom sheet with search. One component, used everywhere for consistency.

   <Picker value={v} onChange={setV} options={["Diesel","Petrol"]} />
   options: array of strings, or [{value,label}]. */
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

const norm = (options) => (options || []).map((o) =>
  (o && typeof o === "object") ? { value: String(o.value), label: o.label ?? String(o.value) }
    : { value: String(o), label: String(o) });

export function Picker({ value, onChange, options, placeholder = "Select…", disabled, title, chipsMax = 4 }) {
  const opts = norm(options);
  const v = value == null ? "" : String(value);
  const shortEnough = opts.every((o) => o.label.length <= 15);
  if (opts.length > 0 && opts.length <= chipsMax && shortEnough) {
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {opts.map((o) => {
          const on = o.value === v;
          return (
            <button key={o.value} type="button" disabled={disabled} onClick={() => onChange(o.value)} className="disp"
              style={{ padding: "9px 15px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: disabled ? "default" : "pointer",
                border: `1.5px solid ${on ? "var(--blue)" : "var(--line)"}`, background: on ? "var(--blue)" : "#fff", color: on ? "#fff" : "var(--ink)" }}>
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  return <PickerSheet opts={opts} v={v} onChange={onChange} placeholder={placeholder} disabled={disabled} title={title} />;
}

function PickerSheet({ opts, v, onChange, placeholder, disabled, title }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const sel = opts.find((o) => o.value === v);
  const filtered = q ? opts.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : opts;
  useEffect(() => { if (!open) setQ(""); }, [open]);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => setOpen(true)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          padding: "10px 12px", borderRadius: 10, border: "1.5px solid var(--line)", background: "#fff",
          fontFamily: "'Barlow',system-ui,sans-serif", fontSize: 14, fontWeight: 500, color: sel ? "var(--ink)" : "#9AA6B8",
          cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sel ? sel.label : placeholder}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B6B84" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && createPortal(
        <div className="da" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(10,18,35,.5)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "pkfade .15s ease", boxSizing: "border-box" }}>
          <style>{`@keyframes pkfade{from{opacity:0}to{opacity:1}}@keyframes pkrise{from{transform:translateY(100%)}to{transform:none}}`}</style>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", width: "100%", maxWidth: 560, maxHeight: "74vh", borderRadius: "20px 20px 0 0",
              display: "flex", flexDirection: "column", boxShadow: "0 -8px 40px rgba(0,0,0,.28)", animation: "pkrise .22s cubic-bezier(.2,.9,.3,1)", paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div style={{ padding: "12px 16px 8px" }}>
              <div style={{ width: 38, height: 4, borderRadius: 100, background: "var(--line)", margin: "0 auto 12px" }} />
              {title && <div className="disp" style={{ fontSize: 16, fontWeight: 700, color: "var(--navy)", marginBottom: 10 }}>{title}</div>}
              {opts.length > 7 && <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
                style={{ width: "100%", padding: "11px 13px", borderRadius: 11, border: "1.5px solid var(--line)", fontSize: 14, fontFamily: "'Barlow',system-ui,sans-serif" }} />}
            </div>
            <div style={{ overflowY: "auto", padding: "0 8px 10px" }}>
              {filtered.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--steel)", fontSize: 13 }}>No matches</div>}
              {filtered.map((o) => {
                const on = o.value === v;
                return (
                  <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                    style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                      padding: "13px 14px", borderRadius: 12, border: "none", background: on ? "#EEF2FF" : "transparent",
                      fontFamily: "'Barlow',system-ui,sans-serif", fontSize: 14, fontWeight: on ? 700 : 500, color: on ? "var(--blue)" : "var(--ink)", cursor: "pointer" }}>
                    <span>{o.label}</span>
                    {on && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>, document.body)}
    </>
  );
}
