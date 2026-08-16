// The dry-run report — how GATE 1 is actually measured.
//
// GATE 1's bar is not a unit test. It is:
//
//   [ ] 14 consecutive days live with 0 violations of S-6 and S-7
//
// which needs a way to look at real mail and ask "what would this have done?". That is this module.
// With BUNDLES_DRY_RUN set, the classifier runs on every arrival and records its verdict as an
// annotation, but nothing is written to the mail server; this reads those verdicts back.
//
// ── What to look for ────────────────────────────────────────────────────────────────────────────
// The report lists what WOULD have been bundled. That is the direction that matters, because both
// gate metrics count messages that were bundled and must not have been:
//
//   S-6  a message from someone you correspond with, in a bundle          → pass/fail
//   S-7  a security, financial or transactional message, in a bundle      → pass/fail
//
// A single violation of either resets the 30-day clock (§3), so the list is meant to be scanned for
// anything that does not belong rather than tallied. Mail the classifier left alone is not listed:
// leaving bulk mail loose costs one row and one swipe (INV-2), and is not a gate failure.
//
// Every entry carries the `reason` the classifier recorded, so a wrong verdict points straight at
// the rule that produced it — `guard:security`, `category:newsletter`, `exempt-correspondent`.
//
// ── The report reads headers only, like the classifier ──────────────────────────────────────────
// Rows are projected through `extractSignals`, the same INV-3 boundary the classifier uses, so the
// report cannot surface a message body either. What you are reading is exactly what the classifier
// saw.

import { loadOwnedMessage, getMessageAnnotations, getThreadKeysInFolders, getMessagesByThreadKeys, logger } from '../api.js';
import { PLUGIN_ID } from './constants.js';
import { config } from './bundlesConfig.js';
import { extractSignals } from './signals.js';
import { BUNDLE_ORDER } from './taxonomy.js';

// Cap the scan. A report is a manual review action over a working inbox, not a mailbox export.
const SCAN_LIMIT = 1000;

// The ids of messages currently live in INBOX for an account.
//
// getThreadKeysInFolders returns thread keys, and getMessagesByThreadKeys then returns every message
// of those threads across all folders — so the INBOX filter has to be applied afterwards, or a
// thread with one INBOX message would drag its archived siblings into the report.
async function inboxRows(accountId) {
  const threadKeys = await getThreadKeysInFolders(accountId, ['INBOX']);
  if (!threadKeys.length) return [];
  const rows = await getMessagesByThreadKeys(accountId, threadKeys);
  return rows.filter((r) => r.folder === 'INBOX').slice(0, SCAN_LIMIT);
}

// Build the report for one account.
export async function dryRunReport(account) {
  const accountId = account.id;
  const rows = await inboxRows(accountId);
  const annotations = await getMessageAnnotations(accountId, rows.map((r) => r.id), PLUGIN_ID);

  // Three populations, and conflating the last two is how the report lies. A message with no
  // annotation has never been judged — it was in the inbox before the plugin was switched on, and
  // `inboxIngest` only ever sees NEW arrivals. Reporting those as "would remain in your inbox"
  // claims a judgement that was never made. Run backfillClassification to close the gap.
  const unclassified = rows.filter((r) => !annotations[r.id]?.bundle).length;

  const wouldBundle = [];
  for (const row of rows) {
    const ann = annotations[row.id];
    if (!ann?.bundle) continue;
    if (ann.bundle === 'inbox') continue; // judged, and deliberately left alone

    // Re-read the row for its header fields, then project through the classifier's own boundary so
    // the report can never show more than the classifier could see.
    let signals = null;
    try {
      signals = extractSignals(await loadOwnedMessage(account.user_id, row.id));
    } catch (err) {
      logger.debug(`[bundles] dry-run report skipped ${row.id}: ${err.message}`);
    }

    wouldBundle.push({
      id: row.id,
      bundle: ann.bundle,
      reason: ann.reason || null,
      classifiedAt: ann.classifiedAt || null,
      from: signals?.from || row.from_email || null,
      fromName: signals?.fromName || null,
      subject: signals?.subject ?? null,
      date: row.date || null,
    });
  }

  wouldBundle.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const byBundle = {};
  for (const key of BUNDLE_ORDER) byBundle[key] = 0;
  for (const entry of wouldBundle) byBundle[entry.bundle] = (byBundle[entry.bundle] || 0) + 1;

  // Distinct senders per bundle. A sender is classified once, so this is the size of the decision
  // set actually being reviewed — far smaller than the message count, and the number that says how
  // much there is to check.
  const sendersByBundle = {};
  for (const entry of wouldBundle) {
    (sendersByBundle[entry.bundle] ||= new Set()).add(entry.from);
  }

  return {
    dryRun: config.DRY_RUN,
    scanned: rows.length,
    truncated: rows.length >= SCAN_LIMIT,
    wouldBundle: wouldBundle.length,
    // Judged and left in the inbox — NOT the same as never judged, which is `unclassified`.
    wouldRemain: rows.length - wouldBundle.length - unclassified,
    unclassified,
    byBundle,
    distinctSenders: Object.fromEntries(
      Object.entries(sendersByBundle).map(([k, v]) => [k, v.size])
    ),
    // How many inbox rows the bundles would have replaced — the compression that INV-8's row budget
    // is about. One row per non-empty bundle, versus one row per message.
    // Row compression, but only meaningful once everything has been judged — with a backlog of
    // unclassified mail this understates it, because unjudged messages are counted as staying.
    rowsBefore: rows.length,
    rowsAfter: rows.length - wouldBundle.length + Object.values(byBundle).filter((n) => n > 0).length,
    messages: wouldBundle,
  };
}
