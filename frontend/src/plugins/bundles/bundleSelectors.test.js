import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bundledMessageIds, visibleBundles, sweptBundles,
  seenIdsFor, sweepableFor, advanceSeen, clampSeen,
} from './bundleSelectors.js';

const msg = (id, over = {}) => ({ id, subject: id, pinned: false, keepUntilSweep: null, ...over });

const bundles = [
  { key: 'newsletters', label: 'Newsletters', count: 3, messages: [msg('a'), msg('b'), msg('c')] },
  { key: 'promotions', label: 'Promotions', count: 0, messages: [] },
  { key: 'notifications', label: 'Notifications', count: 2, messages: [msg('d'), msg('e')] },
];

test('bundledMessageIds collects every message held in a bundle', () => {
  const ids = bundledMessageIds(bundles);
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('bundledMessageIds is empty for missing or empty input', () => {
  assert.equal(bundledMessageIds(null).size, 0);
  assert.equal(bundledMessageIds([]).size, 0);
  assert.equal(bundledMessageIds([{ key: 'x', messages: null }]).size, 0);
});

// INV-6: a bundle with nothing after its cursor renders no row. §1.4 — a row that is always present
// cannot be cleared, so there would be nothing to clear and no zero state.
test('visibleBundles omits bundles with nothing since their cursor', () => {
  assert.deepEqual(visibleBundles(bundles).map(b => b.key), ['newsletters', 'notifications']);
});

test('sweptBundles is the complement, so the reveal can still reach them', () => {
  assert.deepEqual(sweptBundles(bundles).map(b => b.key), ['promotions']);
  const all = new Set([...visibleBundles(bundles), ...sweptBundles(bundles)].map(b => b.key));
  assert.equal(all.size, bundles.length);
});

test('an inbox where everything is swept renders no bundle rows at all', () => {
  const cleared = bundles.map(b => ({ ...b, count: 0, messages: [] }));
  assert.deepEqual(visibleBundles(cleared), []);
});

// INV-9a: reading is the selection mechanism. Only what has been on screen is in scope.
test('seenIdsFor returns exactly the rows above the boundary', () => {
  assert.deepEqual(seenIdsFor(bundles, { newsletters: 2 }, 'newsletters'), ['a', 'b']);
  assert.deepEqual(seenIdsFor(bundles, { newsletters: 0 }, 'newsletters'), []);
  assert.deepEqual(seenIdsFor(bundles, {}, 'newsletters'), []);
});

test('seenIdsFor is empty for an unknown bundle', () => {
  assert.deepEqual(seenIdsFor(bundles, { nope: 5 }, 'nope'), []);
});

// INV-10 / INV-13: pinned and kept messages survive a sweep even when they are above the boundary.
test('sweepableFor excludes pinned and kept messages', () => {
  const withTiers = [{
    key: 'newsletters',
    count: 4,
    messages: [msg('a'), msg('b', { pinned: true }), msg('c', { keepUntilSweep: 5 }), msg('d')],
  }];
  const sweepable = sweepableFor(withTiers, { newsletters: 4 }, 'newsletters');
  assert.deepEqual(sweepable.map(m => m.id), ['a', 'd']);
});

// S-3b: a sweep clears no message the user has not seen. This is what removes the need for the
// confirmation dialog (§1.3).
test('sweepableFor never reaches below the boundary', () => {
  const sweepable = sweepableFor(bundles, { newsletters: 1 }, 'newsletters');
  assert.deepEqual(sweepable.map(m => m.id), ['a']);
});

// INV-9b: the control's label and the request are the same computation, so the label cannot
// overstate its scope.
test('the label count equals what the sweep will clear', () => {
  const withTiers = [{
    key: 'n', count: 3, messages: [msg('a'), msg('b', { pinned: true }), msg('c')],
  }];
  const seen = { n: 3 };
  const sweepable = sweepableFor(withTiers, seen, 'n');
  const requested = seenIdsFor(withTiers, seen, 'n');
  assert.equal(sweepable.length, 2);
  // The request carries everything seen; the server subtracts the survivors, and the label states
  // the post-subtraction number.
  assert.equal(requested.length, 3);
  assert.deepEqual(sweepable.map(m => m.id), ['a', 'c']);
});

// The high-water mark only grows, so scrolling back up does not un-see anything.
test('advanceSeen is monotonic', () => {
  assert.equal(advanceSeen(0, 0), 1);
  assert.equal(advanceSeen(3, 5), 6);
  assert.equal(advanceSeen(6, 2), 6);
  assert.equal(advanceSeen(undefined, 0), 1);
});

// INV-9c: the manual correction is deliberately NOT monotonic — the point is to pull it back.
test('clampSeen allows a downward correction but stays inside the list', () => {
  assert.equal(clampSeen(2, 5), 2);
  assert.equal(clampSeen(-3, 5), 0);
  assert.equal(clampSeen(99, 5), 5);
  assert.equal(clampSeen(3, 0), 0);
});
