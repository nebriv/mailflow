import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildConfig, clampInt, config, parseNeverBundle, parseDryRun, MAX_OVERRIDES } from './bundlesConfig.js';

describe('clampInt', () => {
  const opts = { min: 4, max: 20, fallback: 7, name: 'T' };

  it('accepts an in-range value', () => {
    expect(clampInt('9', opts)).toBe(9);
  });

  it('falls back for absent or empty values', () => {
    for (const raw of [undefined, null, '']) expect(clampInt(raw, opts)).toBe(7);
  });

  it('falls back for non-numeric junk', () => {
    for (const raw of ['abc', 'NaN', {}]) expect(clampInt(raw, opts)).toBe(7);
  });

  it('clamps rather than rejecting an out-of-range value', () => {
    expect(clampInt('1', opts)).toBe(4);
    expect(clampInt('999', opts)).toBe(20);
  });

  // INV-21b names KEEP_DECAY_SWEEPS and AUTOFILE_AGE_DAYS as never-unbounded. Since parsing routes
  // every non-finite input to the fallback, "unlimited" has no representation at all — the refusal
  // is structural rather than a check that could be forgotten.
  it('has no representation for unbounded', () => {
    for (const raw of ['Infinity', '-Infinity', 'infinity', 'none', 'unlimited', '0x7fffffff']) {
      const v = clampInt(raw, opts);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(opts.min);
      expect(v).toBeLessThanOrEqual(opts.max);
    }
  });
});

describe('buildConfig', () => {
  it('uses the spec defaults for an empty environment', () => {
    expect(buildConfig({})).toEqual({
      NEVER_BUNDLE: [],
      DRY_RUN: false,
      ROW_BUDGET: 7,
      KEEP_DECAY_SWEEPS: 3,
      AUTOFILE_AGE_DAYS: 7,
      MIN_GROUP_SIZE: 3,
      UNDO_WINDOW_SECONDS: 10,
    });
  });

  it('reads each constant from its env var', () => {
    const c = buildConfig({
      BUNDLES_ROW_BUDGET: '6',
      BUNDLES_KEEP_DECAY_SWEEPS: '2',
      BUNDLES_AUTOFILE_AGE_DAYS: '14',
      BUNDLES_MIN_GROUP_SIZE: '4',
      BUNDLES_UNDO_WINDOW_SECONDS: '20',
    });
    expect(c).toEqual({
      NEVER_BUNDLE: [], DRY_RUN: false, ROW_BUDGET: 6, KEEP_DECAY_SWEEPS: 2, AUTOFILE_AGE_DAYS: 14,
      MIN_GROUP_SIZE: 4, UNDO_WINDOW_SECONDS: 20,
    });
  });

  it('clamps each constant into the bounds the spec documents', () => {
    const low = buildConfig({
      BUNDLES_ROW_BUDGET: '0', BUNDLES_KEEP_DECAY_SWEEPS: '0', BUNDLES_AUTOFILE_AGE_DAYS: '0',
      BUNDLES_MIN_GROUP_SIZE: '0', BUNDLES_UNDO_WINDOW_SECONDS: '0',
    });
    expect(low).toEqual({
      NEVER_BUNDLE: [], DRY_RUN: false, ROW_BUDGET: 4, KEEP_DECAY_SWEEPS: 1, AUTOFILE_AGE_DAYS: 1,
      MIN_GROUP_SIZE: 2, UNDO_WINDOW_SECONDS: 5,
    });

    const high = buildConfig({
      BUNDLES_ROW_BUDGET: '99', BUNDLES_KEEP_DECAY_SWEEPS: '99', BUNDLES_AUTOFILE_AGE_DAYS: '999',
      BUNDLES_MIN_GROUP_SIZE: '99', BUNDLES_UNDO_WINDOW_SECONDS: '999',
    });
    expect(high).toEqual({
      NEVER_BUNDLE: [], DRY_RUN: false, ROW_BUDGET: 20, KEEP_DECAY_SWEEPS: 10, AUTOFILE_AGE_DAYS: 90,
      MIN_GROUP_SIZE: 10, UNDO_WINDOW_SECONDS: 60,
    });
  });

  // INV-12 sets the floor for the undo window at 10 seconds. The configurable minimum is 5, which
  // is below it, so this records that a user who lowers it is knowingly going under the invariant —
  // and that the DEFAULT satisfies it.
  it('defaults the undo window to the INV-12 floor', () => {
    expect(buildConfig({}).UNDO_WINDOW_SECONDS).toBeGreaterThanOrEqual(10);
  });

  it('is frozen so nothing can mutate a constant at runtime', () => {
    const c = buildConfig({});
    expect(Object.isFrozen(c)).toBe(true);
  });
});

describe('parseNeverBundle — the manual override list (INV-4, INV-21a)', () => {
  it('parses a comma-separated list of addresses and domains', () => {
    expect(parseNeverBundle('alerts@bank.com, vendor.com , Ops@Corp.COM'))
      .toEqual(['alerts@bank.com', 'vendor.com', 'ops@corp.com']);
  });

  it('is empty for an absent or blank value', () => {
    for (const raw of [undefined, null, '', '   ', 42]) expect(parseNeverBundle(raw)).toEqual([]);
  });

  // A typo that silently exempts nothing is worse than one dropped at parse time.
  it('drops entries that are neither an address nor a domain', () => {
    expect(parseNeverBundle('notadomain, real.com, alsobad')).toEqual(['real.com']);
  });

  it('dedupes case-insensitively', () => {
    expect(parseNeverBundle('a@b.com,A@B.com')).toEqual(['a@b.com']);
  });

  // The cap is a smell alarm: past it the classifier is failing and the answer is to fix it, not to
  // keep typing (S-10 caps maintenance at one action per week).
  it('caps the list length', () => {
    const many = Array.from({ length: MAX_OVERRIDES + 20 }, (_, i) => `a${i}@x.com`).join(',');
    expect(parseNeverBundle(many)).toHaveLength(MAX_OVERRIDES);
  });

  it('is frozen on the built config', () => {
    expect(Object.isFrozen(buildConfig({ BUNDLES_NEVER_BUNDLE: 'a@b.com' }).NEVER_BUNDLE)).toBe(true);
  });
});

describe('parseDryRun — fails safe, unlike every other constant', () => {
  it('is off when the variable is not set at all', () => {
    expect(parseDryRun(undefined)).toBe(false);
    expect(parseDryRun(null)).toBe(false);
  });

  it('is on for the obvious affirmatives', () => {
    for (const raw of ['true', 'TRUE', ' true ', '1', 'yes', 'on', true]) {
      expect(parseDryRun(raw), `${raw} should enable the dry run`).toBe(true);
    }
  });

  it('is off only for an explicit negative', () => {
    for (const raw of ['false', 'FALSE', '0', 'no', 'off', '', '  ', false]) {
      expect(parseDryRun(raw), `${raw} should disable the dry run`).toBe(false);
    }
  });

  // The reason this parse is not a strict `=== 'true'`. Under a strict parse a typo leaves the dry
  // run silently OFF — the operator believes the plugin cannot touch their mail while it is copying
  // and expunging. Being wrong toward "do nothing" costs a day of observation; being wrong toward
  // "write to the mail server" costs the thing the dry run existed to prevent.
  it('treats a typo as a dry run rather than as write access', () => {
    for (const typo of ['ture', 'tru', 'yse', 'enabled', 'y', 'dry-run']) {
      expect(parseDryRun(typo), `${typo} must not grant write access`).toBe(true);
    }
  });

  it('reaches the built config', () => {
    expect(buildConfig({ BUNDLES_DRY_RUN: 'true' }).DRY_RUN).toBe(true);
    expect(buildConfig({ BUNDLES_DRY_RUN: 'false' }).DRY_RUN).toBe(false);
    expect(buildConfig({}).DRY_RUN).toBe(false);
  });
});

describe('the module-level config', () => {
  it('is built and frozen at import', () => {
    expect(Object.isFrozen(config)).toBe(true);
    expect(config.ROW_BUDGET).toBeGreaterThanOrEqual(4);
  });
});
