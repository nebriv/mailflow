// The never-bundle set (INV-4) — the IO half.
//
// "Every address ever replied to, recomputed on a schedule." This is the exemption list half of
// §2.1's governing principle: the classifier is a noise detector with an exemption list, not an
// importance ranker. It never asks whether a message matters — only whether this sender is someone
// the client has a correspondence with, in which case their mail is never bundled regardless of
// what headers it carries.
//
// The matching logic lives in exemptions.js (pure); this module scans, caches and patches.
//
// ── Deriving it without reading sent recipients ─────────────────────────────────────────────────
// The obvious implementation — read the To/Cc of every sent message — is not available: the plugin
// capability surface exposes getMessagesByThreadKeys, which returns thread_key/uid/folder/
// from_email/date/id, and no capability returns recipients. Rather than widen api.js (core diff,
// INV-22), the set is derived from THREAD PARTICIPATION, which the surface does expose:
//
//   1. getThreadKeysInFolders(accountId, sentPaths)   — every thread the client has sent into
//   2. getMessagesByThreadKeys(accountId, threadKeys) — every message in those threads
//   3. keep the from_email of the ones NOT in a Sent folder, minus the account's own addresses
//
// The result is every address that has written to the client in a thread the client also wrote in.
// It is arguably better than reading recipients: replying to a mailing-list post captures the
// person who posted, not the list.
//
// It also fails safe. If the Sent folder is unmapped or empty the set is empty, and an empty
// exemption list means the guard and the bulk signal alone decide — never that everything bundles.
//
// ── Precision, not recall ───────────────────────────────────────────────────────────────────────
// INV-2's asymmetry applies here too. Missing a correspondent bundles their mail once, which is the
// failure that destroys trust, so the derivation errs toward including addresses: it takes the
// whole thread, not just the message replied to, and does not try to exclude automated
// participants. Over-inclusion costs a row.

import {
  logger, storage, getThreadKeysInFolders, getMessagesByThreadKeys, getAccountAddresses,
} from '../api.js';
import { normalizeAddress } from './signals.js';
import { buildExemptions, correspondentsFromThreadMessages } from './exemptions.js';
import { PLUGIN_ID } from './constants.js';

// Recomputed on the sync tick, not per message — it is a full-mailbox scan. Six hours is chosen so
// the scan stays rare. A brand-new correspondent is not exposed in the meantime: replying to
// someone marks them immediately via `onSentMessage` (see hooks.js), which patches the cached set
// without a rescan.
export const REBUILD_INTERVAL_MS = 6 * 60 * 60 * 1000;

const cacheKey = (accountId) => `never-bundle:${accountId}`;

// Candidate Sent folder paths for an account. `folder_mappings.sent` is the mapping MailFlow
// resolves at account setup and is what the send path itself writes to (routes/send.js). The
// literal fallbacks cover an account whose mapping was never populated; they are matched exactly
// against folders that actually hold rows, so a name that does not exist costs nothing.
export function sentFolderPaths(account) {
  const mapped = account?.folder_mappings?.sent;
  const paths = mapped ? [mapped] : [];
  for (const fallback of ['Sent', 'INBOX.Sent', '[Gmail]/Sent Mail', 'Sent Items', 'Sent Messages']) {
    if (!paths.includes(fallback)) paths.push(fallback);
  }
  return paths;
}

async function readCached(accountId) {
  try {
    const rec = await storage.getValue(PLUGIN_ID, cacheKey(accountId));
    const addresses = Array.isArray(rec?.value?.addresses) ? rec.value.addresses : [];
    const rebuiltAt = rec?.value?.rebuiltAt || null;
    return { addresses, rebuiltAt };
  } catch {
    return { addresses: [], rebuiltAt: null };
  }
}

// Recompute the derived set for one account and cache it. Returns the address array.
export async function rebuildNeverBundleSet(account, now = () => new Date()) {
  const accountId = account?.id;
  if (!accountId) return [];
  const sentPaths = sentFolderPaths(account);
  try {
    const threadKeys = await getThreadKeysInFolders(accountId, sentPaths);
    const messages = threadKeys.length ? await getMessagesByThreadKeys(accountId, threadKeys) : [];
    const own = await getAccountAddresses(accountId);
    const addresses = correspondentsFromThreadMessages(messages, sentPaths, own);
    await storage.put(PLUGIN_ID, cacheKey(accountId), {
      value: { addresses, rebuiltAt: now().toISOString() },
      ownerId: account.user_id || null,
    });
    logger.info(`[bundles] never-bundle set for ${accountId}: ${addresses.length} correspondents`);
    return addresses;
  } catch (err) {
    // A failed rebuild must never bundle mail it would otherwise have exempted, so fall back to the
    // previously cached set rather than to nothing.
    logger.warn(`[bundles] never-bundle rebuild failed for ${accountId}: ${err.message}`);
    return (await readCached(accountId)).addresses;
  }
}

// Whether the cached set is old enough to rebuild.
export function isStale(rebuiltAt, now = Date.now()) {
  if (!rebuiltAt) return true;
  const at = Date.parse(rebuiltAt);
  return !Number.isFinite(at) || now - at >= REBUILD_INTERVAL_MS;
}

// Rebuild only if the cache is stale. Returns the effective address list.
export async function ensureNeverBundleSet(account) {
  const { addresses, rebuiltAt } = await readCached(account?.id);
  if (!isStale(rebuiltAt)) return addresses;
  return rebuildNeverBundleSet(account);
}

// Add one address to the cached set without a full rescan. Called when the client sends mail, so a
// brand-new correspondent is exempt from their very next inbound message rather than up to six
// hours later. Returns true when the address was newly added.
export async function noteCorrespondent(account, address) {
  const accountId = account?.id;
  const addr = normalizeAddress(address);
  if (!accountId || !addr) return false;
  const { addresses, rebuiltAt } = await readCached(accountId);
  if (addresses.includes(addr)) return false;
  await storage.put(PLUGIN_ID, cacheKey(accountId), {
    value: { addresses: [...addresses, addr].sort(), rebuiltAt },
    ownerId: account.user_id || null,
  });
  return true;
}

// The effective exemption matcher for an account: derived correspondents plus manual overrides.
export async function getExemptions(account, overrides = []) {
  if (!account?.id) return buildExemptions([], overrides);
  const { addresses } = await readCached(account.id);
  return buildExemptions(addresses, overrides);
}

export const __testing = { cacheKey, readCached };
