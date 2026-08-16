// Exemption matching — the pure half of the never-bundle set (INV-4).
//
// Split from neverBundle.js so the classifier stays a pure function. neverBundle.js does the IO
// (scan the mailbox, cache the result, patch it when the client sends mail) and imports the plugin
// capability surface to do it; this module is data in, answer out. The consequence that matters:
// classifier.js imports nothing from ../api.js, so classification is genuinely "a table lookup"
// (INV-3) rather than something that merely aspires to be, and its tests need no mocks at all.

import { normalizeAddress, addressDomain } from './signals.js';

// Build the matcher from a derived address list and the manual override list.
//
// An override may be a bare address ('alerts@bank.com') or a domain ('bank.com'). Domains are
// matched against the sender's domain, so one entry covers a sender that rotates its local part —
// which is what keeps the override list at the 5-to-10 entries the spec expects and S-10 caps.
export function buildExemptions(addresses = [], overrides = []) {
  const addrSet = new Set();
  const domainSet = new Set();
  for (const raw of addresses) {
    const addr = normalizeAddress(raw);
    if (addr) addrSet.add(addr);
  }
  for (const raw of overrides) {
    const entry = normalizeAddress(raw);
    if (!entry) continue;
    if (entry.includes('@')) addrSet.add(entry);
    else domainSet.add(entry);
  }
  return { addresses: addrSet, domains: domainSet };
}

// The empty matcher. Used when an account has no derived set yet — note that empty means "nothing
// is exempt", which is safe only because exemption is one of several reasons a message stays in
// the inbox, never the only one.
export const NO_EXEMPTIONS = Object.freeze({ addresses: new Set(), domains: new Set() });

// Whether a sender is exempt from bundling.
export function isExempt(signals, exemptions) {
  if (!signals || !exemptions) return false;
  if (exemptions.addresses?.has(signals.from)) return true;
  const domain = signals.fromDomain || addressDomain(signals.from);
  return !!(domain && exemptions.domains?.has(domain));
}

// Pure core of the derivation, kept here with the rest of the pure logic so it is testable without
// a database.
//
// `messages` are the rows of every thread the client has sent into; `sentPaths` the folders that
// count as outbound; `ownAddresses` the account's own addresses and aliases. Returns sorted,
// distinct correspondent addresses — every address that has written to the client in a thread the
// client also wrote in, which is "every address ever replied to" approached from the other side.
export function correspondentsFromThreadMessages(messages, sentPaths, ownAddresses) {
  const sent = new Set(sentPaths || []);
  const own = new Set((ownAddresses || []).map(normalizeAddress).filter(Boolean));
  const out = new Set();
  for (const row of messages || []) {
    // A row in a Sent folder is the client's own outbound copy — its from_email is the client.
    if (sent.has(row.folder)) continue;
    const addr = normalizeAddress(row.from_email);
    if (!addr || own.has(addr)) continue;
    out.add(addr);
  }
  return [...out].sort();
}
