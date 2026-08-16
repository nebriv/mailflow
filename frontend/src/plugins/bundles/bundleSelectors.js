// Pure derivations over bundle state.
//
// Split from bundlesStore.js so the rules that decide what renders and what a sweep will clear are
// testable without zustand, without a DOM and without the network — the same reasoning that keeps
// the backend classifier free of the capability surface.

// The set of message ids currently held inside a bundle: what core's list must NOT render as
// individual rows, or the bundle saves no rows at all. Derived rather than stored so it cannot
// drift from the bundle data.
export function bundledMessageIds(bundles) {
  const ids = new Set();
  for (const b of bundles || []) for (const m of b.messages || []) ids.add(m.id);
  return ids;
}

// The bundles that actually render a row.
//
// INV-6: a bundle with nothing after its cursor renders nothing at all. §1.4 is the failure — a row
// that is always present cannot be cleared, so there is nothing to clear and no zero state. The
// bundle still EXISTS (the reveal can reach its reading feed); it just does not take a row.
export const visibleBundles = (bundles) => (bundles || []).filter((b) => b.count > 0);

// Bundles that exist but have nothing since their cursor — reachable through the reveal only.
export const sweptBundles = (bundles) => (bundles || []).filter((b) => b.count === 0);

const bundleFor = (bundles, key) => (bundles || []).find((b) => b.key === key) || null;

// The ids above the seen boundary — exactly what a sweep request carries (INV-9a).
export function seenIdsFor(bundles, seen, key) {
  const bundle = bundleFor(bundles, key);
  if (!bundle) return [];
  return (bundle.messages || []).slice(0, seen[key] || 0).map((m) => m.id);
}

// What a sweep will actually clear: seen, minus the tiers that survive it (INV-10, INV-13).
//
// Mirrors the server's planSweep so the control's label is truthful the instant it renders rather
// than after a round trip. The server re-derives it authoritatively — this is for the label, never
// for the decision.
export function sweepableFor(bundles, seen, key) {
  const bundle = bundleFor(bundles, key);
  if (!bundle) return [];
  return (bundle.messages || [])
    .slice(0, seen[key] || 0)
    .filter((m) => !m.pinned && !m.keepUntilSweep);
}

// The seen mark after a row at `index` has been on screen. Monotonic: scrolling back up must not
// un-see anything, or the boundary would jitter as the user reads (INV-9a).
export const advanceSeen = (current, index) => Math.max(current || 0, index + 1);

// The seen mark after a manual correction. NOT monotonic — the point of the draggable boundary is
// that the user can pull it back when the automatic mark overshot (INV-9c) — but clamped to the
// list so it can never mean more than exists.
export const clampSeen = (count, total) => Math.max(0, Math.min(count, total));
