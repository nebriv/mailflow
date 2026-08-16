import { describe, it, expect } from 'vitest';

import {
  buildExemptions, isExempt, correspondentsFromThreadMessages, NO_EXEMPTIONS,
} from './exemptions.js';
import { extractSignals } from './signals.js';

const sig = (from) => extractSignals({ id: 'm', from_email: from, subject: 's' });

describe('buildExemptions', () => {
  it('normalizes derived addresses', () => {
    const ex = buildExemptions(['  Sam@Partner.COM '], []);
    expect(ex.addresses.has('sam@partner.com')).toBe(true);
  });

  it('routes an override containing @ to addresses and a bare one to domains', () => {
    const ex = buildExemptions([], ['alerts@bank.com', 'bank.com']);
    expect(ex.addresses.has('alerts@bank.com')).toBe(true);
    expect(ex.domains.has('bank.com')).toBe(true);
  });

  it('ignores empty and non-string entries', () => {
    const ex = buildExemptions([null, '', '   ', 42], [undefined, '']);
    expect(ex.addresses.size).toBe(0);
    expect(ex.domains.size).toBe(0);
  });
});

describe('isExempt', () => {
  it('matches an exact address', () => {
    expect(isExempt(sig('sam@partner.com'), buildExemptions(['sam@partner.com'], []))).toBe(true);
  });

  it('matches any sender in an exempt domain', () => {
    const ex = buildExemptions([], ['bank.com']);
    expect(isExempt(sig('anything@bank.com'), ex)).toBe(true);
    expect(isExempt(sig('someone@notbank.com'), ex)).toBe(false);
  });

  // A domain override must not match a lookalike that merely ends with it.
  it('does not match a domain by suffix', () => {
    expect(isExempt(sig('a@evilbank.com'), buildExemptions([], ['bank.com']))).toBe(false);
  });

  it('is false for missing arguments', () => {
    expect(isExempt(null, NO_EXEMPTIONS)).toBe(false);
    expect(isExempt(sig('a@b.com'), null)).toBe(false);
  });

  it('treats the empty matcher as exempting nothing', () => {
    expect(isExempt(sig('a@b.com'), NO_EXEMPTIONS)).toBe(false);
  });
});

describe('correspondentsFromThreadMessages', () => {
  const SENT = ['Sent'];
  const OWN = ['me@mine.com', 'alias@mine.com'];

  it('keeps inbound senders from threads the client sent into', () => {
    const messages = [
      { folder: 'Sent', from_email: 'me@mine.com' },
      { folder: 'INBOX', from_email: 'sam@partner.com' },
      { folder: 'Archive', from_email: 'dana@collab.org' },
    ];
    expect(correspondentsFromThreadMessages(messages, SENT, OWN))
      .toEqual(['dana@collab.org', 'sam@partner.com']);
  });

  it('excludes the account’s own addresses and aliases', () => {
    const messages = [
      { folder: 'INBOX', from_email: 'me@mine.com' },
      { folder: 'INBOX', from_email: 'alias@mine.com' },
      { folder: 'INBOX', from_email: 'sam@partner.com' },
    ];
    expect(correspondentsFromThreadMessages(messages, SENT, OWN)).toEqual(['sam@partner.com']);
  });

  it('dedupes and sorts', () => {
    const messages = [
      { folder: 'INBOX', from_email: 'b@x.com' },
      { folder: 'INBOX', from_email: 'B@X.com' },
      { folder: 'INBOX', from_email: 'a@x.com' },
    ];
    expect(correspondentsFromThreadMessages(messages, SENT, OWN)).toEqual(['a@x.com', 'b@x.com']);
  });

  it('returns an empty set for empty or missing input rather than throwing', () => {
    expect(correspondentsFromThreadMessages(null, SENT, OWN)).toEqual([]);
    expect(correspondentsFromThreadMessages([], SENT, OWN)).toEqual([]);
    expect(correspondentsFromThreadMessages([{ folder: 'INBOX', from_email: '' }], SENT, OWN)).toEqual([]);
  });

  it('treats every configured Sent path as outbound', () => {
    const messages = [
      { folder: '[Gmail]/Sent Mail', from_email: 'me@mine.com' },
      { folder: 'INBOX', from_email: 'sam@partner.com' },
    ];
    expect(correspondentsFromThreadMessages(messages, ['Sent', '[Gmail]/Sent Mail'], OWN))
      .toEqual(['sam@partner.com']);
  });
});
