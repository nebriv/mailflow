// The plugin's own state. Separate from core's store so the plugin owns its data and can be deleted
// by deleting its directory.
//
// ── The seen mark (INV-9a, INV-9c, INV-9d) ──────────────────────────────────────────────────────
// `seen[bundleKey]` is a COUNT: how many rows from the top of the expanded bundle the user has had
// on screen. That representation is the whole design.
//
// It is a high-water mark, so it only ever grows while a bundle stays open — scrolling back up does
// not un-see anything. It maps one-to-one onto a divider position, so what the user is promised
// ("everything above this line") and what the request contains (`messages.slice(0, seen)`) are the
// same number, computed once. And it is derived from one fact — a row was on screen — never from
// scroll speed, dwell time or any other behavioural signal (INV-9d).
//
// That last part is not fussiness. The mechanic works because it is mechanically legible and
// perfectly predictable; inference fails silently and asymmetrically, and cannot be debugged when
// wrong, which is exactly what made Spark's confirmation dialog necessary in the first place (§1.3).

import { create } from 'zustand';
import { bundlesApi } from './bundlesApi.js';
import { advanceSeen, clampSeen, seenIdsFor, sweepableFor } from './bundleSelectors.js';

// Ask core's message list to reload. `mailflow:refresh` is an event MessageList already listens
// for, so a sweep refreshes the loose rows with no core change of its own.
const refreshMessageList = () => window.dispatchEvent(new Event('mailflow:refresh'));

// The display label for a bundle key, for user-facing text ("9 filed into Newsletters").
const bundleLabelOf = (bundles, key) => bundles.find((b) => b.key === key)?.label || key;

export const useBundlesStore = create((set, get) => ({
  accountId: null,
  bundles: [],
  loading: false,
  error: null,

  // Which bundle is expanded. At most one: §2.3's batch processing works because the open bundle is
  // homogeneous, and two open bundles is just the intermixed inbox again.
  expanded: null,

  // bundleKey -> count of rows seen from the top (the high-water mark).
  seen: {},

  // INV-17/INV-18: a one-tap, read-only, non-persistent glance at everything derived.
  reveal: false,

  // { token, bundle, count, expiresAt } while a sweep is undoable (INV-12).
  undo: null,

  undoWindowSeconds: 10,

  setAccount: (accountId) => {
    if (get().accountId === accountId) return;
    // Seen marks are per-session and per-bundle; switching accounts invalidates them.
    set({ accountId, bundles: [], seen: {}, expanded: null, reveal: false });
  },

  fetch: async () => {
    const { accountId } = get();
    if (!accountId) return;
    set({ loading: true, error: null });
    try {
      const data = await bundlesApi.list(accountId);
      set({
        bundles: data.bundles || [],
        undoWindowSeconds: data.undoWindowSeconds || 10,
        loading: false,
      });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  toggleExpanded: (key) => set((s) => ({
    expanded: s.expanded === key ? null : key,
    // Opening a bundle starts its seen mark from nothing. Re-opening does not inherit the previous
    // session's mark: the user is looking at a different set of messages now.
    seen: s.expanded === key ? s.seen : { ...s.seen, [key]: 0 },
  })),

  // Record that row `index` (0-based) has been on screen.
  markSeen: (key, index) => set((s) => ({ seen: { ...s.seen, [key]: advanceSeen(s.seen[key], index) } })),

  // Move the boundary by hand (INV-9c).
  setSeen: (key, count) => set((s) => {
    const bundle = s.bundles.find((b) => b.key === key);
    return { seen: { ...s.seen, [key]: clampSeen(count, bundle ? bundle.messages.length : 0) } };
  }),

  seenIdsFor: (key) => seenIdsFor(get().bundles, get().seen, key),

  sweepableFor: (key) => sweepableFor(get().bundles, get().seen, key),

  sweep: async (key) => {
    const { accountId, seenIdsFor } = get();
    const seenIds = seenIdsFor(key);
    if (!accountId) return null;
    try {
      const result = await bundlesApi.sweep(accountId, key, seenIds);
      set((s) => ({
        undo: result.undoToken
          ? {
            token: result.undoToken,
            bundle: bundleLabelOf(s.bundles, key),
            count: result.swept,
            windowMs: (result.undoWindowSeconds || 10) * 1000,
            expiresAt: Date.now() + (result.undoWindowSeconds || 10) * 1000,
          }
          : s.undo,
        // Collapse the swept bundle and reset its mark: what is left is what survived, and the user
        // has not seen it in this session.
        expanded: null,
        seen: { ...s.seen, [key]: 0 },
      }));
      await get().fetch();
      refreshMessageList();
      return result;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  undoSweep: async () => {
    const { accountId, undo } = get();
    if (!accountId || !undo) return;
    set({ undo: null });
    try {
      await bundlesApi.undo(accountId, undo.token);
      await get().fetch();
      refreshMessageList();
    } catch (err) {
      set({ error: err.message });
    }
  },

  dismissUndo: () => set({ undo: null }),

  toggleKeep: async (key, message) => {
    const { accountId } = get();
    if (!accountId) return;
    const next = !message.keepUntilSweep;
    // Optimistic: the gesture must feel free, or it stops being cheap enough to use casually
    // (INV-10a's whole argument for decay).
    set((s) => ({
      bundles: s.bundles.map((b) => (b.key !== key ? b : {
        ...b,
        messages: b.messages.map((m) => (m.id === message.id ? { ...m, keepUntilSweep: next ? 1 : null } : m)),
      })),
    }));
    try {
      await bundlesApi.keep(accountId, message.id, next);
      await get().fetch();
    } catch (err) {
      set({ error: err.message });
      await get().fetch();
    }
  },

  setReveal: (reveal) => set({ reveal }),
}));
