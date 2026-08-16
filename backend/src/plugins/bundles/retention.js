// The three retention tiers (INV-10) and sweep planning (INV-9a, INV-9d, INV-13).
//
//   Seen  cleared by sweep                                  until the next sweep
//   Keep  survives sweep, stays in the bundle               KEEP_DECAY_SWEEPS sweeps, then seen
//   Pin   top of list, immune to every filter and sweep     until manually removed
//
// ── Pin is the star ─────────────────────────────────────────────────────────────────────────────
// Pin maps onto MailFlow's existing starred state (IMAP \Flagged) rather than a new annotation.
// Three reasons, in order of weight: §2's comparison table already promises "starred mail survives
// a sweep"; a star is real IMAP state, so a pin survives across clients and outlives this project
// exactly as INV-19 demands of bundle membership; and it costs no new storage, no migration and no
// new gesture. §1.5's complaint about Spark is that read pins get HIDDEN, which is a rendering bug
// — INV-14 fixes it in the renderer, and does not require a second flag.
//
// ── Keep decays in sweeps, not days ─────────────────────────────────────────────────────────────
// INV-10a: a permanent flag applied casually becomes a silent second backlog, which is how stars
// fail in every client. Decay makes marking cheap — being wrong costs nothing and self-corrects.
// The clock is the sweep counter rather than wall time because "survives the next 3 sweeps" is a
// promise about the user's own actions, and is therefore predictable in a way "3 days" is not.
//
// ── The seen boundary is never inferred ─────────────────────────────────────────────────────────
// INV-9a makes scroll depth the selection mechanism: skimming IS the triage decision, and read
// flags cannot capture it because the client skims subject lines without opening anything. INV-9d
// then forbids inferring the boundary from scroll speed, dwell time or any other behavioural
// signal.
//
// `planSweep` therefore takes an EXPLICIT list of message ids the client considers seen. The server
// performs no inference of its own — it intersects that list with what is actually still in the
// bundle and subtracts the tiers that survive. This is what makes the mechanic debuggable when it
// is wrong: the request says exactly what it meant to clear, and the response says exactly what it
// did. It is also what lets INV-9b's label ("Clear 9 seen") be truthful, since the number in the
// label and the number in the request are computed from the same list.

import { config } from './bundlesConfig.js';

// Why a message survives a sweep, or null if it is swept. Ordered by INV-13: manual state outranks
// derived state, so a pin is checked before anything else.
export function survivalReason(message, annotation, cursor) {
  if (!message) return 'missing';
  // INV-14 / INV-16: a pin is deliberate, so it wins over every derived state. It is also the
  // repair path for a misclassification — pinning lifts a message out permanently rather than for
  // one session, which is why nothing below can override it.
  if (message.is_starred === true) return 'pinned';
  const keepUntil = annotation?.keepUntilSweep;
  if (Number.isInteger(keepUntil) && keepUntil > (cursor?.sweepCount ?? 0)) return 'keep';
  return null;
}

// The sweep counter value at which a Keep applied now should expire.
export const keepUntilFor = (cursor, decaySweeps = config.KEEP_DECAY_SWEEPS) =>
  (cursor?.sweepCount ?? 0) + decaySweeps;

// Whether a stored Keep has decayed back to seen.
export const isKeepActive = (annotation, cursor) =>
  Number.isInteger(annotation?.keepUntilSweep) && annotation.keepUntilSweep > (cursor?.sweepCount ?? 0);

// Plan a sweep. Pure.
//
//   members      — the bundle's current contents (rows with { id, is_starred, ... }), newest first
//   seenIds      — ids the client marked seen, from its scroll high-water mark (INV-9a)
//   annotations  — { [messageId]: this plugin's annotation }
//   cursor       — the bundle's cursor, for Keep decay
//
// Returns { sweep, survivors, unseen }:
//   sweep     — rows to clear, in member order
//   survivors — [{ row, reason }] for members that were seen but held back by a tier
//   unseen    — members below the boundary, untouched (S-3b: a sweep clears no unseen message)
export function planSweep({ members, seenIds, annotations = {}, cursor }) {
  const seen = new Set(seenIds || []);
  const sweep = [];
  const survivors = [];
  const unseen = [];

  for (const row of members || []) {
    if (!seen.has(row.id)) { unseen.push(row); continue; }
    const reason = survivalReason(row, annotations[row.id], cursor);
    if (reason) survivors.push({ row, reason });
    else sweep.push(row);
  }
  return { sweep, survivors, unseen };
}

// The count INV-9b requires the sweep control to state in its own label. Exported so the label and
// the request are computed by the same code and cannot disagree — a control that overstates its
// scope is exactly the confirmation-dialog problem (§1.3) reintroduced.
export const sweepableCount = (plan) => plan.sweep.length;

// The label itself. Never a generic verb: stating scope in the control is what removes the need to
// confirm scope in a dialog (INV-9b, S-3a).
export const sweepLabel = (plan) => `Clear ${sweepableCount(plan)} seen`;
