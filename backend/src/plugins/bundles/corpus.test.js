import { describe, it, expect } from 'vitest';

import { runCorpus, describeViolations } from './corpus.js';
import { loadCorpus } from './corpusFixtures.js';

const { records, source } = await loadCorpus();
const report = runCorpus(records);

describe(`GATE 1 — corpus (${records.length} messages from ${source})`, () => {
  // The gate. Both are pass/fail in §3, and a single violation resets the 30-day clock.
  it('S-6: zero never-bundle-set messages misclassified into a bundle', () => {
    expect(report.s6Violations, `\n${describeViolations(report.s6Violations)}`).toHaveLength(0);
  });

  it('S-7: zero security, financial, or transactional messages bundled', () => {
    expect(report.s7Violations, `\n${describeViolations(report.s7Violations)}`).toHaveLength(0);
  });

  // INV-2's expensive direction: real mail bundled. Distinct from S-6/S-7 because a message can be
  // neither a correspondent's nor sensitive and still belong in the inbox.
  it('no message whose reviewed truth is "inbox" is bundled', () => {
    expect(report.falsePositives, `\n${describeViolations(report.falsePositives)}`).toHaveLength(0);
  });

  // The counterweight. A guard tuned until nothing bundles passes every assertion above and
  // delivers nothing — this is what stops the guard being "fixed" by making it fire more.
  it('bundles at least 80% of the mail that should bundle', () => {
    expect(report.recall).toBeGreaterThanOrEqual(0.8);
  });

  it('reports the classification spread for review', () => {
    // Not an assertion so much as the harness's output. Printed on every run so a drift in the
    // distribution is visible without digging.
    console.log(
      `[bundles corpus] ${records.length} messages · accuracy ${(report.accuracy * 100).toFixed(1)}%`
      + ` · recall ${(report.recall * 100).toFixed(1)}%\n`
      + `  spread: ${JSON.stringify(report.byBundle)}\n`
      + `  left loose (cheap failures): ${report.falseNegatives.length}`
    );
    expect(report.total).toBe(records.length);
  });
});

describe('corpus harness', () => {
  it('models the never-bundle set from the corpus itself', () => {
    const correspondents = records.filter((r) => r.correspondent);
    expect(correspondents.length).toBeGreaterThan(0);
    for (const rec of correspondents) {
      const row = report.results.find((r) => r.rec === rec);
      expect(row.verdict.bundle).toBe('inbox');
      expect(row.verdict.reason).toBe('exempt-correspondent');
    }
  });

  it('holds back both of the failures named in the spec', () => {
    const vmware = report.results.find((r) => r.rec.subject.includes('VMSA-2026-0011'));
    const binance = report.results.find((r) => r.rec.subject.startsWith('Action Required'));
    expect(vmware.verdict).toEqual({ bundle: 'inbox', reason: 'guard:security' });
    expect(binance.verdict).toEqual({ bundle: 'inbox', reason: 'guard:security' });
  });

  it('still bundles genuine marketing from those same senders', () => {
    const vmwareAd = report.results.find((r) => r.rec.subject.includes('vSphere 9'));
    const binanceNews = report.results.find((r) => r.rec.subject === 'Weekly market roundup');
    expect(vmwareAd.verdict.bundle).toBe('promotions');
    expect(binanceNews.verdict.bundle).toBe('newsletters');
  });
});
