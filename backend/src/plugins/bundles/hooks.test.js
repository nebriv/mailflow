import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  broadcast: vi.fn(),
  storage: { put: vi.fn(), getValue: vi.fn(), getBlob: vi.fn(), del: vi.fn() },
  applyLabel: vi.fn().mockResolvedValue({ applied: true }),
  removeLabel: vi.fn().mockResolvedValue({ removed: true }),
  resolveLabelCopyUid: vi.fn(),
  ensureLabelFolders: vi.fn().mockResolvedValue([]),
  listThreadHeadsByLabels: vi.fn().mockResolvedValue([]),
  resolveAllDraftsPaths: vi.fn().mockResolvedValue([]),
  setMessageAnnotation: vi.fn(),
  getMessageAnnotations: vi.fn().mockResolvedValue({}),
  getAccountConfig: vi.fn().mockResolvedValue({}),
  setAccountConfig: vi.fn(),
  isPluginActivatedForAccount: vi.fn().mockResolvedValue(true),
  listUserAccounts: vi.fn().mockResolvedValue([]),
  loadOwnedMessage: vi.fn(),
  getThreadKeysForMessageIdHeaders: vi.fn().mockResolvedValue([]),
  getThreadKeysInFolders: vi.fn().mockResolvedValue([]),
  getMessagesByThreadKeys: vi.fn().mockResolvedValue([]),
  getAccountAddresses: vi.fn().mockResolvedValue([]),
}));

import {
  storage, applyLabel, removeLabel, listThreadHeadsByLabels, setMessageAnnotation,
  getMessageAnnotations, getAccountConfig, setAccountConfig, loadOwnedMessage,
  getThreadKeysForMessageIdHeaders, getMessagesByThreadKeys, isPluginActivatedForAccount, getAccountAddresses,
} from '../api.js';
import {
  inboxIngest, onSentMessage, autoFileAged, migrateToZero, bundlesEnabledForAccount,
  relocateExemptFolders,
} from './hooks.js';

const ACCOUNT = { id: 'acct-1', user_id: 'user-1', folder_mappings: { sent: 'Sent' } };

const row = (id, over = {}) => ({
  id,
  from_email: 'news@vendor.com',
  from_name: 'Vendor',
  subject: 'This week at Vendor',
  is_bulk: true,
  category: 'newsletter',
  uid: 10,
  folder: 'INBOX',
  message_id: `<${id}@x>`,
  date: new Date('2026-08-16T09:00:00Z'),
  body_text: 'a body the classifier must not read',
  ...over,
});

const head = (id, over = {}) => ({
  state: 'newsletters', id, thread_key: `t-${id}`, message_id: `<${id}@x>`,
  folder: 'Bundles/Newsletters', uid: 100, subject: `S ${id}`,
  from_name: 'V', from_email: 'news@vendor.com', snippet: '',
  date: new Date('2026-08-16T09:00:00Z'), is_starred: false, in_inbox: true, thread_unread: true,
  ...over,
});

// A never-bundle cache that is fresh, so ensureNeverBundleSet does not trigger a rebuild.
const freshCache = (addresses = []) =>
  storage.getValue.mockResolvedValue({ value: { addresses, rebuiltAt: new Date().toISOString() } });

beforeEach(() => {
  vi.clearAllMocks();
  getAccountConfig.mockResolvedValue({});
  getMessageAnnotations.mockResolvedValue({});
  applyLabel.mockResolvedValue({ applied: true });
  removeLabel.mockResolvedValue({ removed: true });
  listThreadHeadsByLabels.mockResolvedValue([]);
  isPluginActivatedForAccount.mockResolvedValue(true);
  freshCache();
});

describe('inboxIngest', () => {
  it('classifies each arrival and files the bundled ones', async () => {
    loadOwnedMessage.mockResolvedValue(row('m1'));
    await inboxIngest({ account: ACCOUNT, newInboxIds: ['m1'], deletedIds: [] });
    expect(applyLabel).toHaveBeenCalledWith(ACCOUNT, expect.objectContaining({ id: 'm1' }), 'Bundles/Newsletters');
    expect(setMessageAnnotation).toHaveBeenCalledWith(
      'acct-1', 'm1', 'bundles', expect.objectContaining({ bundle: 'newsletters' })
    );
  });

  it('leaves unbundled mail alone', async () => {
    loadOwnedMessage.mockResolvedValue(row('m1', { is_bulk: false, category: 'primary' }));
    await inboxIngest({ account: ACCOUNT, newInboxIds: ['m1'], deletedIds: [] });
    expect(applyLabel).not.toHaveBeenCalled();
  });

  it('does not file a message the guard holds back', async () => {
    loadOwnedMessage.mockResolvedValue(row('m1', { subject: 'Your verification code is 1234' }));
    await inboxIngest({ account: ACCOUNT, newInboxIds: ['m1'], deletedIds: [] });
    expect(applyLabel).not.toHaveBeenCalled();
  });

  it('does not file mail from a derived correspondent', async () => {
    freshCache(['news@vendor.com']);
    loadOwnedMessage.mockResolvedValue(row('m1'));
    await inboxIngest({ account: ACCOUNT, newInboxIds: ['m1'], deletedIds: [] });
    expect(applyLabel).not.toHaveBeenCalled();
  });

  it('skips ids the inbox rules deleted', async () => {
    loadOwnedMessage.mockResolvedValue(row('m1'));
    await inboxIngest({ account: ACCOUNT, newInboxIds: ['m1'], deletedIds: new Set(['m1']) });
    expect(loadOwnedMessage).not.toHaveBeenCalled();
  });

  it('does nothing for an empty batch', async () => {
    await inboxIngest({ account: ACCOUNT, newInboxIds: [], deletedIds: [] });
    expect(loadOwnedMessage).not.toHaveBeenCalled();
  });

  it('keeps going when one message fails to file', async () => {
    loadOwnedMessage.mockResolvedValue(row('m1'));
    applyLabel.mockRejectedValueOnce(new Error('imap down')).mockResolvedValue({ applied: true });
    await inboxIngest({ account: ACCOUNT, newInboxIds: ['m1', 'm2'], deletedIds: [] });
    expect(applyLabel).toHaveBeenCalledTimes(2);
  });

  it('never throws into core', async () => {
    loadOwnedMessage.mockRejectedValue(new Error('db gone'));
    await expect(inboxIngest({ account: ACCOUNT, newInboxIds: ['m1'], deletedIds: [] })).resolves.toBeUndefined();
  });

  // "A sender is classified once" — the per-batch cache collapses repeat senders.
  it('reuses one sender verdict across a batch', async () => {
    loadOwnedMessage
      .mockResolvedValueOnce(row('m1'))
      .mockResolvedValueOnce(row('m2'))
      .mockResolvedValueOnce(row('m3'));
    await inboxIngest({ account: ACCOUNT, newInboxIds: ['m1', 'm2', 'm3'], deletedIds: [] });
    expect(applyLabel).toHaveBeenCalledTimes(3);
    for (const [, , folder] of applyLabel.mock.calls) expect(folder).toBe('Bundles/Newsletters');
  });
});

describe('onSentMessage', () => {
  beforeEach(() => {
    getAccountAddresses.mockResolvedValue(['me@mine.com', 'alias@mine.com']);
  });

  it('marks everyone who wrote in the thread as a correspondent', async () => {
    getThreadKeysForMessageIdHeaders.mockResolvedValue(['t-1']);
    getMessagesByThreadKeys.mockResolvedValue([
      { id: 'sent-row', folder: 'Sent', from_email: 'me@mine.com' },
      { id: 'in-row', folder: 'INBOX', from_email: 'sam@partner.com' },
    ]);
    loadOwnedMessage.mockResolvedValue({ to_addresses: [{ email: 'sam@partner.com' }], cc_addresses: [] });
    await onSentMessage({ account: ACCOUNT, messageId: '<sent@x>' });
    const written = storage.put.mock.calls.at(-1)[2].value.addresses;
    expect(written).toContain('sam@partner.com');
    expect(written).not.toContain('me@mine.com');
  });

  // The case the participation scan structurally cannot see: upsertSentMessageRecord stamps a
  // MailFlow-sent reply's thread_id with its OWN Message-ID, so it is permanently a thread of one.
  // The recipients are still on the row, and that is what must be read.
  it('recovers the recipient of a reply that threads alone', async () => {
    getThreadKeysForMessageIdHeaders.mockResolvedValue(['<sent@x>']);
    getMessagesByThreadKeys.mockResolvedValue([
      { id: 'sent-row', folder: 'Sent', from_email: 'me@mine.com' },
    ]);
    loadOwnedMessage.mockResolvedValue({
      to_addresses: [{ name: 'Sam', email: 'sam@partner.com' }],
      cc_addresses: [{ name: 'Dana', email: 'dana@collab.org' }],
    });
    await onSentMessage({ account: ACCOUNT, messageId: '<sent@x>' });
    const written = storage.put.mock.calls.at(-1)[2].value.addresses;
    expect(written).toEqual(expect.arrayContaining(['sam@partner.com', 'dana@collab.org']));
  });

  // Outbound is identified by sender, so a server whose Sent folder is called something else still
  // resolves recipients correctly.
  it('identifies the outbound copy by sender, not by folder name', async () => {
    getThreadKeysForMessageIdHeaders.mockResolvedValue(['t-1']);
    getMessagesByThreadKeys.mockResolvedValue([
      { id: 'sent-row', folder: 'Gesendet', from_email: 'alias@mine.com' },
    ]);
    loadOwnedMessage.mockResolvedValue({ to_addresses: [{ email: 'sam@partner.com' }], cc_addresses: [] });
    await onSentMessage({ account: ACCOUNT, messageId: '<sent@x>' });
    expect(storage.put.mock.calls.at(-1)[2].value.addresses).toContain('sam@partner.com');
  });

  it('writes nothing when every recipient is already known', async () => {
    freshCache(['sam@partner.com']);
    getThreadKeysForMessageIdHeaders.mockResolvedValue(['t-1']);
    getMessagesByThreadKeys.mockResolvedValue([{ id: 's', folder: 'Sent', from_email: 'me@mine.com' }]);
    loadOwnedMessage.mockResolvedValue({ to_addresses: [{ email: 'sam@partner.com' }], cc_addresses: [] });
    await onSentMessage({ account: ACCOUNT, messageId: '<sent@x>' });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('does nothing when the thread cannot be resolved', async () => {
    getThreadKeysForMessageIdHeaders.mockResolvedValue([]);
    await onSentMessage({ account: ACCOUNT, messageId: '<sent@x>' });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('never throws into core', async () => {
    getThreadKeysForMessageIdHeaders.mockRejectedValue(new Error('nope'));
    await expect(onSentMessage({ account: ACCOUNT, messageId: '<x@x>' })).resolves.toBeUndefined();
  });
});

describe('autoFileAged (NTH-2)', () => {
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent = new Date();

  it('files mail older than the window and leaves recent mail alone', async () => {
    listThreadHeadsByLabels.mockResolvedValue([head('a', { date: old }), head('b', { date: recent })]);
    expect(await autoFileAged(ACCOUNT)).toBe(1);
    expect(removeLabel.mock.calls[0][0].message_id).toBe('<a@x>');
  });

  // Same tiers as a manual sweep (INV-13, INV-14).
  it('never auto-files a pinned message', async () => {
    listThreadHeadsByLabels.mockResolvedValue([head('a', { date: old, is_starred: true })]);
    expect(await autoFileAged(ACCOUNT)).toBe(0);
  });

  it('never auto-files an active Keep', async () => {
    listThreadHeadsByLabels.mockResolvedValue([head('a', { date: old })]);
    getMessageAnnotations.mockResolvedValue({ a: { keepUntilSweep: 9 } });
    expect(await autoFileAged(ACCOUNT)).toBe(0);
  });

  // Nothing the user did happened, so the sweep counter — and therefore Keep decay — must not move.
  it('does not advance the cursor', async () => {
    listThreadHeadsByLabels.mockResolvedValue([head('a', { date: old })]);
    await autoFileAged(ACCOUNT);
    expect(setAccountConfig).not.toHaveBeenCalled();
  });
});

describe('migrateToZero (Phase 3)', () => {
  it('files the backlog and stamps every cursor', async () => {
    listThreadHeadsByLabels.mockResolvedValue([
      head('a', { date: new Date(Date.now() - 30 * 864e5) }),
    ]);
    const res = await migrateToZero(ACCOUNT);
    expect(res.migrated).toBe(true);
    const [, , written] = setAccountConfig.mock.calls.at(-1);
    expect(written.migratedAt).toEqual(expect.any(String));
    for (const c of Object.values(written.cursors)) expect(c.lastSweptAt).toEqual(expect.any(String));
  });

  it('refuses to run twice', async () => {
    getAccountConfig.mockResolvedValue({ migratedAt: '2026-08-01T00:00:00.000Z' });
    expect(await migrateToZero(ACCOUNT)).toEqual({ migrated: false, reason: 'already-migrated' });
    expect(setAccountConfig).not.toHaveBeenCalled();
  });
});

describe('gating', () => {
  it('is off for an account whose user has not activated the plugin', async () => {
    isPluginActivatedForAccount.mockResolvedValue(false);
    expect(await bundlesEnabledForAccount({ account: ACCOUNT })).toBe(false);
    expect(await relocateExemptFolders({ account: ACCOUNT })).toEqual([]);
  });

  // A bundled message lives as siblings in INBOX and its bundle folder; the sync move-detector must
  // not collapse them, which would destroy the two-copy model the whole design rests on.
  it('exempts the bundle folders from relocation when active', async () => {
    expect(await relocateExemptFolders({ account: ACCOUNT })).toEqual([
      'Bundles/Newsletters', 'Bundles/Promotions', 'Bundles/Notifications', 'Bundles/Social',
    ]);
  });

  it('is off for a missing account', async () => {
    expect(await bundlesEnabledForAccount({ account: null })).toBe(false);
  });
});
