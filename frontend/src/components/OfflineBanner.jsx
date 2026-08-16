import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Says when what you are looking at is not current.
//
// The offline cache (utils/offlineCache.js) exists so the app is usable with no signal, and the
// price of that is that you can be reading an hour-old inbox. Somewhere has to say so, or the cache
// stops being a convenience and becomes a way to miss mail without knowing it — you would tap a
// message that had already been dealt with, or believe an empty bundle was empty.
//
// It appears only when a request was actually answered from cache, not merely when the browser
// reports itself offline: `navigator.onLine` is famously optimistic (it reports true on a captive
// portal or a dead uplink), so a banner driven by it would cry wolf on a working connection and stay
// silent on a broken one. A served-from-cache event is direct evidence.

export default function OfflineBanner() {
  const { t } = useTranslation();
  const [cachedAt, setCachedAt] = useState(null);

  useEffect(() => {
    const onCache = (e) => setCachedAt(e.detail?.cachedAt || Date.now());
    // A successful reconnect clears it. The next live request will simply not fire the event again,
    // but waiting for that leaves a false banner on screen in the meantime.
    const onOnline = () => setCachedAt(null);
    window.addEventListener('mailflow:served-from-cache', onCache);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('mailflow:served-from-cache', onCache);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  if (!cachedAt) return null;

  const when = new Date(cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      role="status"
      // Overlaid rather than placed in the layout flow. An in-flow banner would have to be inserted
      // into the mail layout, which is the part of core this fork most wants to leave alone.
      style={{
        position: 'fixed',
        top: 'calc(var(--sat, 0px) + 8px)', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 12px', zIndex: 3000, pointerEvents: 'none',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 999,
        boxShadow: 'var(--shadow-soft)',
        color: 'var(--text-tertiary)', fontSize: 11, whiteSpace: 'nowrap',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <span>{t('offline.cached', { time: when, defaultValue: `Offline — showing mail cached at ${when}` })}</span>
    </div>
  );
}
