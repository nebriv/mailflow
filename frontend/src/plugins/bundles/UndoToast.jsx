import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBundlesStore } from './bundlesStore.js';
import { NS } from './locales.js';

// The undo toast (INV-12).
//
// The plugin renders its own rather than using core's notification toasts, for two reasons that are
// both about the invariant rather than about taste. Core's toast auto-dismisses after 6 seconds,
// below INV-12's 10-second floor; and core's desktop layout renders only non-undoable
// notifications, so an undo affordance would be invisible there. Owning the component keeps the
// window exactly what the server says it is (UNDO_WINDOW_SECONDS) on every surface, and costs no
// core diff (INV-22).
//
// Non-blocking by construction: it is fixed to the bottom of the viewport, takes no focus, and
// intercepts no input outside its own two buttons. That is what lets sweep have no confirmation
// dialog on any path (INV-9) — the safety net is after the action, not in front of it.

export default function UndoToast() {
  const { t } = useTranslation(NS);
  const undo = useBundlesStore((s) => s.undo);
  const undoSweep = useBundlesStore((s) => s.undoSweep);
  const dismissUndo = useBundlesStore((s) => s.dismissUndo);
  const [remaining, setRemaining] = useState(() => Math.max(0, (undo?.expiresAt || 0) - Date.now()));

  useEffect(() => {
    if (!undo) return undefined;
    const tick = setInterval(() => {
      const left = undo.expiresAt - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0) dismissUndo();
    }, 200);
    return () => clearInterval(tick);
  }, [undo, dismissUndo]);

  if (!undo) return null;

  const pct = Math.max(0, Math.min(100, (remaining / Math.max(1, undo.windowMs)) * 100));

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: 'calc(var(--sab, 0px) + 20px)',
        left: 16, right: 16,
        maxWidth: 380, margin: '0 auto',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        boxShadow: 'var(--shadow-soft)',
        padding: '10px 8px 10px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
        zIndex: 3000,
        overflow: 'hidden',
      }}
    >
      <div style={{
        position: 'absolute', bottom: 0, left: 0, height: 2,
        width: `${pct}%`, background: 'var(--accent)', transition: 'width 0.2s linear',
      }} />

      <span style={{
        flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {/* Says where the mail went, not that it is gone. Sweep files, never deletes (INV-11), and
            the UI is required to state that. */}
        {t('undo.filed', { count: undo.count, label: undo.bundle })}
      </span>

      <button
        onClick={undoSweep}
        style={{
          background: 'var(--accent-dim)', border: '1px solid rgba(124,106,247,0.3)',
          borderRadius: 6, color: 'var(--accent)', fontSize: 12, fontWeight: 600,
          padding: '4px 12px', cursor: 'pointer', flexShrink: 0,
        }}
      >
        {t('undo.action')}
      </button>

      <button
        onClick={dismissUndo}
        aria-label={t('undo.dismiss')}
        style={{
          background: 'none', border: 'none', color: 'var(--text-tertiary)',
          cursor: 'pointer', padding: '4px 6px', display: 'flex', flexShrink: 0,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
