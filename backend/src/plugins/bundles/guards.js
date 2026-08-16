// The transactional / security guard (S-7, INV-2).
//
// This is the file the whole project rests on. §1.2 of the spec: the client's Newsletters bucket
// contains a CRITICAL VMware vCenter advisory and a Binance account-action notice, because both
// carry List-Unsubscribe and header classification therefore files them with marketing. Refusing to
// bulk-archive that bucket is the correct response to an unreliable classifier. Sweep confidence is
// downstream of classifier precision, so until this guard works, nothing else in the build matters.
//
// Sender-level classification cannot fix it. VMware and Binance genuinely do send marketing from
// the same domains, often the same ESP, with the same bulk headers. The only signal that separates
// "your account was accessed from a new device" from "upgrade to vSphere 9" is the Subject line —
// a header, so inside INV-3.
//
// ── The asymmetry that sets the tuning ──────────────────────────────────────────────────────────
// INV-2: a false positive (real mail bundled) permanently destroys trust in sweep. A false negative
// (bulk mail left loose) costs one row and one swipe. Those are not comparable, so this guard is
// deliberately over-inclusive. When it fires on a marketing email, the cost is that the client
// swipes one extra row. When it fails to fire on a security alert, the cost is the entire feature.
//
// It follows that the guard is NOT tuned toward precision. Anything reading as security, money, a
// transaction, a booking or an account lifecycle event stays in the inbox, and that is the intended
// behaviour even when it is technically wrong.
//
// ── Why phrases and not single words ────────────────────────────────────────────────────────────
// Over-inclusive still has a floor. A bare 'order' would fire on "Order your copy today" and a bare
// 'save' on every promotion in existence, which would leave Promotions permanently empty and blow
// ROW_BUDGET — the guard would then be destroying the feature it exists to protect. So ambiguous
// words appear only inside multi-word phrases that marketing copy does not naturally produce
// ('your order', 'order #'), while words that are unambiguous on their own ('invoice', 'passcode')
// stand alone. Each list below records which side of that line it sits on.
//
// ── Matching is token-based, not substring ──────────────────────────────────────────────────────
// Subject lines are attacker-controlled input and the repo carries a ReDoS audit
// (npm run audit:redos), so there is no pattern matching with backtracking here. Normalisation uses
// two linear character-class replacements and everything after that is set membership.
//
// Plain substring matching was tried first and is wrong: 'deactivated' contains 'vat', 'innovative'
// contains 'vat', 'private' contains 'vat'. A guard that fires on every message containing the
// letters v-a-t holds back the entire Promotions bundle, which is the guard destroying the feature
// it exists to protect. Needles are therefore matched by one of three rules:
//
//   'security alert'  contains a space → substring match on the normalised subject. Safe, because a
//                                        multi-word phrase cannot hide inside a single word.
//   'vulnerab*'       trailing star    → prefix match against a whole token. Covers inflections
//                                        ('vulnerability', 'vulnerabilities') without matching
//                                        across a word boundary.
//   'otp'             bare             → exact whole-token match. Short, ambiguous tokens use this.
//
// Choosing the rule per needle is the entire tuning surface of the guard, so each list below is
// written with the rule visible on every entry.

import { BUNDLES } from './taxonomy.js';

// Lowercase; collapse punctuation that is not part of a token to spaces; squeeze runs of spaces.
// '#' and '-' survive because 'order #10482', 'cve-2026-1337' and 'end-of-life' depend on them.
// Both replacements are single-pass character classes — linear, nothing to backtrack.
export function normalizeSubject(subject) {
  return (typeof subject === 'string' ? subject : '')
    .toLowerCase()
    .replace(/[^a-z0-9#+\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Match one needle under the three rules described above.
function matchNeedle(normalized, tokens, needle) {
  if (needle.includes(' ')) return normalized.includes(needle);
  if (needle.endsWith('*')) {
    const stem = needle.slice(0, -1);
    return tokens.some((t) => t.startsWith(stem));
  }
  return tokens.includes(needle);
}

// Security and account-integrity language. 'critical', 'advisory' and 'cve-*' catch the VMware
// case; 'action required' catches the Binance case.
const SECURITY_PHRASES = Object.freeze([
  // phrases — unambiguous once more than one word is required
  'security alert', 'security notice', 'security advisory', 'security code', 'security update',
  'unusual activity', 'unusual sign', 'new sign-in', 'new sign in', 'new login', 'new device',
  'unrecognized device', 'unrecognised device', 'verification code', 'one time code',
  'recovery code', 'backup code', 'account locked', 'account suspended', 'account compromised',
  'account access', 'data breach', 'patch now', 'end of support',
  'action required', 'action needed', 'immediate attention', 'urgent action',
  'confirm your identity', 'verify your identity', 'verify your account',
  'verify your email', 'confirm your email',
  // stems — cover inflections without crossing a word boundary
  'password*', 'authenticat*', 'vulnerab*', 'compromis*', 'breach*', 'cve-*', 'exploit*',
  // whole tokens — short or ambiguous enough that a substring match would over-fire
  'suspicious', 'unauthorized', 'unauthorised', 'passcode', 'passphrase',
  'otp', '2fa', 'mfa', 'two-factor', 'one-time', 'zero-day', 'end-of-life',
  'critical', 'advisory', 'advisories', 'phishing',
]);

// Money.
const FINANCIAL_PHRASES = Object.freeze([
  // phrases
  'charge of', 'wire transfer', 'direct debit', 'past due', 'balance due', 'amount due',
  'outstanding balance', 'card ending', 'card expiring', 'payment method', 'payment failed',
  'subscription renew', 'auto renew', 'will renew', 'renews on', 'price change', 'plan change',
  // stems
  'invoice*', 'receipt*', 'payment*', 'refund*', 'transaction*', 'withdraw*', 'payout*',
  // whole tokens
  'billing', 'billed', 'charged', 'statement', 'statements', 'deposit', 'payroll',
  'tax', 'taxes', 'vat', 'overdue', 'past-due', 'auto-renew', 'declined',
]);

// Transactions the client is a party to — orders, shipping, bookings, tickets. The list most at
// risk of over-firing, so nearly every entry is a phrase. 'delivered' and 'tracking number' are
// safe because promotional copy uses the future or imperative ('free shipping', 'ships free'),
// not the past participle about a specific parcel.
const TRANSACTIONAL_PHRASES = Object.freeze([
  // phrases
  'your order', 'order #', 'order no', 'order number', 'order confirm', 'order update',
  'order has', 'order is', 'order was', 'purchase confirm', 'your purchase',
  'has shipped', 'is shipped', 'was shipped', 'out for delivery',
  'tracking number', 'tracking info', 'your package', 'your parcel', 'your shipment',
  'your booking', 'your reservation', 'your itinerary', 'your flight', 'your trip',
  'boarding pass', 'check in for', 'your ticket', 'your appointment',
  'appointment confirm', 'appointment remind', 'your subscription',
  'your account', 'your claim', 'your policy', 'your application', 'your request',
  // whole tokens
  'delivered', 'check-in',
]);

// Calendar. MailFlow maps text/calendar to category 'automated', which would otherwise bundle a
// meeting invite into Notifications — an invite is actionable mail and must never be swept. The
// Content-Type is not persisted, so the subject conventions Google/Outlook emit are the signal.
const CALENDAR_PREFIXES = Object.freeze([
  'invitation:', 'updated invitation:', 'accepted:', 'declined:', 'tentative:',
  'canceled:', 'cancelled:', 'canceled event:', 'cancelled event:',
  'new event:', 'updated event:', 'reminder:', 'rsvp:',
]);

// Account lifecycle and legal — mail that changes the terms of a relationship. Rare, and always
// worth a row.
const LIFECYCLE_PHRASES = Object.freeze([
  // phrases
  'terms of service', 'terms of use', 'privacy policy', 'policy update',
  'account will be', 'account has been', 'will be deactivated', 'will be deleted',
  'will be closed', 'service discontinued', 'shutting down',
  // stems
  'deactivat*', 'terminat*', 'discontinu*',
]);

// Sender local parts that only ever front operational mail. Kept short on purpose: 'alerts@' and
// 'notifications@' are NOT here, because Zillow and every other newsletter the client enjoys send
// from exactly those, and exempting them would empty the bundles.
const OPERATIONAL_LOCAL_PARTS = Object.freeze([
  'security', 'security-noreply', 'billing', 'invoices', 'invoice', 'receipts',
  'payments', 'accounts', 'account-security', 'abuse', 'postmaster', 'fraud',
  'verify', 'verification', 'auth', '2fa', 'otp',
]);

const containsAny = (normalized, tokens, needles) =>
  needles.some((n) => matchNeedle(normalized, tokens, n));

// Calendar prefixes are matched against the RAW lowercased subject, not the normalised one, because
// the trailing colon is the whole signal ('Invitation:' is a Google Calendar invite;
// 'Your exclusive invitation' is marketing) and normalisation strips it.
const startsWithAny = (rawLower, prefixes) => prefixes.some((p) => rawLower.startsWith(p));

// Why this message must stay in the inbox, or null if the guard has no objection.
//
// Returns a REASON STRING rather than a boolean. The client can be shown, and the corpus harness
// can report, exactly which rule held a message back — a guard nobody can debug is a guard nobody
// trusts, which is the failure mode this whole build exists to correct.
export function guardReason(signals) {
  if (!signals) return 'no-signals';

  const rawLower = (signals.subject || '').toLowerCase().trim();
  const normalized = normalizeSubject(signals.subject);
  const tokens = normalized ? normalized.split(' ') : [];
  const local = signals.fromLocal || '';

  // Order changes only which reason is reported, never whether the message is held: every branch
  // returns a truthy reason and the caller treats them identically. It is ordered most-specific
  // first so the reported reason is the most useful one — 'Your account will be deactivated' is a
  // lifecycle notice, and reporting it as 'transactional' (matched via 'your account') would be
  // accurate about the outcome but misleading about the cause.
  if (startsWithAny(rawLower, CALENDAR_PREFIXES)) return 'calendar';
  if (containsAny(normalized, tokens, SECURITY_PHRASES)) return 'security';
  if (containsAny(normalized, tokens, LIFECYCLE_PHRASES)) return 'lifecycle';
  if (containsAny(normalized, tokens, FINANCIAL_PHRASES)) return 'financial';
  if (containsAny(normalized, tokens, TRANSACTIONAL_PHRASES)) return 'transactional';
  if (OPERATIONAL_LOCAL_PARTS.includes(local)) return 'operational-sender';

  return null;
}

// Whether the guard holds this message in the inbox.
export const isGuarded = (signals) => guardReason(signals) !== null;

// Bundles whose contents the guard is allowed to be relaxed for.
//
// It is not: the guard runs identically for every bundle. This export exists so the intent is
// stated in code rather than left implicit — a future change that wants "skip the guard for
// Promotions, it is only marketing anyway" has to edit an empty frozen list and confront that
// Promotions is exactly where an order confirmation from a shop lands.
export const GUARD_EXEMPT_BUNDLES = Object.freeze([]);

// Named for tests and for the corpus harness's per-rule reporting.
export const GUARD_PHRASE_SETS = Object.freeze({
  security: SECURITY_PHRASES,
  financial: FINANCIAL_PHRASES,
  transactional: TRANSACTIONAL_PHRASES,
  calendar: CALENDAR_PREFIXES,
  lifecycle: LIFECYCLE_PHRASES,
  operationalLocalParts: OPERATIONAL_LOCAL_PARTS,
});

// Re-exported so callers importing the guard do not also have to import the taxonomy just to name
// the bundle a guarded message did NOT go into.
export { BUNDLES };
