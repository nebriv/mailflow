// Bundles and Sweep plugin manifest (Tier-1, bundled).
//
// Inline collapsed bundles with a one-tap sweep, rebuilding the mechanics Google Inbox had and
// Spark copied only the appearance of. The design spec lives in docs/bundles-and-sweep/.
//
// The whole feature is inside this directory plus frontend/src/plugins/bundles/. Core's only
// knowledge of it is the two registration lines (loadPlugins.js, frontend plugins/index.js) and one
// conditional in MessageList.jsx — the fork-hygiene budget INV-22 caps at 50 lines of core diff.
import bundlesRoutes from './routes.js';
import {
  bundlesEnabledForAccount, inboxIngest, onSentMessage, onPluginActivationChanged,
  relocateExemptFolders, bundlesSyncTick, TICK_INTERVAL_MS,
} from './hooks.js';

export const bundlesPlugin = {
  id: 'bundles',
  name: 'Bundles and Sweep',
  version: '1.0.0',
  tier: 1,
  // Mounted at the /api/bundles subtree (not bare /api) so this router's requireAuth cannot
  // intercept the unauthenticated /api/health and /api/version probes — same reasoning as GTD.
  router: { base: '/api/bundles', handler: bundlesRoutes },
  hooks: {
    // The only place classification happens: core hands over the ids a sync newly inserted into
    // INBOX, and the plugin files the bundled ones. Gated per-hook so a non-bundles account issues
    // zero extra queries.
    inboxIngest: { handler: inboxIngest, isActive: bundlesEnabledForAccount },
    // A bundled message lives as sibling rows in INBOX and its bundle folder; the sync move-detector
    // must not collapse them. Self-gates internally.
    relocateExemptFolders,
    // Sending mail makes the recipient a correspondent, so their next inbound message is exempt
    // immediately rather than waiting for the next scheduled rebuild. Self-gates.
    onSentMessage: { handler: onSentMessage, isActive: bundlesEnabledForAccount },
    // Create the four bundle folders when the user first turns the plugin on.
    onPluginActivationChanged,
  },
  // Periodic background tick: keep the bundle folders present, refresh the derived never-bundle set
  // when it goes stale, and auto-file aged mail (NTH-2). Deliberately slow — none of it is
  // user-visible in the moment, and the never-bundle rebuild is a full-mailbox scan.
  sync: {
    intervalMs: TICK_INTERVAL_MS,
    isActive: bundlesEnabledForAccount,
    tick: bundlesSyncTick,
  },
};
