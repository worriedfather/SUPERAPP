/* On-device odometer OCR is intentionally DISABLED.
 *
 * The client-side Tesseract build spins up a fresh worker and loads a ~15MB WASM
 * model + English trained data into the WebView on EVERY photo. On low-memory
 * phones (e.g. Redmi Note 11) that OOM-crashed the whole app right at the photo
 * step — the driver takes the odometer photo, taps Next, the app dies.
 *
 * OCR here was always a prototype, "not a control" (see CLAUDE.md build order) —
 * the plan is server-side OCR with a confidence threshold. Until then the photo is
 * still captured and submitted, and the approver verifies the reading by eye (the
 * request/approval screens already handle the `unavailable` state gracefully).
 */
export async function readOdometer(_blob) {
  return { state: "unavailable" };
}
