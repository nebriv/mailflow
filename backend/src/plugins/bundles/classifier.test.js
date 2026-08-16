import { describe, it, expect } from 'vitest';

import { classifyMessage, classifySender, isBundled, INBOX } from './classifier.js';
import { buildExemptions, NO_EXEMPTIONS } from './exemptions.js';
import { extractSignals } from './signals.js';
import { BUNDLES } from './taxonomy.js';

const row = (over = {}) => ({
  id: 'm1',
  from_email: 'news@vendor.com',
  from_name: 'Vendor',
  subject: 'This week at Vendor',
  is_bulk: true,
  category: 'newsletter',
  date: new Date('2026-08-16T09:00:00Z'),
  ...over,
});

describe('classifySender — the sender-level half', () => {
  it('maps each MailFlow category to its bundle', () => {
    const cases = [
      ['newsletter', BUNDLES.NEWSLETTERS],
      ['promotion', BUNDLES.PROMOTIONS],
      ['automated', BUNDLES.NOTIFICATIONS],
      ['social', BUNDLES.SOCIAL],
    ];
    for (const [category, bundle] of cases) {
      const v = classifySender(extractSignals(row({ category })), NO_EXEMPTIONS);
      expect(v).toEqual({ bundle, reason: `category:${category}` });
    }
  });

  it('treats bulk headers with no recognised category as a newsletter', () => {
    const v = classifySender(extractSignals(row({ category: null, is_bulk: true })), NO_EXEMPTIONS);
    expect(v).toEqual({ bundle: BUNDLES.NEWSLETTERS, reason: 'bulk-headers' });
  });

  // INV-2: absence of evidence is not evidence. No bulk signal means the message stays put.
  it('leaves a message with no bulk signal in the inbox', () => {
    for (const category of [null, 'primary']) {
      const v = classifySender(extractSignals(row({ is_bulk: false, category })), NO_EXEMPTIONS);
      expect(v).toEqual({ bundle: INBOX, reason: 'no-bulk-signal' });
    }
  });

  it('exempts a derived correspondent regardless of headers', () => {
    const ex = buildExemptions(['news@vendor.com'], []);
    expect(classifySender(extractSignals(row()), ex))
      .toEqual({ bundle: INBOX, reason: 'exempt-correspondent' });
  });

  it('exempts by domain when an override names one', () => {
    const ex = buildExemptions([], ['vendor.com']);
    expect(classifySender(extractSignals(row()), ex).reason).toBe('exempt-correspondent');
  });

  it('returns a reason rather than throwing on null signals', () => {
    expect(classifySender(null, NO_EXEMPTIONS)).toEqual({ bundle: INBOX, reason: 'no-signals' });
  });
});

describe('classifyMessage — the full procedure', () => {
  it('runs the guard before the sender verdict', () => {
    const v = classifyMessage(row({ subject: 'Your invoice for August' }), NO_EXEMPTIONS);
    expect(v).toEqual({ bundle: INBOX, reason: 'guard:financial' });
  });

  // The distinction the whole design rests on: a sender who sends both marketing and security mail
  // is NOT exempt (their marketing should bundle), but their security mail must still be held.
  it('holds one message from a bundled sender without exempting the sender', () => {
    const marketing = classifyMessage(row({ subject: 'New features this month' }), NO_EXEMPTIONS);
    const alert = classifyMessage(row({ subject: 'Security alert: new sign-in' }), NO_EXEMPTIONS);
    expect(marketing.bundle).toBe(BUNDLES.NEWSLETTERS);
    expect(alert.bundle).toBe(INBOX);
  });

  it('leaves a message with no sender in the inbox', () => {
    expect(classifyMessage(row({ from_email: null }), NO_EXEMPTIONS))
      .toEqual({ bundle: INBOX, reason: 'no-signals' });
  });

  it('isBundled reflects the verdict', () => {
    expect(isBundled(classifyMessage(row(), NO_EXEMPTIONS))).toBe(true);
    expect(isBundled(classifyMessage(row({ is_bulk: false, category: 'primary' }), NO_EXEMPTIONS))).toBe(false);
    expect(isBundled(null)).toBe(false);
  });
});

describe('the sender cache', () => {
  it('reuses a sender verdict for a second message from that sender', () => {
    const cache = new Map();
    classifyMessage(row(), NO_EXEMPTIONS, cache);
    expect(cache.get('news@vendor.com')).toEqual({ bundle: BUNDLES.NEWSLETTERS, reason: 'category:newsletter' });

    // Second message from the same sender with a category that would map elsewhere. The cached
    // sender verdict wins — that is what "a sender is classified once" means.
    const second = classifyMessage(row({ subject: 'Another edition', category: 'promotion' }), NO_EXEMPTIONS, cache);
    expect(second.bundle).toBe(BUNDLES.NEWSLETTERS);
  });

  it('keys the cache on the normalized address', () => {
    const cache = new Map();
    classifyMessage(row({ from_email: '  News@Vendor.COM ' }), NO_EXEMPTIONS, cache);
    expect([...cache.keys()]).toEqual(['news@vendor.com']);
  });

  // The guard is per-message and must never be cached, or the first benign message from a sender
  // would let every later security alert from that sender through.
  it('never lets a cached sender verdict bypass the guard', () => {
    const cache = new Map();
    const first = classifyMessage(row(), NO_EXEMPTIONS, cache);
    expect(first.bundle).toBe(BUNDLES.NEWSLETTERS);

    const alert = classifyMessage(row({ subject: 'Your verification code is 1234' }), NO_EXEMPTIONS, cache);
    expect(alert).toEqual({ bundle: INBOX, reason: 'guard:security' });
  });

  it('produces the same verdicts with and without a cache', () => {
    const rows = [
      row(),
      row({ from_email: 'a@b.com', category: 'promotion' }),
      row({ from_email: 'c@d.com', subject: 'Your order #12 has shipped' }),
      row({ from_email: 'a@b.com', category: 'promotion' }),
    ];
    const cache = new Map();
    const cached = rows.map((r) => classifyMessage(r, NO_EXEMPTIONS, cache));
    const uncached = rows.map((r) => classifyMessage(r, NO_EXEMPTIONS));
    expect(cached).toEqual(uncached);
  });
});

describe('INV-1 — the classifier does not rank', () => {
  // There is no score, rank, priority or urgency anywhere in a verdict. This asserts the shape so a
  // future change that adds one has to delete this test and explain itself.
  it('returns only a bundle and a reason', () => {
    const v = classifyMessage(row(), NO_EXEMPTIONS);
    expect(Object.keys(v).sort()).toEqual(['bundle', 'reason']);
    expect(typeof v.bundle).toBe('string');
    expect(typeof v.reason).toBe('string');
  });
});
