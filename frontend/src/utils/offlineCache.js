// Offline read cache (Phase 7, read half).
//
// An IndexedDB mirror of what you have already looked at, so the app is useful with no signal:
// message lists as fetched, and the bodies of messages you actually opened.
//
// ── Why IndexedDB and not the service worker ────────────────────────────────────────────────────
// The service worker deliberately does NOT cache `/api` (see public/sw.js). An HTTP cache in the SW
// would serve stale mail indistinguishably from fresh mail — the app could not tell, so it could not
// say so. Here the app owns the cache, knows exactly when each entry was written, and can render
// "showing mail from 09:12" instead of quietly lying. The SW caches the app shell; this caches the
// mail. Neither does the other's job.
//
// ── What is deliberately never stored ───────────────────────────────────────────────────────────
// Attachments, and any body fetched with remote images enabled.
//
// The second is the subtle one. `getMessageBody(id, remoteImages)` has two variants, and the
// remote-images variant contains content pulled from whatever hosts the sender chose — tracking
// pixels included. Caching it would write the results of a tracker fetch to disk and replay them
// later. Only the blocked variant is ever cached, which also means going offline can never
// accidentally reveal a body you had chosen to keep images blocked on.

const DB_NAME = 'mailflow-offline';
const DB_VERSION = 1;
const LISTS = 'lists';
const BODIES = 'bodies';

// Bodies are the expensive entries, so they are bounded and pruned oldest-first. Roughly a few days
// of reading for a working inbox; the spec's target is a 30-minute commute served from cache, not a
// full local mirror of the mailbox.
export const MAX_BODIES = 300;

// Lists are small (metadata only), but a distinct entry accumulates per query string — folder,
// account, page — so they are bounded too.
export const MAX_LISTS = 60;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  // Never rejects. Every failure path resolves to null, which callers read as "caching
  // unavailable" — a broken cache must degrade to online-only, never to a broken app.
  dbPromise = new Promise((resolve) => {
    // Absent in older browsers and in some private-browsing modes. Callers treat a null db as
    // "caching unavailable" and carry on online-only.
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LISTS)) db.createObjectStore(LISTS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(BODIES)) db.createObjectStore(BODIES, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve) => {
    let out;
    try {
      const t = db.transaction(store, mode);
      out = fn(t.objectStore(store));
      t.oncomplete = () => resolve(out?.result ?? out ?? null);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// Every operation is best-effort. A cache that throws is worse than no cache: it would turn a
// working online session into a broken one over a storage quota.
async function withStore(store, mode, fn) {
  const db = await openDb();
  if (!db) return null;
  return tx(db, store, mode, fn);
}

// Drop the oldest entries once a store exceeds its bound.
async function prune(store, max) {
  const all = await withStore(store, 'readonly', (s) => s.getAll());
  if (!Array.isArray(all) || all.length <= max) return;
  const doomed = all
    .sort((a, b) => (a.cachedAt || 0) - (b.cachedAt || 0))
    .slice(0, all.length - max);
  await withStore(store, 'readwrite', (s) => { for (const e of doomed) s.delete(e.key); });
}

// ── Message lists ───────────────────────────────────────────────────────────────────────────────

export async function putList(key, data) {
  await withStore(LISTS, 'readwrite', (s) => s.put({ key, data, cachedAt: Date.now() }));
  await prune(LISTS, MAX_LISTS);
}

export async function getList(key) {
  const hit = await withStore(LISTS, 'readonly', (s) => s.get(key));
  return hit ? { data: hit.data, cachedAt: hit.cachedAt } : null;
}

// ── Message bodies ──────────────────────────────────────────────────────────────────────────────

export async function putBody(key, data) {
  await withStore(BODIES, 'readwrite', (s) => s.put({ key, data, cachedAt: Date.now() }));
  await prune(BODIES, MAX_BODIES);
}

export async function getBody(key) {
  const hit = await withStore(BODIES, 'readonly', (s) => s.get(key));
  return hit ? { data: hit.data, cachedAt: hit.cachedAt } : null;
}

// ── Housekeeping ────────────────────────────────────────────────────────────────────────────────

// Wipe everything. Called on sign-out: the cache holds mail, so it must not outlive the session
// that was allowed to read it.
export async function clearOfflineCache() {
  await withStore(LISTS, 'readwrite', (s) => s.clear());
  await withStore(BODIES, 'readwrite', (s) => s.clear());
}

// Ask the browser not to evict this origin's storage under pressure. Advisory, and on most browsers
// granted silently for an installed PWA; a refusal is not an error.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* not supported — the cache still works, it is just evictable */ }
  return false;
}

// Whether a failed request failed because the network is gone, as opposed to the server answering
// with an error.
//
// This distinction is the whole safety of the fallback. `request()` turns any non-ok RESPONSE into
// an Error, while fetch rejects with a TypeError when it could not reach the server at all. Serving
// cached mail on a TypeError is correct; serving it on a 500 would hide a real server fault behind
// stale data, and on a 401 would show mail after the session had expired.
export function isNetworkFailure(err) {
  return err instanceof TypeError || navigator.onLine === false;
}

// Announce that a request was answered from cache rather than from the server.
//
// A window event rather than a return value threaded through the store: every caller of
// api.getMessages / getMessageBody would otherwise have to remember to propagate the flag, and the
// one that forgot would silently present hour-old mail as current. One listener renders the banner
// (components/OfflineBanner.jsx) and nothing else has to participate.
export function noteServedFromCache(cachedAt) {
  try {
    window.dispatchEvent(new CustomEvent('mailflow:served-from-cache', { detail: { cachedAt } }));
  } catch { /* non-browser context (tests) — the caller still gets its data */ }
}
