import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the capability surface itself rather than the core modules behind it. api.js IS this
// plugin's dependency boundary (the import-boundary lint permits nothing else), so mocking it
// tests the plugin exactly as the platform presents it — and the mock doubles as a statement of
// which capabilities this module actually consumes.
vi.mock('../api.js', () => ({
  getAccountConfig: vi.fn(),
  setAccountConfig: vi.fn(),
}));

import { getAccountConfig, setAccountConfig } from '../api.js';
import {
  normalizeConfig, readConfig, writeConfig, advanceCursor, readCursor, emptyCursor,
} from './cursor.js';
import { BUNDLE_ORDER } from './taxonomy.js';

beforeEach(() => {
  getAccountConfig.mockReset();
  setAccountConfig.mockReset();
});

describe('normalizeConfig', () => {
  it('gives every bundle a cursor so readers never see undefined', () => {
    const cfg = normalizeConfig({});
    expect(Object.keys(cfg.cursors).sort()).toEqual([...BUNDLE_ORDER].sort());
    for (const key of BUNDLE_ORDER) expect(cfg.cursors[key]).toEqual(emptyCursor());
  });

  it('preserves stored cursors', () => {
    const cfg = normalizeConfig({
      cursors: { newsletters: { lastSweptAt: '2026-08-16T09:00:00.000Z', sweepCount: 4 } },
    });
    expect(cfg.cursors.newsletters).toEqual({ lastSweptAt: '2026-08-16T09:00:00.000Z', sweepCount: 4 });
  });

  it('rejects malformed cursor fields rather than propagating them', () => {
    const cfg = normalizeConfig({
      cursors: { newsletters: { lastSweptAt: 12345, sweepCount: -3 } },
    });
    expect(cfg.cursors.newsletters).toEqual(emptyCursor());
  });

  // A cursor for a bundle the taxonomy no longer has can only come from a removed category, and
  // keeping it would let that category resurrect itself.
  it('drops cursors for unknown bundle keys', () => {
    const cfg = normalizeConfig({ cursors: { legacyBundle: { sweepCount: 9 } } });
    expect(cfg.cursors.legacyBundle).toBeUndefined();
  });

  it('carries the migration marker', () => {
    expect(normalizeConfig({ migratedAt: '2026-08-16T09:00:00.000Z' }).migratedAt)
      .toBe('2026-08-16T09:00:00.000Z');
    expect(normalizeConfig({ migratedAt: 5 }).migratedAt).toBeNull();
  });

  // INV-21 / AV-8: there is no per-account settings surface, so there is nothing here to configure.
  it('stores no settings beyond cursors and the migration marker', () => {
    expect(Object.keys(normalizeConfig({})).sort()).toEqual(['cursors', 'migratedAt']);
  });
});

describe('advanceCursor', () => {
  it('stamps the time and increments the sweep counter', () => {
    const at = new Date('2026-08-16T09:00:00.000Z');
    const next = advanceCursor(normalizeConfig({}), 'newsletters', at);
    expect(next.cursors.newsletters).toEqual({ lastSweptAt: at.toISOString(), sweepCount: 1 });
  });

  it('leaves other bundles untouched', () => {
    const next = advanceCursor(normalizeConfig({}), 'newsletters', new Date());
    expect(next.cursors.promotions).toEqual(emptyCursor());
  });

  it('is pure — the input config is not mutated', () => {
    const cfg = normalizeConfig({});
    advanceCursor(cfg, 'newsletters', new Date());
    expect(cfg.cursors.newsletters).toEqual(emptyCursor());
  });

  it('accumulates across sweeps, which is the clock Keep decays against', () => {
    let cfg = normalizeConfig({});
    for (let i = 0; i < 5; i += 1) cfg = advanceCursor(cfg, 'promotions', new Date());
    expect(cfg.cursors.promotions.sweepCount).toBe(5);
  });

  it('ignores an unknown bundle key', () => {
    const cfg = normalizeConfig({});
    expect(advanceCursor(cfg, 'nope', new Date())).toBe(cfg);
  });
});

describe('readCursor', () => {
  it('falls back to an empty cursor for anything missing', () => {
    expect(readCursor(null, 'newsletters')).toEqual(emptyCursor());
    expect(readCursor(normalizeConfig({}), 'nope')).toEqual(emptyCursor());
  });
});

describe('persistence', () => {
  it('reads through the plugin config store under this plugin id', async () => {
    getAccountConfig.mockResolvedValue({ cursors: { social: { sweepCount: 2, lastSweptAt: null } } });
    const cfg = await readConfig('acct-1');
    expect(getAccountConfig).toHaveBeenCalledWith('bundles', 'acct-1');
    expect(cfg.cursors.social.sweepCount).toBe(2);
  });

  it('normalizes on write so a malformed blob can never reach storage', async () => {
    await writeConfig('acct-1', { cursors: { newsletters: { sweepCount: 'lots' } }, junk: true });
    const [, , written] = setAccountConfig.mock.calls[0];
    expect(written.cursors.newsletters).toEqual(emptyCursor());
    expect(written.junk).toBeUndefined();
  });

  it('treats an absent stored config as all-zero cursors', async () => {
    getAccountConfig.mockResolvedValue({});
    const cfg = await readConfig('acct-1');
    for (const key of BUNDLE_ORDER) expect(cfg.cursors[key]).toEqual(emptyCursor());
  });
});
