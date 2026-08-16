import { describe, it, expect, vi, beforeEach } from 'vitest';

// The dry run's whole claim is "no write reaches the mail server". These tests hold every
// server-mutating capability and assert none of them is called — so a future code path that starts
// writing has to delete an assertion to do it.
vi.mock('./bundlesConfig.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, config: { ...actual.buildConfig({}), DRY_RUN: true } };
});

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
  applyLabel, removeLabel, ensureLabelFolders, setMessageAnnotation, setAccountConfig,
  loadOwnedMessage, getMessageAnnotations, getThreadKeysInFolders, getMessagesByThreadKeys, storage,
} from '../api.js';
import { recordVerdict, sweepBundle, undoSweep, ensureBundleFolders } from './sweep.js';
import { inboxIngest, autoFileAged, migrateToZero, backfillClassification } from './hooks.js';
import { dryRunReport } from './dryRun.js';

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
  body_text: 'a body nothing may read',
  ...over,
});

// Every capability that mutates the mail server. Nothing in a dry run may touch these.
const serverWriters = () => ({ applyLabel, removeLabel, ensureLabelFolders });

const expectNoServerWrites = () => {
  for (const [name, fn] of Object.entries(serverWriters())) {
    expect(fn, `${name} was called during a dry run`).not.toHaveBeenCalled();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  storage.getValue.mockResolvedValue({ value: { addresses: [], rebuiltAt: new Date().toISOString() } });
  getMessageAnnotations.mockResolvedValue({});
});

describe('classification still runs', () => {
  it('records a verdict without copying the message', async () => {
    loadOwnedMessage.mockResolvedValue(row('m1'));
    await inboxIngest({ account: ACCOUNT, newInboxIds: ['m1'], deletedIds: [] });

    expect(setMessageAnnotation).toHaveBeenCalledWith(
      'acct-1', 'm1', 'bundles',
      expect.objectContaining({ bundle: 'newsletters', reason: 'category:newsletter', dryRun: true })
    );
    expectNoServerWrites();
  });

  it('reports filed:false so no caller mistakes it for a real filing', async () => {
    const result = await recordVerdict(ACCOUNT, row('m1'), { bundle: 'newsletters', reason: 'category:newsletter' });
    expect(result).toEqual({ filed: false, folder: 'Bundles/Newsletters', bundled: true, dryRun: true });
    expectNoServerWrites();
  });

  // The guard result is RECORDED rather than skipped — "judged and left alone" is exactly what the
  // report needs to distinguish from "never judged".
  it('records the guard verdict without bundling', async () => {
    loadOwnedMessage.mockResolvedValue(row('m1', { subject: 'Security alert: new sign-in' }));
    await inboxIngest({ account: ACCOUNT, newInboxIds: ['m1'], deletedIds: [] });
    expect(setMessageAnnotation).toHaveBeenCalledWith(
      'acct-1', 'm1', 'bundles',
      expect.objectContaining({ bundle: 'inbox', reason: 'guard:security' })
    );
    expectNoServerWrites();
  });
});

describe('nothing reaches the mail server', () => {
  it('creates no folders', async () => {
    expect(await ensureBundleFolders(ACCOUNT)).toEqual([]);
    expect(ensureLabelFolders).not.toHaveBeenCalled();
  });

  it('refuses a sweep instead of silently doing nothing', async () => {
    expect(await sweepBundle(ACCOUNT, 'newsletters', ['a', 'b'])).toEqual({ error: 'dry-run' });
    expectNoServerWrites();
  });

  it('refuses an undo', async () => {
    expect(await undoSweep(ACCOUNT, 'tok')).toEqual({ error: 'dry-run' });
    expectNoServerWrites();
  });

  it('auto-files nothing on the tick', async () => {
    expect(await autoFileAged(ACCOUNT)).toBe(0);
    expectNoServerWrites();
  });

  it('refuses the start-from-zero migration', async () => {
    expect(await migrateToZero(ACCOUNT)).toEqual({ migrated: false, reason: 'dry-run' });
    expect(setAccountConfig).not.toHaveBeenCalled();
    expectNoServerWrites();
  });
});

describe('backfillClassification', () => {
  const inbox = [
    { id: 'old1', folder: 'INBOX', from_email: 'news@vendor.com', date: new Date('2026-08-01') },
    { id: 'old2', folder: 'INBOX', from_email: 'news@vendor.com', date: new Date('2026-08-02') },
    { id: 'archived', folder: 'Archive', from_email: 'x@y.com', date: new Date('2026-08-02') },
  ];

  beforeEach(() => {
    getThreadKeysInFolders.mockResolvedValue(['t1', 't2']);
    getMessagesByThreadKeys.mockResolvedValue(inbox);
    loadOwnedMessage.mockImplementation(async (_u, id) => row(id));
  });

  it('classifies inbox mail that predates activation, writing no server changes', async () => {
    const res = await backfillClassification(ACCOUNT);
    expect(res).toMatchObject({ classified: 2, bundled: 2, remaining: 0 });
    expectNoServerWrites();
  });

  it('ignores messages outside INBOX', async () => {
    await backfillClassification(ACCOUNT);
    const ids = setMessageAnnotation.mock.calls.map((c) => c[1]);
    expect(ids).not.toContain('archived');
  });

  // Idempotent and resumable: a large inbox is drained by running it again, not by raising limits.
  it('skips anything already judged', async () => {
    getMessageAnnotations.mockResolvedValue({ old1: { bundle: 'newsletters' } });
    const res = await backfillClassification(ACCOUNT);
    expect(res.classified).toBe(1);
    expect(setMessageAnnotation.mock.calls.map((c) => c[1])).toEqual(['old2']);
  });

  it('reports what is left when the limit truncates the batch', async () => {
    const res = await backfillClassification(ACCOUNT, { limit: 1 });
    expect(res).toMatchObject({ classified: 1, remaining: 1 });
  });

  it('keeps going when one message fails', async () => {
    loadOwnedMessage.mockRejectedValueOnce(new Error('gone')).mockImplementation(async (_u, id) => row(id));
    expect((await backfillClassification(ACCOUNT)).classified).toBe(1);
  });

  it('does nothing for an empty inbox', async () => {
    getThreadKeysInFolders.mockResolvedValue([]);
    expect(await backfillClassification(ACCOUNT)).toMatchObject({ classified: 0, bundled: 0 });
  });
});

describe('dryRunReport', () => {
  const inbox = [
    { id: 'm1', folder: 'INBOX', from_email: 'news@vendor.com', date: new Date('2026-08-16T09:00:00Z') },
    { id: 'm2', folder: 'INBOX', from_email: 'deals@shop.com', date: new Date('2026-08-16T10:00:00Z') },
    { id: 'm3', folder: 'INBOX', from_email: 'sam@partner.com', date: new Date('2026-08-16T11:00:00Z') },
  ];

  beforeEach(() => {
    getThreadKeysInFolders.mockResolvedValue(['t1', 't2', 't3']);
    getMessagesByThreadKeys.mockResolvedValue(inbox);
    getMessageAnnotations.mockResolvedValue({
      m1: { bundle: 'newsletters', reason: 'category:newsletter', classifiedAt: '2026-08-16T09:00:00Z' },
      m2: { bundle: 'promotions', reason: 'category:promotion', classifiedAt: '2026-08-16T10:00:00Z' },
      // Judged and deliberately left in the inbox — NOT the same as never judged.
      m3: { bundle: 'inbox', reason: 'exempt-correspondent', classifiedAt: '2026-08-16T11:00:00Z' },
    });
    loadOwnedMessage.mockImplementation(async (_u, id) => row(id, { subject: `Subject ${id}` }));
  });

  it('lists what would be bundled, with the rule that decided it', async () => {
    const report = await dryRunReport(ACCOUNT);
    expect(report.wouldBundle).toBe(2);
    expect(report.wouldRemain).toBe(1);
    expect(report.unclassified).toBe(0);
    expect(report.messages.map((m) => [m.id, m.bundle, m.reason])).toEqual([
      ['m2', 'promotions', 'category:promotion'],
      ['m1', 'newsletters', 'category:newsletter'],
    ]);
  });

  it('omits messages the classifier left alone', async () => {
    const report = await dryRunReport(ACCOUNT);
    expect(report.messages.find((m) => m.id === 'm3')).toBeUndefined();
  });

  // The bug this distinction exists to kill. Activating over an existing inbox leaves every message
  // already there unjudged, because inboxIngest only sees NEW arrivals. Counting those as
  // "would remain" claims a judgement that was never made — a 239-message inbox reporting
  // "3 of 239 would be bundled" as though 236 had been considered and kept.
  it('counts never-judged mail as unclassified, not as would-remain', async () => {
    getMessageAnnotations.mockResolvedValue({
      m1: { bundle: 'newsletters', reason: 'category:newsletter' },
    });
    const report = await dryRunReport(ACCOUNT);
    expect(report.wouldBundle).toBe(1);
    expect(report.unclassified).toBe(2);
    expect(report.wouldRemain).toBe(0);
    // Every inbox row is in exactly one of the three populations.
    expect(report.wouldBundle + report.wouldRemain + report.unclassified).toBe(report.scanned);
  });

  it('counts per bundle and per distinct sender', async () => {
    const report = await dryRunReport(ACCOUNT);
    expect(report.byBundle).toEqual({ newsletters: 1, promotions: 1, notifications: 0, social: 0 });
    expect(report.distinctSenders).toEqual({ newsletters: 1, promotions: 1 });
  });

  // INV-8's compression, made visible: what the inbox would look like before and after.
  it('reports the row compression', async () => {
    const report = await dryRunReport(ACCOUNT);
    expect(report.rowsBefore).toBe(3);
    expect(report.rowsAfter).toBe(3); // 1 loose + 2 bundle rows — no compression at this size
  });

  // A thread with one INBOX message drags its siblings into getMessagesByThreadKeys; they must not
  // be counted as inbox rows.
  it('counts only messages actually in INBOX', async () => {
    getMessagesByThreadKeys.mockResolvedValue([
      ...inbox,
      { id: 'archived', folder: 'Archive', from_email: 'old@x.com', date: new Date() },
    ]);
    expect((await dryRunReport(ACCOUNT)).scanned).toBe(3);
  });

  it('reads no message body', async () => {
    const report = await dryRunReport(ACCOUNT);
    expect(JSON.stringify(report)).not.toContain('a body nothing may read');
  });

  it('survives a row that cannot be loaded', async () => {
    loadOwnedMessage.mockRejectedValue(new Error('gone'));
    const report = await dryRunReport(ACCOUNT);
    expect(report.wouldBundle).toBe(2);
    expect(report.messages[0].subject).toBeNull();
  });

  it('is empty for an empty inbox', async () => {
    getThreadKeysInFolders.mockResolvedValue([]);
    const report = await dryRunReport(ACCOUNT);
    expect(report).toMatchObject({ scanned: 0, wouldBundle: 0, wouldRemain: 0 });
  });
});
