import { describe, it, expect } from 'vitest';

import {
  buildExemptions, isExempt, correspondentsFromThreadMessages, recipientsOf, NO_EXEMPTIONS,
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
  const OWN = ['me@mine.com', 'alias@mine.com'];

  it('keeps inbound senders from threads the client sent into', () => {
    const messages = [
      { folder: 'Sent', from_email: 'me@mine.com' },
      { folder: 'INBOX', from_email: 'sam@partner.com' },
      { folder: 'Archive', from_email: 'dana@collab.org' },
    ];
    expect(correspondentsFromThreadMessages(messages, OWN))
      .toEqual(['dana@collab.org', 'sam@partner.com']);
  });

  it('excludes the account’s own addresses and aliases', () => {
    const messages = [
      { folder: 'INBOX', from_email: 'me@mine.com' },
      { folder: 'INBOX', from_email: 'alias@mine.com' },
      { folder: 'INBOX', from_email: 'sam@partner.com' },
    ];
    expect(correspondentsFromThreadMessages(messages, OWN)).toEqual(['sam@partner.com']);
  });

  it('dedupes and sorts', () => {
    const messages = [
      { folder: 'INBOX', from_email: 'b@x.com' },
      { folder: 'INBOX', from_email: 'B@X.com' },
      { folder: 'INBOX', from_email: 'a@x.com' },
    ];
    expect(correspondentsFromThreadMessages(messages, OWN)).toEqual(['a@x.com', 'b@x.com']);
  });

  it('returns an empty set for empty or missing input rather than throwing', () => {
    expect(correspondentsFromThreadMessages(null, OWN)).toEqual([]);
    expect(correspondentsFromThreadMessages([], OWN)).toEqual([]);
    expect(correspondentsFromThreadMessages([{ folder: 'INBOX', from_email: '' }], OWN)).toEqual([]);
  });

  // Outbound is decided by SENDER, not folder. The account's folder_mappings.sent defaults to {}
  // and is never populated at creation, so a folder test would silently fail on any server whose
  // Sent folder is not called 'Sent' — and would then count the client's own copies as
  // correspondents.
  it('treats the account’s own mail as outbound wherever it lives', () => {
    const messages = [
      { folder: 'Gesendet', from_email: 'me@mine.com' },
      { folder: 'Éléments envoyés', from_email: 'alias@mine.com' },
      { folder: 'INBOX', from_email: 'sam@partner.com' },
    ];
    expect(correspondentsFromThreadMessages(messages, OWN)).toEqual(['sam@partner.com']);
  });
});

describe('recipientsOf', () => {
  const OWN = ['me@mine.com', 'alias@mine.com'];

  it('collects To and Cc, excluding the account’s own addresses', () => {
    const row = {
      to_addresses: [{ name: 'Sam', email: 'Sam@Partner.com' }, { name: 'Me', email: 'me@mine.com' }],
      cc_addresses: [{ name: 'Dana', email: 'dana@collab.org' }],
    };
    expect(recipientsOf(row, OWN)).toEqual(['dana@collab.org', 'sam@partner.com']);
  });

  // A reply sent FROM MailFlow is stamped with its own Message-ID as thread_id, so it is
  // permanently a thread of one and the participation scan can never reach the person being
  // replied to. Reading the row's recipients is what recovers them.
  it('recovers the correspondent from a sent message that threads alone', () => {
    const lonelySentReply = {
      from_email: 'me@mine.com',
      to_addresses: [{ name: 'Sam', email: 'sam@partner.com' }],
      cc_addresses: [],
    };
    expect(correspondentsFromThreadMessages([lonelySentReply], OWN)).toEqual([]);
    expect(recipientsOf(lonelySentReply, OWN)).toEqual(['sam@partner.com']);
  });

  it('tolerates alternative recipient shapes rather than throwing', () => {
    expect(recipientsOf({ to_addresses: ['sam@partner.com'] }, OWN)).toEqual(['sam@partner.com']);
    expect(recipientsOf({ to_addresses: [{ address: 'sam@partner.com' }] }, OWN)).toEqual(['sam@partner.com']);
  });

  it('is empty for a missing or malformed row', () => {
    expect(recipientsOf(null, OWN)).toEqual([]);
    expect(recipientsOf({}, OWN)).toEqual([]);
    expect(recipientsOf({ to_addresses: 'not-an-array' }, OWN)).toEqual([]);
    expect(recipientsOf({ to_addresses: [{ name: 'no address' }] }, OWN)).toEqual([]);
  });

  it('dedupes an address that appears in both To and Cc', () => {
    const row = {
      to_addresses: [{ email: 'sam@partner.com' }],
      cc_addresses: [{ email: 'SAM@partner.com' }],
    };
    expect(recipientsOf(row, OWN)).toEqual(['sam@partner.com']);
  });
});
