import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBundlesStore } from './bundlesStore.js';
import { formatDate } from '../../utils/formatDate.js';
import { NS } from './locales.js';

// The dry-run review surface — what GATE 1 is actually measured on.
//
// While BUNDLES_DRY_RUN is set the plugin writes nothing to the mail server, so there are no bundle
// rows to render and the inbox looks exactly like stock MailFlow. This takes their place: a single
// collapsed line saying what the classifier WOULD have done, expanding to the evidence.
//
// ── Why it is a review surface and not a preview ────────────────────────────────────────────────
// The temptation is to render fake bundle rows so the client can "see what it would look like".
// That would be the wrong tool. GATE 1 asks for 14 consecutive days with zero S-6 and zero S-7
// violations — a message from a correspondent, or a security/financial/transactional message,
// landing in a bundle. Finding those means reading a flat list of everything that would have been
// bundled, sorted so the newest arrivals are checked first, with the deciding rule visible on every
// row. A pretty mock of the final UI hides exactly the rows you are hunting for.
//
// So this deliberately shows MORE than the real UI ever will: every message, its sender, its
// subject, and the rule that classified it. It is an instrument, and it disappears completely once
// the dry run is switched off.

export default function DryRunPanel() {
  const { t } = useTranslation(NS);
  const report = useBundlesStore((s) => s.report);
  const loading = useBundlesStore((s) => s.reportLoading);
  const refresh = useBundlesStore((s) => s.fetchReport);
  const [open, setOpen] = useState(false);

  if (!report && !loading) return null;

  return (
    <div style={{
      borderBottom: '1px solid var(--border-subtle)',
      // Deliberately not styled like mail. This is diagnostic chrome and should never be mistaken
      // for a row you can act on.
      background: 'var(--bg-tertiary)',
      borderLeft: '3px solid var(--accent)',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '8px 14px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left', color: 'var(--text-secondary)', fontSize: 12,
        }}
      >
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
          color: 'var(--accent)', flexShrink: 0,
        }}>
          {t('dryRun.badge')}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          {loading || !report
            ? t('reveal.loading')
            : t('dryRun.summary', { bundled: report.wouldBundle, scanned: report.scanned })}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
          {open ? t('dryRun.hide') : t('dryRun.review')}
        </span>
      </button>

      {open && report && (
        <div>
          {/* The bar to check against. Stated in the panel so the reviewer is not expected to
              remember what they are looking for. */}
          <div style={{ padding: '4px 14px 8px', fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            {t('dryRun.instructions')}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: '0 14px 8px' }}>
            {Object.entries(report.byBundle)
              .filter(([, n]) => n > 0)
              .map(([key, n]) => (
                <span key={key} style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {t(`label.${key}`, key)}
                  <strong style={{ marginLeft: 4, color: 'var(--text-primary)' }}>{n}</strong>
                  <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>
                    {t('dryRun.senders', { count: report.distinctSenders?.[key] || 0 })}
                  </span>
                </span>
              ))}
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {t('dryRun.rows', { before: report.rowsBefore, after: report.rowsAfter })}
            </span>
          </div>

          {report.messages.length === 0 && (
            <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-tertiary)' }}>
              {t('dryRun.nothing')}
            </div>
          )}

          {report.messages.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 8,
                padding: '5px 14px', fontSize: 11,
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <span style={{
                width: 78, flexShrink: 0, color: 'var(--accent)', fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {t(`label.${m.bundle}`, m.bundle)}
              </span>
              <span style={{
                width: 150, flexShrink: 0, color: 'var(--text-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {m.from}
              </span>
              <span style={{
                flex: 1, minWidth: 0, color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {m.subject || t('noSubject')}
              </span>
              {/* The deciding rule. A wrong verdict points straight at the rule that made it, which
                  is the difference between "the classifier is broken" and a one-line fix. */}
              <code style={{
                flexShrink: 0, fontSize: 10, color: 'var(--text-tertiary)',
                background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: 3,
              }}>
                {m.reason}
              </code>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                {formatDate(m.date)}
              </span>
            </div>
          ))}

          <button
            onClick={refresh}
            disabled={loading}
            style={{
              margin: '8px 14px', padding: '3px 10px',
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11,
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            {t('dryRun.refresh')}
          </button>
        </div>
      )}
    </div>
  );
}
