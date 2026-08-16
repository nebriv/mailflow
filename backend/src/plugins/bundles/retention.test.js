import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  survivalReason, keepUntilFor, isKeepActive, planSweep, sweepableCount, sweepLabel,
} from './retention.js';

const msg = (id, over = {}) => ({ id, is_starred: false, ...over });
const cursor = (sweepCount = 0) => ({ lastSweptAt: null, sweepCount });

describe('survivalReason', () => {
  it('sweeps an ordinary seen message', () => {
    expect(survivalReason(msg('a'), null, cursor())).toBeNull();
  });

  // INV-13/INV-14: manual state outranks derived state.
  it('holds a pinned (starred) message', () => {
    expect(survivalReason(msg('a', { is_starred: true }), null, cursor())).toBe('pinned');
  });

  it('holds a message with an active Keep', () => {
    expect(survivalReason(msg('a'), { keepUntilSweep: 3 }, cursor(1))).toBe('keep');
  });

  it('releases a Keep once it has decayed', () => {
    expect(survivalReason(msg('a'), { keepUntilSweep: 3 }, cursor(3))).toBeNull();
    expect(survivalReason(msg('a'), { keepUntilSweep: 3 }, cursor(4))).toBeNull();
  });

  it('ranks a pin above a decayed Keep', () => {
    expect(survivalReason(msg('a', { is_starred: true }), { keepUntilSweep: 0 }, cursor(9))).toBe('pinned');
  });

  it('ignores a malformed keepUntilSweep rather than holding forever', () => {
    for (const bad of [null, undefined, 'soon', 1.5, Infinity]) {
      expect(survivalReason(msg('a'), { keepUntilSweep: bad }, cursor(0))).toBeNull();
    }
  });

  it('reports a missing message rather than throwing', () => {
    expect(survivalReason(null, null, cursor())).toBe('missing');
  });
});

describe('Keep decay', () => {
  it('sets the expiry a fixed number of sweeps ahead', () => {
    expect(keepUntilFor(cursor(0), 3)).toBe(3);
    expect(keepUntilFor(cursor(7), 3)).toBe(10);
  });

  it('stays active for exactly the configured number of sweeps', () => {
    const applied = keepUntilFor(cursor(0), 3);
    const ann = { keepUntilSweep: applied };
    expect(isKeepActive(ann, cursor(0))).toBe(true);   // applied
    expect(isKeepActive(ann, cursor(1))).toBe(true);   // survived sweep 1
    expect(isKeepActive(ann, cursor(2))).toBe(true);   // survived sweep 2
    expect(isKeepActive(ann, cursor(3))).toBe(false);  // decayed after sweep 3
  });

  // INV-10a: decay is what makes marking cheap. A Keep that never expires is the star-accumulation
  // backlog the tier exists to prevent.
  it('cannot be made permanent through the annotation', () => {
    expect(isKeepActive({ keepUntilSweep: Infinity }, cursor(0))).toBe(false);
    expect(isKeepActive({ keepUntilSweep: null }, cursor(0))).toBe(false);
  });
});

describe('planSweep', () => {
  const members = [msg('a'), msg('b'), msg('c'), msg('d')];

  // S-3b: a sweep clears no message the user has not seen. This is the assertion that makes the
  // confirmation dialog unnecessary (§1.3).
  it('never touches a message below the seen boundary', () => {
    const plan = planSweep({ members, seenIds: ['a', 'b'], cursor: cursor() });
    expect(plan.sweep.map((r) => r.id)).toEqual(['a', 'b']);
    expect(plan.unseen.map((r) => r.id)).toEqual(['c', 'd']);
  });

  it('holds back pinned and kept members that were seen', () => {
    const plan = planSweep({
      members: [msg('a'), msg('b', { is_starred: true }), msg('c'), msg('d')],
      seenIds: ['a', 'b', 'c'],
      annotations: { c: { keepUntilSweep: 5 } },
      cursor: cursor(1),
    });
    expect(plan.sweep.map((r) => r.id)).toEqual(['a']);
    expect(plan.survivors.map((s) => [s.row.id, s.reason])).toEqual([['b', 'pinned'], ['c', 'keep']]);
    expect(plan.unseen.map((r) => r.id)).toEqual(['d']);
  });

  it('ignores seen ids that are not members', () => {
    const plan = planSweep({ members, seenIds: ['a', 'ghost'], cursor: cursor() });
    expect(plan.sweep.map((r) => r.id)).toEqual(['a']);
  });

  it('sweeps nothing when nothing was seen', () => {
    const plan = planSweep({ members, seenIds: [], cursor: cursor() });
    expect(plan.sweep).toEqual([]);
    expect(plan.unseen).toHaveLength(4);
  });

  it('handles empty and missing inputs', () => {
    expect(planSweep({ members: [], seenIds: [], cursor: cursor() }).sweep).toEqual([]);
    expect(planSweep({ members: null, seenIds: null, cursor: cursor() }).sweep).toEqual([]);
  });

  it('preserves member order in the sweep list', () => {
    const plan = planSweep({ members, seenIds: ['d', 'c', 'b', 'a'], cursor: cursor() });
    expect(plan.sweep.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('the sweep control label (INV-9b)', () => {
  it('states the exact scope, never a generic verb', () => {
    const plan = planSweep({
      members: [msg('a'), msg('b', { is_starred: true }), msg('c')],
      seenIds: ['a', 'b', 'c'],
      cursor: cursor(),
    });
    expect(sweepableCount(plan)).toBe(2);
    expect(sweepLabel(plan)).toBe('Clear 2 seen');
  });

  // A label computed independently of the request is how a control comes to overstate its scope,
  // which is the confirmation-dialog problem all over again. Same function, same number.
  it('counts exactly what the plan will sweep', () => {
    const plan = planSweep({
      members: [msg('a'), msg('b'), msg('c')],
      seenIds: ['a', 'b'],
      annotations: { b: { keepUntilSweep: 9 } },
      cursor: cursor(0),
    });
    expect(sweepableCount(plan)).toBe(plan.sweep.length);
    expect(sweepLabel(plan)).toBe('Clear 1 seen');
  });
});
