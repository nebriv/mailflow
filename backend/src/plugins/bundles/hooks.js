// Sync-engine hook handlers (v3.0 plugin platform).
//
// Core owns the mechanism — when a sync batch lands, when mail is sent, when the periodic tick
// fires — and the plugin owns the policy. Handlers must never throw into core (the registry
// swallows per-plugin errors), but they still guard internally so a transient failure degrades to
// "nothing happened this pass" rather than a noisy rejection that the next tick has to clean up.

import {
  logger, isPluginActivatedForAccount, listUserAccounts, loadOwnedMessage,
  getThreadKeysForMessageIdHeaders, getMessagesByThreadKeys, getMessageAnnotations, broadcast,
  removeLabel,
} from '../api.js';
import { PLUGIN_ID } from './constants.js';
import { config } from './bundlesConfig.js';
import { classifyMessage, isBundled } from './classifier.js';
import { getExemptions, ensureNeverBundleSet, noteCorrespondent, sentFolderPaths } from './neverBundle.js';
import { readBundles, ensureBundleFolders, fileIntoBundle, BUNDLES_EVENT } from './sweep.js';
import { readConfig, readCursor, writeConfig } from './cursor.js';
import { isKeepActive } from './retention.js';
import { allBundleFolders } from './taxonomy.js';
import { normalizeAddress } from './signals.js';

// Per-hook activation gate. Core skips collecting candidates entirely for accounts where the plugin
// is off, so a non-bundles account issues zero extra queries.
export const bundlesEnabledForAccount = async ({ account }) =>
  !!account?.id && isPluginActivatedForAccount(PLUGIN_ID, account.id);

// runHook('inboxIngest'): core hands over the ids this sync newly inserted into INBOX plus the ids
// its rules genuinely deleted. Classify each arrival and file the bundled ones.
//
// This is the only place classification happens, which is what makes "a sender is classified once"
// true in practice: a message is classified when it arrives and never again. The verdict is
// persisted as an annotation and the membership as a folder copy, so every later read is a lookup.
export async function inboxIngest({ account, newInboxIds, deletedIds }) {
  const removed = deletedIds instanceof Set ? deletedIds : new Set(deletedIds || []);
  const ids = (newInboxIds || []).filter((id) => !removed.has(id));
  if (!ids.length || !account?.id) return;

  try {
    await ensureNeverBundleSet(account);
    const exemptions = await getExemptions(account, config.NEVER_BUNDLE);
    // Per-batch sender cache. A morning's mail is dominated by repeat senders, so this collapses
    // most of the batch to a map lookup.
    const cache = new Map();
    let filed = 0;

    for (const id of ids) {
      try {
        const row = await loadOwnedMessage(account.user_id, id);
        if (!row) continue;
        const verdict = classifyMessage(row, exemptions, cache);
        if (!isBundled(verdict)) continue;
        await fileIntoBundle(account, row, verdict.bundle, verdict.reason);
        filed += 1;
      } catch (err) {
        // One message failing to file is a row left loose — the cheap failure (INV-2). Never let it
        // abort the batch.
        logger.warn(`[bundles] classify/file failed for ${id}: ${err.message}`);
      }
    }

    if (filed) broadcast({ type: BUNDLES_EVENT, accountId: account.id, bundle: null }, account.user_id);
  } catch (err) {
    logger.warn(`[bundles] inboxIngest skipped for ${account.id}: ${err.message}`);
  }
}

// runHook('onSentMessage'): the client sent something. Core passes the RFC Message-ID of the sent
// message, not its recipients, so the correspondent is recovered the same way the never-bundle set
// is derived — through the thread. Anyone who wrote in this thread is now someone the client has
// replied to, and is exempt from their very next inbound message rather than up to six hours later.
export async function onSentMessage({ account, messageId }) {
  if (!account?.id || !messageId) return;
  try {
    const threadKeys = await getThreadKeysForMessageIdHeaders(account.id, [messageId]);
    if (!threadKeys.length) return;
    const messages = await getMessagesByThreadKeys(account.id, threadKeys);
    const sent = new Set(sentFolderPaths(account));
    for (const row of messages) {
      if (sent.has(row.folder)) continue;
      const addr = normalizeAddress(row.from_email);
      if (addr) await noteCorrespondent(account, addr);
    }
  } catch (err) {
    logger.debug(`[bundles] onSentMessage skipped for ${account.id}: ${err.message}`);
  }
}

// runHook('onPluginActivationChanged'): the user toggled the plugin. On activation, make sure the
// four bundle folders exist so the first sync has somewhere to file into.
export async function onPluginActivationChanged({ userId, pluginId, activated }) {
  if (pluginId !== PLUGIN_ID || !activated || !userId) return;
  try {
    for (const account of await listUserAccounts(userId)) {
      if (account.enabled === false) continue;
      await ensureBundleFolders(account).catch(() => {});
    }
  } catch (err) {
    logger.warn(`[bundles] activation setup failed for ${userId}: ${err.message}`);
  }
}

// collectHook('relocateExemptFolders'): a bundled message intentionally lives as sibling rows in
// INBOX and its bundle folder, so the sync move-detector must not collapse them into one.
export const relocateExemptFolders = async ({ account }) => {
  if (!(await bundlesEnabledForAccount({ account }))) return [];
  return allBundleFolders();
};

// ── The periodic tick ───────────────────────────────────────────────────────────────────────────
// Slower than core's INBOX cadence on purpose: nothing here is user-visible in the moment.
export const TICK_INTERVAL_MS = 15 * 60 * 1000;

export async function bundlesSyncTick({ account }) {
  if (!account?.id) return;
  try {
    await ensureBundleFolders(account).catch(() => {});
    await ensureNeverBundleSet(account);
    await autoFileAged(account);
  } catch (err) {
    logger.warn(`[bundles] tick failed for ${account.id}: ${err.message}`);
  }
}

// NTH-2 — auto-file on age, so a category clears itself without being asked.
//
// This is what stops the tail below the seen line growing without limit, which is why
// AUTOFILE_AGE_DAYS must never be unbounded (INV-21b). It respects exactly the same tiers a manual
// sweep does: pinned mail and active Keeps are never auto-filed (INV-13, INV-14). It deliberately
// does NOT advance the cursor — nothing the user did happened, so the sweep counter (and therefore
// Keep decay) must not move.
export async function autoFileAged(account, now = Date.now()) {
  const cutoff = now - config.AUTOFILE_AGE_DAYS * 24 * 60 * 60 * 1000;
  const cfg = await readConfig(account.id);
  const bundles = await readBundles(account.id);
  let filed = 0;

  for (const [bundleKey, { members }] of Object.entries(bundles)) {
    const aged = members.filter((row) => {
      const at = row.date ? Date.parse(row.date) : NaN;
      return Number.isFinite(at) && at < cutoff;
    });
    if (!aged.length) continue;

    const annotations = await getMessageAnnotations(account.id, aged.map((m) => m.id), PLUGIN_ID);
    const cursor = readCursor(cfg, bundleKey);
    for (const row of aged) {
      if (row.is_starred === true) continue;
      if (isKeepActive(annotations[row.id], cursor)) continue;
      try {
        const res = await removeLabel({
          account_id: account.id, uid: row.uid, folder: row.folder, message_id: row.message_id,
        }, 'INBOX');
        if (res.removed) filed += 1;
      } catch (err) {
        logger.debug(`[bundles] auto-file failed for ${row.message_id}: ${err.message}`);
      }
    }
  }

  if (filed) {
    logger.info(`[bundles] auto-filed ${filed} aged messages for ${account.id}`);
    broadcast({ type: BUNDLES_EVENT, accountId: account.id, bundle: null }, account.user_id);
  }
  return filed;
}

// ── Phase 3's one-time migration ────────────────────────────────────────────────────────────────
// "Archive everything older than 7 days, set all cursors to now. Start from zero rather than
// importing the existing 498-message backlog." §1.1 is the reason: a bundle showing 14 invites a
// sweep, a bundle showing 332 is a backlog already lost. The build must not begin by recreating the
// number that caused the problem.
//
// Runs once per account, recorded by `migratedAt` in the account config.
export async function migrateToZero(account, now = () => new Date()) {
  const cfg = await readConfig(account.id);
  if (cfg.migratedAt) return { migrated: false, reason: 'already-migrated' };

  const filed = await autoFileAged(account, now().getTime());
  const at = now();
  const cursors = {};
  for (const key of Object.keys(cfg.cursors)) {
    cursors[key] = { lastSweptAt: at.toISOString(), sweepCount: cfg.cursors[key].sweepCount };
  }
  await writeConfig(account.id, { ...cfg, cursors, migratedAt: at.toISOString() });
  return { migrated: true, filed };
}
