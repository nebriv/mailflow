// The classifier (INV-1, INV-2, INV-3).
//
// A noise detector with an exemption list. It never ranks importance, scores priority or detects
// urgency (INV-1, AV-6) — there is no notion of a message being more important than another
// anywhere in this file. It answers one question: is this message noise, and if so which kind.
//
// ── The decision procedure ──────────────────────────────────────────────────────────────────────
// Ordered, and the order is the safety argument. Each step can only ever send a message BACK to the
// inbox; only the last step can bundle. So every early exit is a safe exit.
//
//   1. no usable signals            → inbox   (INV-2: uncertainty resolves to the inbox)
//   2. sender is exempt             → inbox   (INV-4: derived correspondents + overrides)
//   3. message trips the guard      → inbox   (S-7: security / financial / transactional)
//   4. no positive noise signal     → inbox   (INV-2: absence of evidence is not evidence)
//   5. otherwise                    → the bundle its category maps to
//
// Step 3 is per-message and step 2 is per-sender, which is why they are separate. A sender who
// sends both marketing and security alerts (§1.2's VMware and Binance) is not exempt — their
// marketing should bundle — but their security alerts must not, and only a per-message check can
// make that distinction.
//
// ── The sender cache ────────────────────────────────────────────────────────────────────────────
// Phase 1 requires that a sender is classified once. What is cached is the SENDER-LEVEL verdict
// (steps 2, 4 and 5), keyed by address. The guard at step 3 is never cached: it depends on the
// subject, so it must run for every message. The layering matters — cache the stable half, re-run
// the volatile half — and it is what lets a cached 'newsletters' sender still have an individual
// message held back.
//
// The cache is an optimisation only. `classifyMessage` is a pure function of its arguments and
// returns the same verdict with or without it; `classifySender` is exported so the corpus harness
// can exercise the real path with no cache at all.

import { extractSignals } from './signals.js';
import { guardReason } from './guards.js';
import { isExempt } from './exemptions.js';
import { INBOX, bundleForCategory } from './taxonomy.js';

// A verdict is `{ bundle, reason }`. `bundle` is INBOX or a bundle key; `reason` names the rule that
// decided, so every classification is explainable. A classifier nobody can interrogate is a
// classifier nobody trusts — the failure this build exists to correct (§1.2).
const verdict = (bundle, reason) => ({ bundle, reason });

// Steps 2, 4 and 5 — everything that depends only on the sender and its stable header signals.
// Cacheable per address.
export function classifySender(signals, exemptions) {
  if (!signals) return verdict(INBOX, 'no-signals');
  if (isExempt(signals, exemptions)) return verdict(INBOX, 'exempt-correspondent');

  // The positive noise signal. `is_bulk` means MailFlow saw List-Unsubscribe, List-Id, List-Post or
  // Precedence: bulk|list at ingest; `category` means it recognised a mailing-list, marketing-
  // platform, auto-submitted or social sender. Absent both, there is no evidence this is bulk mail,
  // and INV-2 is explicit that the classifier must then leave it alone.
  const mapped = bundleForCategory(signals.category);
  if (!signals.isBulk && !mapped) return verdict(INBOX, 'no-bulk-signal');

  // Bulk headers but no category MailFlow recognised. The List-* headers are themselves the
  // mailing-list signal, so this is a newsletter by definition of the header that produced it.
  if (!mapped) return verdict(bundleForCategory('newsletter'), 'bulk-headers');

  return verdict(mapped, `category:${signals.category}`);
}

// The full procedure for one stored message row.
//
// `exemptions` comes from neverBundle.getExemptions. `cache` is optional and, when supplied, is a
// Map-like of address → sender verdict which this call reads and populates.
export function classifyMessage(row, exemptions, cache = null) {
  const signals = extractSignals(row);
  if (!signals) return verdict(INBOX, 'no-signals');

  // Per-message, never cached — see the header comment.
  const guard = guardReason(signals);
  if (guard) return verdict(INBOX, `guard:${guard}`);

  const cached = cache?.get(signals.from);
  if (cached) return cached;

  const result = classifySender(signals, exemptions);
  cache?.set(signals.from, result);
  return result;
}

// Whether a verdict places the message in a bundle.
export const isBundled = (v) => !!v && v.bundle !== INBOX;

export { INBOX };
