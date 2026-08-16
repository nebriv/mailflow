import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBundlesStore } from './bundlesStore.js';
import { bundlesApi } from './bundlesApi.js';
import { formatDate } from '../../utils/formatDate.js';
import { NS } from './locales.js';

// The reveal (INV-17, INV-18) and the reading feed (Phase 4), which are the same surface.
//
// The reveal exists because hiding is only safe if "where did it go" is one tap away. What it shows
// is the reading feed: the category's folder, reverse chronological, opened deliberately.
//
// Three properties it must have, and one it must not:
//   read-only        — nothing here mutates anything (INV-18)
//   does not affect pins — it is a view, and a pin is manual state that outranks views (INV-13)
//   non-persistent   — it reverts on leaving the screen; it is a glance, not a mode (INV-18)
//   NO counts        — no unread count, badge or bold state anywhere in it (INV-7, AV-2)
//
// The last one is the easiest to get wrong and the most important. A count here would turn the feed
// back into a queue, and the whole point of the feed is that reading material has somewhere to go
// that is NOT the queue reserved for things that need doing (§1, "non-problems").

export default function RevealPanel({ bundles }) {
  const { t } = useTranslation(NS);
  const accountId = useBundlesStore((s) => s.accountId);
  const setReveal = useBundlesStore((s) => s.setReveal);
  const [openKey, setOpenKey] = useState(null);
  const [feed, setFeed] = useState({ key: null, messages: [], loading: false });

  // Non-persistent: leaving the screen closes it. Nothing about the reveal is written anywhere.
  useEffect(() => () => setReveal(false), [setReveal]);

  useEffect(() => {
    if (!openKey || !accountId) return;
    let cancelled = false;
    setFeed({ key: openKey, messages: [], loading: true });
    bundlesApi.feed(accountId, openKey)
      .then((data) => { if (!cancelled) setFeed({ key: openKey, messages: data.messages || [], loading: false }); })
      .catch(() => { if (!cancelled) setFeed({ key: openKey, messages: [], loading: false }); });
    return () => { cancelled = true; };
  }, [openKey, accountId]);

  return (
    <div style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
      {bundles.map((bundle) => (
        <div key={bundle.key}>
          <button
            onClick={() => setOpenKey(openKey === bundle.key ? null : bundle.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '8px 14px', background: 'none', border: 'none',
              color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span style={{ flex: 1 }}>{t(`label.${bundle.key}`, bundle.label)}</span>
            {/* Deliberately not a count. When the bundle was last cleared is useful; how much is in
                it is exactly the number INV-7 forbids. */}
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {bundle.lastSweptAt ? t('reveal.sweptAt', { when: formatDate(bundle.lastSweptAt) }) : t('reveal.neverSwept')}
            </span>
          </button>

          {openKey === bundle.key && (
            <div>
              {feed.loading && (
                <div style={{ padding: '8px 14px 8px 28px', fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {t('reveal.loading')}
                </div>
              )}
              {!feed.loading && feed.messages.length === 0 && (
                <div style={{ padding: '8px 14px 8px 28px', fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {t('reveal.empty')}
                </div>
              )}
              {!feed.loading && feed.messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 14px 6px 28px',
                    fontSize: 12,
                    // No bold state. Every row in the feed reads the same, whether or not it has
                    // been opened (INV-7).
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span style={{ width: 110, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.fromName || m.fromEmail}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.subject || t('noSubject')}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                    {formatDate(m.date)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
