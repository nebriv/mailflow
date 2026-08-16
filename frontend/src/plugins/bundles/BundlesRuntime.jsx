import { useEffect } from 'react';
import { useStore } from '../../store/index.js';
import { useBundlesStore } from './bundlesStore.js';

// The plugin's headless runtime: the single owner of the bundles fetch.
//
// Mounted by <PluginRuntime/> only while the plugin is activated, so deactivating it tears down
// every effect here and the plugin stops doing anything at all.

export default function BundlesRuntime() {
  const selectedAccountId = useStore((s) => s.selectedAccountId);
  const selectedFolder = useStore((s) => s.selectedFolder);
  const setAccount = useBundlesStore((s) => s.setAccount);
  const fetch = useBundlesStore((s) => s.fetch);
  const setReveal = useBundlesStore((s) => s.setReveal);

  // Bundles are an INBOX surface. Everywhere else the mail is just mail.
  const active = !!selectedAccountId && selectedFolder === 'INBOX';

  useEffect(() => {
    setAccount(active ? selectedAccountId : null);
    if (active) fetch();
  }, [active, selectedAccountId, setAccount, fetch]);

  // INV-18: the reveal is non-persistent and reverts on leaving the screen. Changing folder or
  // account is leaving the screen.
  useEffect(() => { setReveal(false); }, [selectedAccountId, selectedFolder, setReveal]);

  // A sync that lands new mail changes what is in the bundles, and core already broadcasts a list
  // reload for it. Riding the same event keeps the bundle rows and the loose rows in step — they
  // are one list, so they must never refresh independently.
  useEffect(() => {
    if (!active) return undefined;
    const onRefresh = () => fetch();
    window.addEventListener('mailflow:refresh', onRefresh);
    return () => window.removeEventListener('mailflow:refresh', onRefresh);
  }, [active, fetch]);

  return null;
}
