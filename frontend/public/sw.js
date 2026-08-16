// MailFlow Service Worker — Web Push, notification clicks, and the offline app shell.
//
// Two jobs, deliberately separated from a third it does NOT do:
//   1. push delivery + notification click handling
//   2. caching the app shell, so the app opens with no network
//   3. NOT caching /api — mail is cached by the app in IndexedDB (utils/offlineCache.js)
//
// (3) is the important one. An HTTP cache here would serve stale mail indistinguishably from fresh
// mail: the app could not tell the difference, so it could not tell the user. Caching mail in
// IndexedDB instead means every entry carries the time it was written and the UI can say "showing
// mail from 09:12" rather than quietly presenting an hour-old inbox as current. The shell is static
// and versioned, so it has no such problem and belongs here.

const SHELL_CACHE = 'mailflow-shell-v1';

self.addEventListener('install', () => {
  // Activate immediately rather than waiting for existing tabs to close.
  //
  // This was previously justified by the SW holding no state at all. It now holds a shell cache, so
  // the reasoning is different: the cache is keyed by Vite's content-hashed filenames, so an old tab
  // asking for an old asset still finds exactly its own version, and a new tab asks for new URLs
  // that simply miss and fetch. Stale entries are swept on activate.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop shell caches from earlier SW versions so a format change cannot leave orphans behind.
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('mailflow-shell-') && n !== SHELL_CACHE)
      .map((n) => caches.delete(n)));
    // Take control of existing clients so push events reach this SW version.
    await self.clients.claim();
  })());
});

// Whether a request is part of the app shell — same-origin, GET, and not the API.
function isShellRequest(request, url) {
  return request.method === 'GET'
    && url.origin === self.location.origin
    && !url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Anything not shell — the API, cross-origin, non-GET — is left entirely alone. No respondWith
  // means the browser handles it exactly as if this SW did not exist.
  if (!isShellRequest(event.request, url)) return;

  // Navigations: network first, so a deploy is picked up on the next load, falling back to the
  // cached document so the app still opens with no signal.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(event.request);
        if (res.ok) (await caches.open(SHELL_CACHE)).put('/index.html', res.clone());
        return res;
      } catch {
        const cached = await caches.match('/index.html', { cacheName: SHELL_CACHE });
        if (cached) return cached;
        throw new Error('offline and no cached shell');
      }
    })());
    return;
  }

  // Everything else in the shell — hashed JS/CSS bundles, fonts, icons — is immutable, so a cache
  // hit is always correct and always preferable.
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { cacheName: SHELL_CACHE });
    if (cached) return cached;
    const res = await fetch(event.request);
    // Opaque and error responses are not cached: an opaque response cannot be inspected for
    // success, so caching one risks pinning a failure forever.
    if (res.ok && res.type === 'basic') (await caches.open(SHELL_CACHE)).put(event.request, res.clone());
    return res;
  })());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (_) {
    return;
  }

  const {
    title       = 'MailFlow',
    body        = 'New message',
    icon        = '/icon-512.png',
    url         = '/',
    unreadCount,          // intentionally no default — undefined means "don't touch badge"
  } = data;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const promises = [];

        // Update the home screen badge (iOS 17.4+, Android Chrome PWA).
        // Only runs when unreadCount is explicitly provided — a missing value
        // means the backend couldn't determine the count and should not clear it.
        // Uses self.navigator — bare `navigator` is not reliably exposed in iOS
        // Safari service worker scope.
        try {
          if (self.navigator && 'setAppBadge' in self.navigator && unreadCount != null) {
            const p = unreadCount > 0
              ? self.navigator.setAppBadge(unreadCount)
              : self.navigator.clearAppBadge();
            if (p && typeof p.then === 'function') promises.push(p.catch(() => {}));
          }
        } catch (_) {}

        // iOS/WebKit requires showNotification() to be called for every push event.
        // Skipping it — even when a client is focused — causes WebKit to log a
        // user-visible-notification violation and will eventually revoke push permission.
        // The in-app WebSocket toast still fires independently via the open client.
        promises.push(
          self.registration.showNotification(title, {
            body,
            icon,
            badge: '/icon-512.png',
            data:  { url },
            // Replace any existing MailFlow notification so rapid arrivals
            // don't stack unboundedly in the notification center.
            tag:      'mailflow-new-mail',
            renotify: true,
          })
        );

        return Promise.all(promises);
      })
  );
});

// Persist a deep-link target in IndexedDB so the page can consume it on focus or
// launch. This is the reliable channel on iOS: postMessage can be missed on a
// focus-with-reload, and iOS ignores the openWindow() URL on a cold launch — but a
// persisted target survives both. Fully guarded so a storage error never rejects
// the waitUntil. (Only reachable when the app is backgrounded — iOS does not fire
// notificationclick at all for a fully-terminated PWA.)
function storePendingDeepLink(url) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    try {
      const open = indexedDB.open('mailflow-nav', 1);
      open.onupgradeneeded = () => { try { open.result.createObjectStore('kv'); } catch (_) {} };
      open.onerror = done;
      open.onblocked = done;
      open.onsuccess = () => {
        try {
          const db = open.result;
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(url, 'pending_deeplink');
          tx.oncomplete = () => { db.close(); done(); };
          tx.onerror = () => { db.close(); done(); };
          tx.onabort = () => { db.close(); done(); };
        } catch (_) { done(); }
      };
    } catch (_) { done(); }
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  const deepLink = !!targetUrl && targetUrl !== '/';

  event.waitUntil(
    (deepLink ? storePendingDeepLink(targetUrl) : Promise.resolve())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((clients) => {
        const existing = clients.find(
          (c) => new URL(c.url).origin === self.location.origin
        );
        if (existing) {
          // Nudge the live client to consume the persisted deep-link immediately
          // (no reload). Harmless if nothing is listening.
          if (deepLink) existing.postMessage({ type: 'mailflow_deeplink' });
          return existing.focus();
        }
        // Cold/killed: openWindow's URL is honored on Chromium and ignored on iOS,
        // but the persisted target above covers iOS on the next app launch.
        return self.clients.openWindow(targetUrl);
      })
  );
});
