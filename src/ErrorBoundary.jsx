import React from "react";

// Catches a render/runtime exception in any screen it wraps and shows a
// recoverable card instead of white-screening the whole app. Keyed on the active
// tab in App.jsx so navigating away auto-resets it.
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    // best-effort log; also surfaced to the in-app error reporter if present
    try { console.error("[ErrorBoundary]", err, info?.componentStack); } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent("da-render-error", { detail: { message: String(err && err.message || err) } })); } catch { /* ignore */ }
  }
  render() {
    if (!this.state.err) return this.props.children;
    const reset = () => this.setState({ err: null });
    return (
      <div style={{ padding: 20, maxWidth: 520, margin: "24px auto" }}>
        <div className="card" style={{ padding: 22, borderLeft: "4px solid #C0563A" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontWeight: 800, fontSize: 17, color: "var(--navy,#22345C)" }}>This screen hit a snag</div>
          <div style={{ fontSize: 13, color: "var(--steel,#6B7688)", marginTop: 6, lineHeight: 1.5 }}>
            The rest of the app is fine — your data is safe. Try again, or use the menu to go elsewhere.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button onClick={reset} style={{ border: "none", background: "var(--navy,#22345C)", color: "#fff", borderRadius: 9, padding: "9px 16px", fontWeight: 700, cursor: "pointer" }}>Try again</button>
            <button onClick={() => { try { window.location.reload(); } catch { /* ignore */ } }} style={{ border: "1px solid var(--line,#DDE2EA)", background: "#fff", borderRadius: 9, padding: "9px 16px", fontWeight: 700, cursor: "pointer" }}>Reload app</button>
          </div>
          {this.props.detail && this.state.err?.message && (
            <div className="mono" style={{ fontSize: 11, color: "var(--steel,#6B7688)", marginTop: 12, wordBreak: "break-word" }}>{String(this.state.err.message)}</div>
          )}
        </div>
      </div>
    );
  }
}
