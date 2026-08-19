/* Internal distance estimates (Dave / DA Finance, milages.docx). Mainly depot →
   site distances as actually driven (many are round-trips out of Harare/Mutare).
   Used as a FOURTH source in the route triangulation. These are rough and will
   be refined over time — the triangulation takes the highest of all sources, so
   a generous internal figure protects the driver's allocation.
   [depotKey, destinationKeyword, km] — matched by substring on the route stops. */
const M = [
  // Msasa (Harare depot)
  ["msasa", "bulawayo", 440], ["msasa", "mutare", 255], ["msasa", "feruka", 300],
  ["msasa", "chegutu", 248], ["msasa", "kadoma", 300], ["msasa", "kwekwe mine", 612], ["msasa", "kwekwe", 448],
  ["msasa", "gokwe", 680], ["msasa", "gweru", 580], ["msasa", "chitungwiza", 90], ["msasa", "marondera", 140],
  ["msasa", "murehwa", 200], ["msasa", "bindura", 180], ["msasa", "chirundu", 750], ["msasa", "kariba", 800],
  ["msasa", "avondale", 32], ["msasa", "ardbennie", 44], ["msasa", "epworth", 32], ["msasa", "gletwyn", 44],
  ["msasa", "graniteside", 34], ["msasa", "greencroft", 62], ["msasa", "kuwadzana", 54], ["msasa", "mabvuku", 27],
  ["msasa", "southlea", 75], ["msasa", "willowvale", 52], ["msasa", "waterfalls", 36], ["msasa", "speedscene", 40],
  ["msasa", "kaunda", 36],
  // Mutare / Feruka depot
  ["mutare", "chiredzi", 634], ["mutare", "rusape", 190], ["mutare", "chivhu", 534], ["mutare", "bulawayo", 560],
  ["mutare", "gweru", 800], ["mutare", "marondera", 380], ["mutare", "zvishavane", 910],
];

// Internal estimate for a route — but ONLY for the pattern the table actually
// covers: a depot (Msasa/Yard or Mutare/Feruka) out to a SINGLE destination and
// (optionally) back. The table has no leg-to-leg data, so it must not be applied
// to multi-stop routes (e.g. Glenara → Bulawayo → Yard) — those return null and
// fall to Google / OpenStreetMap. Returns null when the route isn't a clean
// depot↔one-destination trip.
const isDepot = (n) => /msasa|yard|noic|feruka|mutare/.test(n);
export function internalKm(names) {
  if (!Array.isArray(names) || names.length < 2) return null;
  const norm = names.map((n) => String(n).toLowerCase());
  const depots = norm.filter(isDepot);
  const dests = norm.filter((n) => !isDepot(n));
  if (!depots.length || dests.length !== 1) return null;  // must be depot ↔ single destination
  const depotKey = depots.some((n) => /msasa|yard|noic/.test(n)) ? "msasa" : "mutare";
  const dest = dests[0];
  let best = null;
  for (const [dep, kw, km] of M) {
    if (dep !== depotKey) continue;
    if (dest.includes(kw)) best = best == null ? km : Math.max(best, km);
  }
  return best;
}
