// Bundles and Sweep — frontend registrations (v3.0 plugin platform).
//
// The frontend twin of backend/src/plugins/bundles. Imported for its side effects by
// plugins/index.js. Core carries no bundles-specific code: it exposes a slot and a list transform,
// and this file fills them.

import { useMemo } from 'react';
import { registerRuntime, registerSlot, registerListTransform } from '../registry.js';
import { registerWsHandler, registerReconnectHandler } from '../events.js';
import { useBundlesStore } from './bundlesStore.js';
import { bundledMessageIds, visibleBundles } from './bundleSelectors.js';
import BundlesRuntime from './BundlesRuntime.jsx';
import BundleRows from './BundleRows.jsx';

const PLUGIN_ID = 'bundles';

// Headless runtime: owns the bundles fetch and the account/folder scoping.
registerRuntime({ pluginId: PLUGIN_ID, component: BundlesRuntime });

// The bundle rows themselves, inline at the top of the message list — grouped, but still in the
// same list (§2.2).
registerSlot('message-list-top', {
  pluginId: PLUGIN_ID,
  isActive: (ctx) => ctx.folder === 'INBOX' && !ctx.searching,
  render: () => <BundleRows />,
});

// The list transform: bundled messages must not ALSO render as individual rows, or the bundle saves
// no rows at all and INV-8's budget is spent twice over.
//
// Hiding them at core's single `displayMessages` seam means every downstream consumer agrees at
// once — date groups, select-all, keyboard navigation, the empty state. A filter applied only at
// render time would leave keyboard nav walking through rows nobody can see.
registerListTransform({
  pluginId: PLUGIN_ID,
  useTransform: (ctx) => {
    // Hooks first, unconditionally — the activation gate is applied by the caller, and an early
    // return before a hook would change React's hook count when the plugin is toggled.
    const bundles = useBundlesStore((s) => s.bundles);
    const inScope = ctx.folder === 'INBOX' && !ctx.searching;

    return useMemo(() => {
      if (!inScope) return null;
      const hidden = bundledMessageIds(bundles);
      if (!hidden.size) return null;
      return {
        // Core's messages are INBOX rows; a bundled message is one whose id is inside a bundle.
        hide: (message) => hidden.has(message.id),
        // How many rows render in their place, so an inbox of nothing but bundles is not mistaken
        // for an empty one.
        rowCount: visibleBundles(bundles).length,
      };
    }, [inScope, bundles]);
  },
});

// WS: the backend broadcasts when classification files new mail, when a sweep lands, or when the
// tick auto-files. Refetch when the event is for the account currently in scope.
registerWsHandler('bundles_updated', {
  pluginId: PLUGIN_ID,
  handler: (data) => {
    const { accountId, fetch } = useBundlesStore.getState();
    if (accountId && data.accountId === accountId) fetch();
  },
});

// Events fired during a socket outage are not buffered, so resync on reconnect.
registerReconnectHandler({
  pluginId: PLUGIN_ID,
  handler: () => {
    const { accountId, fetch } = useBundlesStore.getState();
    if (accountId) fetch();
  },
});
