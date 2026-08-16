// The corpus test harness (GATE 1).
//
// Phase 1's gate is not "the code compiles" — it is a measurement over real mail:
//
//   [ ] Corpus test: 0 never-bundle-set messages misclassified          (S-6)
//   [ ] Corpus test: 0 security, financial, or transactional bundled    (S-7)
//
// S-6 and S-7 are pass/fail, and a single violation resets the 30-day clock (§3). So this harness
// exists to make those two numbers cheap to produce and impossible to fudge, over any corpus.
//
// ── Bring your own corpus ───────────────────────────────────────────────────────────────────────
// The spec calls for 500 real archived messages, classified, reviewed by hand. Real mail cannot be
// committed to a repository, so the harness reads its corpus from BUNDLES_CORPUS_PATH when that is
// set (a JSON array of records in the shape below) and otherwise falls back to the committed
// fixture corpus. CI therefore always has teeth, and the client points the same harness at his own
// export to run the real gate:
//
//   BUNDLES_CORPUS_PATH=~/corpus.json npx vitest run src/plugins/bundles/corpus.test.js
//
// ── Record shape ────────────────────────────────────────────────────────────────────────────────
//   from            sender address
//   subject         Subject header
//   is_bulk         as MailFlow computed it at ingest
//   category        as MailFlow computed it at ingest
//   truth           hand-reviewed: 'inbox' or a bundle key — where it SHOULD go
//   sensitive       hand-reviewed: security / financial / transactional (drives S-7)
//   correspondent   hand-reviewed: sender is in the never-bundle set (drives S-6)
//
// `truth` is the reviewer's judgement, which is why the harness reports rather than merely asserts:
// recall against `truth` is information (how much work the bundles actually save), while S-6 and
// S-7 are the gate.

import { classifyMessage } from './classifier.js';
import { buildExemptions } from './exemptions.js';
import { INBOX } from './taxonomy.js';

// Turn a corpus record into the message-row shape the classifier consumes.
export const recordToRow = (rec, i = 0) => ({
  id: rec.id || `corpus-${i}`,
  from_email: rec.from,
  from_name: rec.from_name || '',
  subject: rec.subject,
  is_bulk: rec.is_bulk === true,
  category: rec.category ?? null,
  list_unsubscribe: rec.list_unsubscribe ?? null,
  date: rec.date || null,
});

// Run the classifier over a corpus and return a report.
//
// The exemption set is built from the records themselves (every sender marked `correspondent`),
// which models the derived never-bundle set exactly: those are the addresses the client has replied
// to. `overrides` models the manual list.
export function runCorpus(records, overrides = []) {
  const correspondents = records.filter((r) => r.correspondent).map((r) => r.from);
  const exemptions = buildExemptions(correspondents, overrides);

  const results = records.map((rec, i) => {
    const verdict = classifyMessage(recordToRow(rec, i), exemptions);
    return { rec, verdict, bundled: verdict.bundle !== INBOX };
  });

  // The two gate metrics. Both count messages that were bundled but must not have been.
  const s6 = results.filter((r) => r.rec.correspondent && r.bundled);
  const s7 = results.filter((r) => r.rec.sensitive && r.bundled);

  // Informational. A false positive is any message whose truth is 'inbox' that got bundled — the
  // trust-destroying direction (INV-2). A false negative is bulk mail left loose, which costs one
  // row and one swipe.
  const falsePositives = results.filter((r) => r.rec.truth === INBOX && r.bundled);
  const falseNegatives = results.filter((r) => r.rec.truth !== INBOX && !r.bundled);
  const correct = results.filter((r) => r.verdict.bundle === r.rec.truth);

  const byBundle = {};
  for (const r of results) byBundle[r.verdict.bundle] = (byBundle[r.verdict.bundle] || 0) + 1;

  return {
    total: records.length,
    results,
    byBundle,
    s6Violations: s6,
    s7Violations: s7,
    falsePositives,
    falseNegatives,
    accuracy: records.length ? correct.length / records.length : 1,
    // Of the mail that SHOULD bundle, how much actually did. This is the number that decides
    // whether the row budget is met — a guard tuned until nothing bundles would pass S-6 and S-7
    // perfectly and deliver nothing.
    recall: (() => {
      const shouldBundle = results.filter((r) => r.rec.truth !== INBOX);
      if (!shouldBundle.length) return 1;
      return shouldBundle.filter((r) => r.bundled).length / shouldBundle.length;
    })(),
  };
}

// One-line explanation per offending message, for a failure message a human can act on.
export const describeViolations = (violations) =>
  violations.map((v) => `  ${v.rec.from} — "${v.rec.subject}" → ${v.verdict.bundle} (${v.verdict.reason})`).join('\n');
