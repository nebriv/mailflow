// The classifier's input boundary (INV-3).
//
// Classification reads HEADERS AND SENDER ONLY. It must never read a message body. That is not a
// style preference — it is the invariant that keeps classification a cheap table lookup instead of
// a content-inspection pass, and it is the property GATE 1 asks a human to verify by code review.
//
// Making that verifiable is this module's whole job. Every other file in the plugin classifies from
// a `Signals` object built here, and `extractSignals` enumerates its fields ONE BY ONE from the
// message row. It never spreads the row (`...row`), so a body column cannot arrive downstream by
// accident even though the row handed to us (loadOwnedMessage returns `m.*`) does carry body_text
// and body_html. The reviewer checks one short function, not the whole plugin.
//
// `signals.test.js` locks this down from the other side: it asserts the extracted object has no
// body-bearing key, and that classification of a message is byte-identical when its body is
// replaced with hostile text. A body read anywhere in the plugin fails that test.
//
// ── What the headers actually are ────────────────────────────────────────────────────────────────
// MailFlow parses RFC headers at ingest (services/messageParser.js) but persists only the DERIVED
// results, not the raw header block. So the header signals reachable from a stored message row are:
//
//   is_bulk           BOOLEAN  — List-Unsubscribe | List-Id | List-Post present, or
//                                Precedence: bulk | list          (detectBulkFromParsedHeaders)
//   category          VARCHAR  — 'newsletter' | 'promotion' | 'automated' | 'social' | 'primary'
//                                folded from List-*/Precedence, Auto-Submitted, Content-Type:
//                                text/calendar, noreply senders, and marketing-platform headers
//                                (Mailchimp/Klaviyo/Marketo/…)   (detectCategoryFromHeaders)
//   list_unsubscribe  TEXT     — the raw List-Unsubscribe value
//   subject           TEXT     — the Subject header
//   from_email/name   VARCHAR  — the From header, parsed
//
// The build spec's Phase 1 names List-Id, Precedence, Auto-Submitted, Feedback-ID and DKIM `d=`.
// The first three survive inside is_bulk/category. Feedback-ID and DKIM `d=` are parsed away at
// ingest and are NOT recoverable from the database. Persisting them would mean a schema migration,
// which INV-23 forbids, and a core diff this build cannot afford (INV-22). They are therefore out
// of scope: they are marketing-ESP fingerprints, and `category === 'promotion'` already carries the
// same signal from the same ingest pass. Nothing in §4 depends on them.
//
// This is a deliberate, recorded narrowing of the Phase 1 signal list — not an oversight.

// Lowercased, trimmed address. Classification is sender-keyed, and a sender's address is the cache
// key, so normalisation has to be total: `Foo@Example.COM ` and `foo@example.com` are one sender.
export function normalizeAddress(addr) {
  return typeof addr === 'string' ? addr.trim().toLowerCase() : '';
}

// The domain half of an address, lowercased ('' when malformed). Used for domain-level exemptions
// and for the transactional guard's sender checks.
export function addressDomain(addr) {
  const at = normalizeAddress(addr).lastIndexOf('@');
  return at === -1 ? '' : normalizeAddress(addr).slice(at + 1);
}

// The local part of an address, lowercased ('' when malformed). A `+tag` suffix is stripped so
// `billing+stripe@` reads as `billing`.
export function addressLocalPart(addr) {
  const norm = normalizeAddress(addr);
  const at = norm.lastIndexOf('@');
  const local = at === -1 ? norm : norm.slice(0, at);
  const plus = local.indexOf('+');
  return plus === -1 ? local : local.slice(0, plus);
}

// Build the classifier's view of a message from a stored row.
//
// Every field is named explicitly. Do not replace this with a spread — see the header comment.
// Returns null for a row with no usable sender, which the classifier treats as "leave in inbox"
// (INV-2: uncertainty resolves toward the inbox, never toward a bundle).
export function extractSignals(row) {
  if (!row) return null;
  const from = normalizeAddress(row.from_email);
  if (!from) return null;
  return {
    id: row.id,
    from,
    fromDomain: addressDomain(from),
    fromLocal: addressLocalPart(from),
    fromName: typeof row.from_name === 'string' ? row.from_name : '',
    // Subject is an RFC 5322 header, so reading it is inside INV-3. It is the only per-message
    // signal fine-grained enough to keep a security advisory out of a bundle whose sender also
    // sends marketing (spec §1.2) — sender-level classification alone cannot separate those.
    subject: typeof row.subject === 'string' ? row.subject : '',
    isBulk: row.is_bulk === true,
    category: typeof row.category === 'string' ? row.category : null,
    hasListUnsubscribe: !!row.list_unsubscribe,
    date: row.date || null,
  };
}

// The keys `extractSignals` is allowed to produce. `signals.test.js` asserts the extracted object
// carries exactly these, so adding a body-bearing field to the returned object fails the suite.
export const SIGNAL_KEYS = Object.freeze([
  'id', 'from', 'fromDomain', 'fromLocal', 'fromName',
  'subject', 'isBulk', 'category', 'hasListUnsubscribe', 'date',
]);
