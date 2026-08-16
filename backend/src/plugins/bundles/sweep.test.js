import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  broadcast: vi.fn(),
  storage: { put: vi.fn(), getValue: vi.fn(), getBlob: vi.fn(), del: vi.fn() },
  applyLabel: vi.fn().mockResolvedValue({ applied: true }),
  removeLabel: vi.fn().mockResolvedValue({ removed: true }),
  resolveLabelCopyUid: vi.fn(),
  ensureLabelFolders: vi.fn().mockResolvedValue([]),
  listThreadHeadsByLabels: vi.fn(),
  resolveAllDraftsPaths: vi.fn().mockResolvedValue([]),
  setMessageAnnotation: vi.fn(),
  getMessageAnnotations: vi.fn().mockResolvedValue({}),
  getAccountConfig: vi.fn().mockResolvedValue({}),
  setAccountConfig: vi.fn(),
}));

import {
  broadcast, storage, applyLabel, removeLabel, resolveLabelCopyUid,
  listThreadHeadsByLabels, setMessageAnnotation, getMessageAnnotations,
  getAccountConfig, setAccountConfig,
} from '../api.js';
import {
  readBundles, sweepBundle, undoSweep, setKeep, fileIntoBundle, isUndoable, BUNDLES_EVENT, __testing,
} from './sweep.js';

const ACCOUNT = { id: 'acct-1', user_id: 'user-1' };

// A row as listThreadHeadsByLabels returns it. `state` is the label name (the bundle key) and
// `in_inbox` is the thread-level fact that decides bundle membership vs reading feed.
const head = (id, over = {}) => ({
  state: 'newsletters',
  id,
  thread_key: `t-${id}`,
  message_id: `<${id}@x>`,
  folder: 'Bundles/Newsletters',
  uid: 100,
  subject: `Subject ${id}`,
  from_name: 'Vendor',
  from_email: 'news@vendor.com',
  snippet: '',
  date: new Date('2026-08-16T09:00:00Z'),
  is_starred: false,
  in_inbox: true,
  thread_unread: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getAccountConfig.mockResolvedValue({});
  getMessageAnnotations.mockResolvedValue({});
  applyLabel.mockResolvedValue({ applied: true });
  removeLabel.mockResolvedValue({ removed: true });
  listThreadHeadsByLabels.mockResolvedValue([]);
});

describe('readBundles', () => {
  it('splits members (still in INBOX) from the reading feed (everything)', async () => {
    listThreadHeadsByLabels.mockResolvedValue([
      head('a', { in_inbox: true }),
      head('b', { in_inbox: false }),
      head('c', { state: 'promotions', in_inbox: true }),
    ]);
    const bundles = await readBundles('acct-1');
    expect(bundles.newsletters.members.map((m) => m.id)).toEqual(['a']);
    expect(bundles.newsletters.feed.map((m) => m.id)).toEqual(['a', 'b']);
    expect(bundles.promotions.members.map((m) => m.id)).toEqual(['c']);
  });

  it('returns an entry for every bundle even when empty (INV-6 is decided by count)', async () => {
    const bundles = await readBundles('acct-1');
    expect(Object.keys(bundles).sort()).toEqual(['newsletters', 'notifications', 'promotions', 'social']);
    for (const b of Object.values(bundles)) expect(b.members).toEqual([]);
  });

  it('queries the four bundle folders and excludes drafts', async () => {
    await readBundles('acct-1');
    const [accountId, opts] = listThreadHeadsByLabels.mock.calls[0];
    expect(accountId).toBe('acct-1');
    expect(opts.labelFolders).toEqual([
      'Bundles/Newsletters', 'Bundles/Promotions', 'Bundles/Notifications', 'Bundles/Social',
    ]);
    expect(opts.limit).toBe(__testing.MEMBER_LIMIT);
  });

  it('ignores rows for a label outside the taxonomy', async () => {
    listThreadHeadsByLabels.mockResolvedValue([head('a', { state: 'todo' })]);
    const bundles = await readBundles('acct-1');
    expect(Object.values(bundles).every((b) => b.members.length === 0)).toBe(true);
  });
});

describe('fileIntoBundle', () => {
  it('copies the message into the bundle folder and records the reason', async () => {
    await fileIntoBundle(ACCOUNT, { id: 'm1', uid: 5, folder: 'INBOX' }, 'newsletters', 'category:newsletter');
    expect(applyLabel).toHaveBeenCalledWith(ACCOUNT, { id: 'm1', uid: 5, folder: 'INBOX' }, 'Bundles/Newsletters');
    const [, , , patch] = setMessageAnnotation.mock.calls[0];
    expect(patch.bundle).toBe('newsletters');
    expect(patch.reason).toBe('category:newsletter');
  });

  it('refuses an unknown bundle key', async () => {
    expect(await fileIntoBundle(ACCOUNT, { id: 'm1' }, 'nope', 'r')).toEqual({ filed: false });
    expect(applyLabel).not.toHaveBeenCalled();
  });
});

describe('sweepBundle', () => {
  beforeEach(() => {
    listThreadHeadsByLabels.mockResolvedValue([head('a'), head('b'), head('c')]);
  });

  // INV-11: sweep files, never deletes. The ONLY copy removed is the INBOX one; the bundle-folder
  // copy — which is also the reading feed — is never touched.
  it('removes only the INBOX copy, never the bundle folder copy', async () => {
    await sweepBundle(ACCOUNT, 'newsletters', ['a', 'b']);
    expect(removeLabel).toHaveBeenCalledTimes(2);
    for (const [, folder] of removeLabel.mock.calls) expect(folder).toBe('INBOX');
  });

  // S-3b: a sweep clears no message the user has not seen.
  it('never sweeps a message below the seen boundary', async () => {
    const res = await sweepBundle(ACCOUNT, 'newsletters', ['a']);
    expect(res.swept).toBe(1);
    expect(res.unseen).toBe(2);
    expect(removeLabel.mock.calls[0][0].message_id).toBe('<a@x>');
  });

  it('holds back pinned and kept messages that were seen', async () => {
    listThreadHeadsByLabels.mockResolvedValue([head('a'), head('b', { is_starred: true }), head('c')]);
    getMessageAnnotations.mockResolvedValue({ c: { keepUntilSweep: 9 } });
    const res = await sweepBundle(ACCOUNT, 'newsletters', ['a', 'b', 'c']);
    expect(res.swept).toBe(1);
    expect(res.survivors).toEqual([{ id: 'b', reason: 'pinned' }, { id: 'c', reason: 'keep' }]);
  });

  it('advances the cursor', async () => {
    await sweepBundle(ACCOUNT, 'newsletters', ['a']);
    const [, , written] = setAccountConfig.mock.calls[0];
    expect(written.cursors.newsletters.sweepCount).toBe(1);
    expect(written.cursors.newsletters.lastSweptAt).toEqual(expect.any(String));
  });

  it('broadcasts to the owning user only', async () => {
    await sweepBundle(ACCOUNT, 'newsletters', ['a']);
    expect(broadcast).toHaveBeenCalledWith(
      { type: BUNDLES_EVENT, accountId: 'acct-1', bundle: 'newsletters' }, 'user-1'
    );
  });

  it('keeps going when one message fails, rather than aborting the sweep', async () => {
    removeLabel
      .mockRejectedValueOnce(new Error('imap blew up'))
      .mockResolvedValue({ removed: true });
    const res = await sweepBundle(ACCOUNT, 'newsletters', ['a', 'b', 'c']);
    expect(res.swept).toBe(2);
  });

  it('sweeps nothing and issues no undo token when nothing was seen', async () => {
    const res = await sweepBundle(ACCOUNT, 'newsletters', []);
    expect(res.swept).toBe(0);
    expect(res.undoToken).toBeNull();
    expect(removeLabel).not.toHaveBeenCalled();
  });

  it('rejects an unknown bundle', async () => {
    expect(await sweepBundle(ACCOUNT, 'nope', ['a'])).toEqual({ error: 'unknown-bundle' });
  });

  // INV-5: the response carries the cursor, never a lifetime total.
  it('returns no lifetime totals', async () => {
    const res = await sweepBundle(ACCOUNT, 'newsletters', ['a']);
    expect(res).not.toHaveProperty('total');
    expect(res).not.toHaveProperty('unread');
  });
});

describe('undo (INV-12)', () => {
  it('stores the swept message ids under an undo token', async () => {
    listThreadHeadsByLabels.mockResolvedValue([head('a'), head('b')]);
    const res = await sweepBundle(ACCOUNT, 'newsletters', ['a', 'b']);
    expect(res.undoToken).toEqual(expect.any(String));
    const [, key, payload] = storage.put.mock.calls.at(-1);
    expect(key).toBe(__testing.undoKey('acct-1', res.undoToken));
    expect(payload.value.messageIds).toEqual(['<a@x>', '<b@x>']);
  });

  // Exactly symmetric with sweep: sweep removed the INBOX copy, undo copies it back from the bundle
  // folder copy sweep deliberately left in place.
  it('restores each message by copying the bundle copy back into INBOX', async () => {
    storage.getValue.mockResolvedValue({
      value: { bundle: 'newsletters', at: new Date().toISOString(), messageIds: ['<a@x>', '<b@x>'] },
    });
    resolveLabelCopyUid.mockResolvedValue(42);

    const res = await undoSweep(ACCOUNT, 'tok');
    expect(res).toEqual({ bundle: 'newsletters', restored: 2 });
    for (const [, message, folder] of applyLabel.mock.calls) {
      expect(folder).toBe('INBOX');
      expect(message).toEqual({ uid: 42, folder: 'Bundles/Newsletters' });
    }
  });

  it('resolves the bundle copy fresh, so a uid renumbered by a sync does not break undo', async () => {
    storage.getValue.mockResolvedValue({
      value: { bundle: 'newsletters', at: new Date().toISOString(), messageIds: ['<a@x>'] },
    });
    resolveLabelCopyUid.mockResolvedValue(999);
    await undoSweep(ACCOUNT, 'tok');
    expect(resolveLabelCopyUid).toHaveBeenCalledWith(
      { account_id: 'acct-1', message_id: '<a@x>', folder: null, uid: null }, 'Bundles/Newsletters'
    );
  });

  it('skips a message whose bundle copy has since disappeared', async () => {
    storage.getValue.mockResolvedValue({
      value: { bundle: 'newsletters', at: new Date().toISOString(), messageIds: ['<a@x>', '<b@x>'] },
    });
    resolveLabelCopyUid.mockResolvedValueOnce(1).mockResolvedValueOnce(null);
    expect((await undoSweep(ACCOUNT, 'tok')).restored).toBe(1);
  });

  it('consumes the token so an undo cannot be replayed', async () => {
    storage.getValue.mockResolvedValue({
      value: { bundle: 'newsletters', at: new Date().toISOString(), messageIds: [] },
    });
    await undoSweep(ACCOUNT, 'tok');
    expect(storage.del).toHaveBeenCalledWith('bundles', __testing.undoKey('acct-1', 'tok'));
  });

  it('reports an unknown token', async () => {
    storage.getValue.mockResolvedValue(null);
    expect(await undoSweep(ACCOUNT, 'nope')).toEqual({ error: 'unknown-token' });
  });

  it('expires outside the window and clears the record', async () => {
    storage.getValue.mockResolvedValue({
      value: { bundle: 'newsletters', at: new Date(Date.now() - 60_000).toISOString(), messageIds: ['<a@x>'] },
    });
    expect(await undoSweep(ACCOUNT, 'tok')).toEqual({ error: 'expired' });
    expect(applyLabel).not.toHaveBeenCalled();
    expect(storage.del).toHaveBeenCalled();
  });
});

describe('isUndoable', () => {
  it('honours at least the INV-12 floor of 10 seconds', () => {
    const at = new Date(Date.now() - 9_000).toISOString();
    expect(isUndoable({ at }, Date.now(), 10)).toBe(true);
  });

  it('is false past the window and for a malformed timestamp', () => {
    expect(isUndoable({ at: new Date(Date.now() - 11_000).toISOString() }, Date.now(), 10)).toBe(false);
    expect(isUndoable({ at: 'not a date' })).toBe(false);
    expect(isUndoable(null)).toBe(false);
  });
});

describe('setKeep (INV-10b)', () => {
  it('writes an expiry a fixed number of sweeps ahead', async () => {
    getAccountConfig.mockResolvedValue({ cursors: { newsletters: { lastSweptAt: null, sweepCount: 2 } } });
    getMessageAnnotations.mockResolvedValue({ m1: { bundle: 'newsletters' } });
    const res = await setKeep(ACCOUNT, 'm1', true);
    expect(res.until).toBe(5); // 2 + KEEP_DECAY_SWEEPS(3)
    expect(setMessageAnnotation).toHaveBeenCalledWith('acct-1', 'm1', 'bundles', { keepUntilSweep: 5 });
  });

  // Reversible by the same gesture.
  it('clears the expiry when toggled off', async () => {
    getMessageAnnotations.mockResolvedValue({ m1: { bundle: 'newsletters' } });
    await setKeep(ACCOUNT, 'm1', false);
    expect(setMessageAnnotation).toHaveBeenCalledWith('acct-1', 'm1', 'bundles', { keepUntilSweep: null });
  });
});
