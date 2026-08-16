import { useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useBundlesStore } from './bundlesStore.js';
import { formatDate } from '../../utils/formatDate.js';
import { NS } from './locales.js';

// One bundle: a collapsed header row that expands in place.
//
// ── Why the header looks the way it does (§2) ───────────────────────────────────────────────────
// Typographically demoted below human mail but pre-attentively distinct: heavier weight and space
// above, no colour and no icon. Layer-cake scanning — fixating on headings — is the most efficient
// scan pattern and needs headings that are easy to pick out, and "has new mail" is encoded in ONE
// channel (the count), because single visual features are found in constant time while conjunctions
// are searched serially.
//
// The count is bounded by construction: it is what has arrived since the last sweep, so it is
// typically single digits. §1.1 is the failure it exists to avoid — 332 is a backlog already lost,
// and the rational response to a backlog already lost is to stop looking at it.

const HEADER_HEIGHT = 44;

export default function BundleRow({ bundle }) {
  const { t } = useTranslation(NS);
  const expanded = useBundlesStore((s) => s.expanded === bundle.key);
  const seen = useBundlesStore((s) => s.seen[bundle.key] || 0);
  const toggleExpanded = useBundlesStore((s) => s.toggleExpanded);
  const markSeen = useBundlesStore((s) => s.markSeen);
  const setSeen = useBundlesStore((s) => s.setSeen);
  const sweep = useBundlesStore((s) => s.sweep);
  const toggleKeep = useBundlesStore((s) => s.toggleKeep);
  const sweepable = useBundlesStore((s) => s.sweepableFor(bundle.key));

  const rowRefs = useRef([]);

  // Mark a row seen once it has actually been on screen. This is the entire seen mechanic: one
  // observable fact, no behavioural inference (INV-9d). The threshold asks for most of the row to be
  // visible so a row clipped at the fold does not count as read.
  useEffect(() => {
    if (!expanded) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number(entry.target.dataset.index);
          if (Number.isInteger(index)) markSeen(bundle.key, index);
        }
      },
      { threshold: 0.75 }
    );
    for (const el of rowRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, bundle.key, bundle.messages.length, markSeen]);

  // Drag the boundary to correct it by hand (INV-9c). The divider snaps to whichever row boundary is
  // nearest the pointer, so the user can only ever put it somewhere that means something.
  const onDividerDrag = useCallback((event) => {
    event.preventDefault();
    const move = (e) => {
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      let nearest = 0;
      let best = Infinity;
      rowRefs.current.forEach((el, i) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        for (const [edge, index] of [[rect.top, i], [rect.bottom, i + 1]]) {
          const d = Math.abs(edge - y);
          if (d < best) { best = d; nearest = index; }
        }
      });
      setSeen(bundle.key, nearest);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  }, [bundle.key, setSeen]);

  const sweepCount = sweepable.length;

  return (
    <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {/* ── Header ───────────────────────────────────────────────────────────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => toggleExpanded(bundle.key)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(bundle.key); } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          height: HEADER_HEIGHT, padding: '0 14px',
          marginTop: 8,
          cursor: 'pointer',
          background: 'var(--bg-secondary)',
          outline: 'none',
        }}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{
            color: 'var(--text-tertiary)', flexShrink: 0,
            transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s',
          }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>

        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}>
          {t(`label.${bundle.key}`, bundle.label)}
        </span>

        {/* The one channel that encodes "has new mail". Not a badge colour, not a bold dot, not both. */}
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', flexShrink: 0 }}>
          {bundle.count}
        </span>

        {/* ── The sweep control (INV-9, INV-9b) ───────────────────────────────────────────────
            One tap, no selection mode, no confirmation dialog on any path. The label states its
            exact scope, which is what removes the need to confirm scope in a dialog. It is disabled
            rather than hidden when nothing is seen, so the affordance stays where the user expects
            it and explains itself. */}
        {expanded && (
          <button
            onClick={(e) => { e.stopPropagation(); if (sweepCount) sweep(bundle.key); }}
            disabled={!sweepCount}
            title={sweepCount ? t('sweep.hint') : t('sweep.hintDisabled')}
            style={{
              flexShrink: 0,
              background: sweepCount ? 'var(--accent-dim)' : 'transparent',
              border: `1px solid ${sweepCount ? 'rgba(124,106,247,0.3)' : 'var(--border)'}`,
              borderRadius: 6,
              color: sweepCount ? 'var(--accent)' : 'var(--text-tertiary)',
              fontSize: 11, fontWeight: 600, padding: '4px 10px',
              cursor: sweepCount ? 'pointer' : 'default',
            }}
          >
            {sweepCount ? t('sweep.clearSeen', { count: sweepCount }) : t('sweep.nothingSeen')}
          </button>
        )}
      </div>

      {/* ── Expanded contents ────────────────────────────────────────────────────────────────── */}
      {expanded && (
        <div>
          {bundle.messages.map((message, index) => (
            <div key={message.id}>
              {/* The boundary, drawn where the sweep will actually cut (INV-9c). The count in this
                  label and the count in the button come from the same computation. */}
              {index === seen && seen > 0 && (
                <SeenDivider count={seen} onDrag={onDividerDrag} />
              )}
              <BundleMessage
                message={message}
                index={index}
                innerRef={(el) => { rowRefs.current[index] = el; }}
                onToggleKeep={() => toggleKeep(bundle.key, message)}
              />
            </div>
          ))}
          {/* Everything seen: the boundary sits at the end of the list rather than vanishing. */}
          {seen >= bundle.messages.length && bundle.messages.length > 0 && (
            <SeenDivider count={seen} onDrag={onDividerDrag} atEnd />
          )}
          {/* INV-11: the UI must state that sweep files rather than deletes. */}
          <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-tertiary)' }}>
            {t('sweep.filesInto', { label: t(`label.${bundle.key}`, bundle.label) })}
          </div>
        </div>
      )}
    </div>
  );
}

// The visible seen boundary. A rule with the count above it, draggable to correct by hand.
function SeenDivider({ count, onDrag, atEnd }) {
  const { t } = useTranslation(NS);
  return (
    <div
      onPointerDown={onDrag}
      role="separator"
      aria-label={t('divider.adjust', { count })}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '2px 14px',
        cursor: 'ns-resize',
        touchAction: 'none',
        opacity: atEnd ? 0.6 : 1,
      }}
    >
      <div style={{ height: 1, background: 'var(--accent)', flex: 1, opacity: 0.5 }} />
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
        {t('divider.seen', { count })}
      </span>
      <div style={{ height: 1, background: 'var(--accent)', flex: 1, opacity: 0.5 }} />
    </div>
  );
}

// A message inside an expanded bundle. Denser than a main-list row: §2.3's batch processing works
// because the open bundle is homogeneous, so the sender and subject are all that need to be read.
function BundleMessage({ message, index, innerRef, onToggleKeep }) {
  const { t } = useTranslation(NS);
  const kept = !!message.keepUntilSweep;
  const keepTitle = message.pinned ? t('keep.pinned') : kept ? t('keep.kept') : t('keep.add');
  return (
    <div
      ref={innerRef}
      data-index={index}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px 8px 32px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-primary)',
      }}
    >
      {/* Keep, in one gesture, without opening the message, reversible by the same gesture
          (INV-10b). It reads as a state indicator rather than a button because that is what it is —
          and because a Keep that decays (INV-10a) should feel free to apply and free to be wrong
          about. Pinned rows show a filled marker instead: a pin outranks everything (INV-13). */}
      <button
        onClick={onToggleKeep}
        aria-label={kept ? t('keep.remove') : t('keep.add')}
        aria-pressed={kept}
        title={keepTitle}
        disabled={message.pinned}
        style={{
          flexShrink: 0, width: 10, height: 10, borderRadius: '50%', padding: 0,
          border: `1.5px solid ${message.pinned || kept ? 'var(--accent)' : 'var(--border)'}`,
          background: message.pinned || kept ? 'var(--accent)' : 'transparent',
          cursor: message.pinned ? 'default' : 'pointer',
        }}
      />
      <span style={{
        fontSize: 12, color: 'var(--text-secondary)', width: 120, flexShrink: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {message.fromName || message.fromEmail}
      </span>
      <span style={{
        fontSize: 12, color: 'var(--text-primary)', flex: 1, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {message.subject || t('noSubject')}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
        {formatDate(message.date)}
      </span>
    </div>
  );
}
