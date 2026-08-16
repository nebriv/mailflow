// HTTP calls for the bundles plugin.
//
// The plugin owns its own tiny request helper rather than adding methods to core's utils/api.js.
// Every method added there would be core diff (INV-22 budgets 50 lines total, and the seam in
// MessageList.jsx is where that budget belongs), and a plugin that can be deleted by removing its
// directory is the point of the boundary. Only the CSRF constants are imported from core — they are
// exported precisely so a non-core caller can satisfy the backend's CSRF guard.
import { CSRF_HEADER, CSRF_VALUE } from '../../utils/api.js';

const BASE = '/api/bundles';

async function request(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: { [CSRF_HEADER]: CSRF_VALUE },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const bundlesApi = {
  // Every bundle's current state for one account.
  list: (accountId) => request('GET', `/?accountId=${encodeURIComponent(accountId)}`),

  // The reading feed for one category (Phase 4) — carries no counts (INV-7).
  feed: (accountId, key) => request('GET', `/feed/${key}?accountId=${encodeURIComponent(accountId)}`),

  // What a sweep WOULD do, for the control's label. Same code path as the sweep itself, so the
  // label cannot overstate the scope (INV-9b).
  plan: (accountId, key, seenIds) =>
    request('GET', `/${key}/plan?accountId=${encodeURIComponent(accountId)}&seenIds=${seenIds.map(encodeURIComponent).join(',')}`),

  // One tap. `seenIds` is always sent explicitly — never omitted to mean "everything" (INV-9a).
  sweep: (accountId, key, seenIds) => request('POST', `/${key}/sweep`, { accountId, seenIds }),

  undo: (accountId, token) => request('POST', '/undo', { accountId, token }),

  keep: (accountId, messageId, keep) => request('POST', '/keep', { accountId, messageId, keep }),

  migrate: (accountId) => request('POST', '/migrate', { accountId }),
};
