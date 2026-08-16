import { describe, it, expect } from 'vitest';

import {
  normalizeAddress, addressDomain, addressLocalPart, extractSignals, SIGNAL_KEYS,
} from './signals.js';
import { classifyMessage } from './classifier.js';

// A stored message row as loadOwnedMessage returns it (SELECT m.*), body columns included. The
// point of most tests here is that the body columns are present in the INPUT and absent from
// everything downstream.
const row = (over = {}) => ({
  id: 'msg-1',
  from_email: 'News@Example.COM',
  from_name: 'Example News',
  subject: 'This week at Example',
  is_bulk: true,
  category: 'newsletter',
  list_unsubscribe: '<https://example.com/u>',
  date: new Date('2026-08-16T09:00:00Z'),
  body_text: 'plain text body',
  body_html: '<p>html body</p>',
  snippet: 'a snippet',
  ...over,
});

describe('address helpers', () => {
  it('normalizes case and surrounding whitespace', () => {
    expect(normalizeAddress('  Foo@Example.COM ')).toBe('foo@example.com');
  });

  it('returns empty string for non-string input', () => {
    for (const bad of [null, undefined, 42, {}, []]) expect(normalizeAddress(bad)).toBe('');
  });

  it('splits domain and local part', () => {
    expect(addressDomain('a@b.com')).toBe('b.com');
    expect(addressLocalPart('a@b.com')).toBe('a');
  });

  it('uses the LAST @ so a quoted local part cannot spoof the domain', () => {
    expect(addressDomain('"a@evil.com"@real.com')).toBe('real.com');
  });

  it('strips a +tag from the local part', () => {
    expect(addressLocalPart('billing+stripe@shop.com')).toBe('billing');
  });

  it('returns empty domain for a malformed address', () => {
    expect(addressDomain('not-an-address')).toBe('');
  });
});

describe('extractSignals — the INV-3 boundary', () => {
  it('produces exactly the declared signal keys', () => {
    expect(Object.keys(extractSignals(row())).sort()).toEqual([...SIGNAL_KEYS].sort());
  });

  // The load-bearing assertion of the whole plugin. GATE 1 asks a human to verify by code review
  // that no message body is read; this asserts it from the other side, so a future edit that starts
  // reading a body fails the suite rather than quietly passing review.
  it('carries no body-bearing field', () => {
    const signals = extractSignals(row());
    for (const key of ['body_text', 'body_html', 'snippet', 'content', 'body', 'text', 'html']) {
      expect(signals).not.toHaveProperty(key);
    }
    expect(JSON.stringify(signals)).not.toContain('plain text body');
    expect(JSON.stringify(signals)).not.toContain('html body');
    expect(JSON.stringify(signals)).not.toContain('a snippet');
  });

  it('normalizes the sender and derives its parts', () => {
    const s = extractSignals(row());
    expect(s.from).toBe('news@example.com');
    expect(s.fromDomain).toBe('example.com');
    expect(s.fromLocal).toBe('news');
  });

  it('returns null when there is no usable sender', () => {
    expect(extractSignals(row({ from_email: '' }))).toBeNull();
    expect(extractSignals(row({ from_email: null }))).toBeNull();
    expect(extractSignals(null)).toBeNull();
  });

  it('coerces missing text fields to empty strings rather than undefined', () => {
    const s = extractSignals(row({ subject: null, from_name: undefined }));
    expect(s.subject).toBe('');
    expect(s.fromName).toBe('');
  });

  it('treats is_bulk as strictly boolean true', () => {
    expect(extractSignals(row({ is_bulk: null })).isBulk).toBe(false);
    expect(extractSignals(row({ is_bulk: 'true' })).isBulk).toBe(false);
    expect(extractSignals(row({ is_bulk: true })).isBulk).toBe(true);
  });
});

describe('classification is invariant to message bodies (INV-3)', () => {
  const exemptions = { addresses: new Set(), domains: new Set() };

  // If any part of the classifier ever consulted a body, a body engineered to look like a security
  // alert would change the verdict. It must not.
  it('ignores a body engineered to trip the guard', () => {
    const benign = classifyMessage(row(), exemptions);
    const hostile = classifyMessage(row({
      body_text: 'SECURITY ALERT: verification code 123456. Your invoice is past due.',
      body_html: '<h1>action required</h1><p>unauthorized login detected</p>',
      snippet: 'suspicious activity on your account',
    }), exemptions);
    expect(hostile).toEqual(benign);
    expect(hostile.bundle).toBe('newsletters');
  });

  // And the converse: a body that reads as marketing must not rescue a subject the guard catches.
  it('ignores a body engineered to look benign', () => {
    const guarded = classifyMessage(row({
      subject: 'Security alert: new sign-in from an unrecognized device',
      body_text: 'Shop our summer sale! Unsubscribe any time.',
    }), exemptions);
    expect(guarded.bundle).toBe('inbox');
    expect(guarded.reason).toBe('guard:security');
  });

  it('is unchanged when the body columns are absent entirely', () => {
    const withBody = classifyMessage(row(), exemptions);
    const bare = { ...row() };
    delete bare.body_text; delete bare.body_html; delete bare.snippet;
    expect(classifyMessage(bare, exemptions)).toEqual(withBody);
  });
});
