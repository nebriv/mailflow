import { useTranslation } from 'react-i18next';
import { useBundlesStore } from './bundlesStore.js';
import { visibleBundles, sweptBundles } from './bundleSelectors.js';
import BundleRow from './BundleRow.jsx';
import UndoToast from './UndoToast.jsx';
import RevealPanel from './RevealPanel.jsx';
import { NS } from './locales.js';

// What the `message-list-top` slot renders: the bundle rows, inline in the message list, above the
// loose messages.
//
// Inline is the point (§2.2). Bundled mail is "grouped together but still visible — not completely
// out of sight and out of mind, as they are with Gmail's tabs system". A tab strip would file this
// mail away; a row in the same list keeps it in view while spending one row instead of twenty.

export default function BundleRows() {
  const { t } = useTranslation(NS);
  const bundles = useBundlesStore((s) => s.bundles);
  const reveal = useBundlesStore((s) => s.reveal);
  const setReveal = useBundlesStore((s) => s.setReveal);
  const undo = useBundlesStore((s) => s.undo);

  const visible = visibleBundles(bundles);
  // Bundles that exist but have nothing since their cursor. They render NO row (INV-6) — they are
  // only counted here so the reveal can offer a way back to them.
  const swept = sweptBundles(bundles);

  return (
    <>
      {visible.map((bundle) => <BundleRow key={bundle.key} bundle={bundle} />)}

      {/* ── The reveal (INV-17, INV-18) ─────────────────────────────────────────────────────────
          Hiding is only safe if "where did it go" is one tap away. This is that tap. It is
          read-only, does not affect pins, and is non-persistent — a glance, not a mode. */}
      {swept.length > 0 && (
        <button
          onClick={() => setReveal(!reveal)}
          style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: '6px 14px', marginTop: visible.length ? 0 : 8,
            background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle)',
            color: 'var(--text-tertiary)', fontSize: 11, cursor: 'pointer',
          }}
        >
          {reveal ? t('reveal.hide') : t('reveal.show', { count: swept.length })}
        </button>
      )}

      {reveal && <RevealPanel bundles={swept} />}

      {undo && <UndoToast />}
    </>
  );
}
