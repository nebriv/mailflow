import test from 'node:test';
import assert from 'node:assert/strict';

import { isNetworkFailure, MAX_BODIES, MAX_LISTS } from './offlineCache.js';

// isNetworkFailure is the whole safety of the offline fallback, so it is tested directly.
//
// `request()` converts any non-ok RESPONSE into an Error, while fetch rejects with a TypeError when
// it could not reach the server at all. Serving cached mail on a TypeError is the feature; serving
// it on a 500 would hide a server fault behind stale data, and on a 401 would show mail after the
// session had expired.

const withOnline = (value, fn) => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'navigator');
  const prev = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: value }, configurable: true, writable: true,
  });
  try {
    fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', { value: prev, configurable: true, writable: true });
    else delete globalThis.navigator;
  }
};

test('a fetch-level failure counts as a network failure', () => {
  withOnline(true, () => {
    assert.equal(isNetworkFailure(new TypeError('Failed to fetch')), true);
  });
});

test('a server error does not — a 500 must not be masked by stale mail', () => {
  withOnline(true, () => {
    assert.equal(isNetworkFailure(new Error('Request failed')), false);
  });
});

test('an expired session does not — mail must not show after 401', () => {
  withOnline(true, () => {
    assert.equal(isNetworkFailure(new Error('Not authenticated')), false);
  });
});

// The one case where a plain Error is treated as a network failure: the browser itself reports the
// connection is gone, so no response could have been read anyway.
test('any failure counts while the browser reports itself offline', () => {
  withOnline(false, () => {
    assert.equal(isNetworkFailure(new Error('Request failed')), true);
    assert.equal(isNetworkFailure(new TypeError('Failed to fetch')), true);
  });
});

test('caches are bounded, so a long-lived install cannot grow without limit', () => {
  for (const bound of [MAX_BODIES, MAX_LISTS]) {
    assert.equal(Number.isInteger(bound), true);
    assert.ok(bound > 0 && Number.isFinite(bound));
  }
  // Bodies are the expensive entries and get the larger budget; lists are metadata only.
  assert.ok(MAX_BODIES > MAX_LISTS);
});
