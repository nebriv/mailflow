// Reading bundles, and executing a sweep (INV-5, INV-6, INV-9, INV-11, INV-12).
//
// ── The storage model, and why the count cannot drift ───────────────────────────────────────────
// A bundled message gets a COPY in its bundle's folder (INV-19: membership is a real IMAP folder)
// and KEEPS its INBOX copy. So a message has two states, both readable straight off IMAP:
//
//   in the bundle   copy in Bundles/X  AND  copy in INBOX     → renders inside the bundle row
//   in the feed     copy in Bundles/X  only                   → browsable, out of the inbox
//
// Sweeping removes the INBOX copy. Nothing is deleted and nothing is moved to Archive: the message
// stays exactly where the reading feed reads from (INV-11 — sweep files, never deletes; swept mail
// moves to the category's reading feed and remains browsable).
//
// The payoff is that INV-5 is structural rather than computed. "What arrived since the last sweep"
// is precisely "what still has an INBOX copy", so the number on the bundle row cannot drift out of
// sync with the cursor — there is no subtraction anywhere to get wrong. §1.1's failure (a count
// that accumulates into 332 and stops being a triage unit) is not prevented by careful arithmetic
// here; it is unrepresentable.
//
// It also makes undo exactly symmetric: sweep removes the INBOX copy, undo copies it back from the
// bundle folder, which is still there because sweep never touched it.
//
// ── What this module deliberately does NOT read ─────────────────────────────────────────────────
// listThreadHeadsByLabels returns per-label `total` and `unread`, which are LIFETIME counts. INV-5
// forbids displaying them and they are never returned to the client — the count that reaches the UI
// is the length of the in-inbox member list.

import {
  logger, broadcast, storage, applyLabel, removeLabel, resolveLabelCopyUid,
  ensureLabelFolders, listThreadHeadsByLabels, resolveAllDraftsPaths, setMessageAnnotation,
  getMessageAnnotations,
} from '../api.js';
import { PLUGIN_ID } from './constants.js';
import { config } from './bundlesConfig.js';
import { BUNDLE_ORDER, bundleFolder, allBundleFolders, isBundleKey } from './taxonomy.js';
import { advanceCursor, readConfig, readCursor, writeConfig } from './cursor.js';
import { planSweep, keepUntilFor } from './retention.js';

// Per-bundle read ceiling. Well above anything the design should ever produce — S-8 targets a
// maximum displayed count of 25 and sweeping happens ≥5 days a week — but finite, so a runaway
// classifier cannot turn one inbox open into an unbounded query.
const MEMBER_LIMIT = 500;

// The realtime event this plugin broadcasts to its own client. Core never interprets it; the
// frontend plugin registers a handler for exactly this type.
export const BUNDLES_EVENT = 'bundles_updated';

// Read every bundle for an account.
//
// Returns `{ [bundleKey]: { members, feed } }` where `members` are the rows still in INBOX (what
// the bundle row shows and what a sweep can clear) and `feed` is every row in the folder (the
// reading feed, Phase 4). Both are newest-first.
export async function readBundles(accountId) {
  const draftFolders = await resolveAllDraftsPaths(accountId).catch(() => []);
  const rows = await listThreadHeadsByLabels(accountId, {
    labels: BUNDLE_ORDER,
    labelFolders: BUNDLE_ORDER.map(bundleFolder),
    draftFolders: draftFolders || [],
    limit: MEMBER_LIMIT,
    unionLabels: [],
  });

  const out = {};
  for (const key of BUNDLE_ORDER) out[key] = { members: [], feed: [] };
  for (const row of rows) {
    const bucket = out[row.state];
    if (!bucket) continue;
    bucket.feed.push(row);
    // `in_inbox` is the thread-level fact the read capability already computes: the thread still
    // has a live INBOX copy, i.e. it has not been swept.
    if (row.in_inbox) bucket.members.push(row);
  }
  return out;
}

// Ensure the four bundle folders exist. Called once per account when the plugin is first enabled
// and again on the sync tick, so a folder deleted in another client comes back.
export async function ensureBundleFolders(account) {
  return ensureLabelFolders(account, allBundleFolders());
}

// File a classified message into its bundle folder, and record why on the message itself.
//
// The annotation is not the source of truth for membership — the folder copy is (INV-19). It
// records the classifier's REASON, which is what makes a misfiling diagnosable after the fact
// rather than a mystery, and it carries the Keep tier's expiry.
export async function fileIntoBundle(account, message, bundleKey, reason) {
  if (!isBundleKey(bundleKey)) return { filed: false };
  const folder = bundleFolder(bundleKey);
  const result = await applyLabel(account, message, folder);
  await setMessageAnnotation(account.id, message.id, PLUGIN_ID, {
    bundle: bundleKey,
    reason,
    classifiedAt: new Date().toISOString(),
  });
  return { filed: result.applied !== false, folder };
}

// Execute a sweep.
//
// `seenIds` is the client's explicit list of message ids above its scroll high-water mark. The
// server does not infer it, widen it, or second-guess it (INV-9d) — it intersects it with current
// membership and subtracts the surviving tiers. That is the whole reason no confirmation dialog is
// needed (INV-9, S-3a): the request states its scope, and so does the response.
export async function sweepBundle(account, bundleKey, seenIds) {
  if (!isBundleKey(bundleKey)) return { error: 'unknown-bundle' };
  const accountId = account.id;
  const cfg = await readConfig(accountId);
  const cursor = readCursor(cfg, bundleKey);

  const bundles = await readBundles(accountId);
  const members = bundles[bundleKey]?.members || [];
  const annotations = await getMessageAnnotations(accountId, members.map((m) => m.id), PLUGIN_ID);

  const plan = planSweep({ members, seenIds, annotations, cursor });

  const swept = [];
  for (const row of plan.sweep) {
    try {
      // Remove the INBOX copy only. The bundle-folder copy — the reading feed — is untouched.
      const res = await removeLabel({
        account_id: accountId, uid: row.uid, folder: row.folder, message_id: row.message_id,
      }, 'INBOX');
      if (res.removed) swept.push({ messageId: row.message_id, id: row.id });
    } catch (err) {
      // One message failing must not abort the sweep: a partial sweep is recoverable (the rest
      // stay in the bundle), an aborted one leaves the user unsure what happened.
      logger.warn(`[bundles] sweep failed for ${row.message_id}: ${err.message}`);
    }
  }

  const next = advanceCursor(cfg, bundleKey, new Date());
  await writeConfig(accountId, next);

  const undoToken = swept.length ? await recordUndo(account, bundleKey, swept) : null;
  broadcast({ type: BUNDLES_EVENT, accountId, bundle: bundleKey }, account.user_id);

  return {
    bundle: bundleKey,
    swept: swept.length,
    survivors: plan.survivors.map((s) => ({ id: s.row.id, reason: s.reason })),
    unseen: plan.unseen.length,
    undoToken,
    undoWindowSeconds: config.UNDO_WINDOW_SECONDS,
    cursor: readCursor(next, bundleKey),
  };
}

// ── Undo (INV-12) ───────────────────────────────────────────────────────────────────────────────
// Every sweep is undoable for at least 10 seconds through a non-blocking toast. The record is the
// list of RFC Message-IDs whose INBOX copy was removed; undo copies each back from the bundle
// folder, which sweep left in place. Nothing here needs the original uid: the bundle copy is
// resolved fresh at redemption time, so undo survives a sync that renumbered uids in between.

const undoKey = (accountId, token) => `undo:${accountId}:${token}`;

// A token that is unguessable enough to not collide and is never used for authorization — the undo
// route independently checks that the caller owns the account.
const newToken = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function recordUndo(account, bundleKey, swept) {
  const token = newToken();
  await storage.put(PLUGIN_ID, undoKey(account.id, token), {
    value: { bundle: bundleKey, at: new Date().toISOString(), messageIds: swept.map((s) => s.messageId) },
    ownerId: account.user_id || null,
  });
  return token;
}

// Whether an undo record is still inside its window. Exported for tests.
export function isUndoable(record, now = Date.now(), windowSeconds = config.UNDO_WINDOW_SECONDS) {
  const at = Date.parse(record?.at || '');
  if (!Number.isFinite(at)) return false;
  return now - at <= windowSeconds * 1000;
}

export async function undoSweep(account, token) {
  const accountId = account.id;
  const rec = await storage.getValue(PLUGIN_ID, undoKey(accountId, token));
  const record = rec?.value;
  if (!record) return { error: 'unknown-token' };
  if (!isUndoable(record)) {
    await storage.del(PLUGIN_ID, undoKey(accountId, token));
    return { error: 'expired' };
  }

  const folder = bundleFolder(record.bundle);
  let restored = 0;
  for (const messageId of record.messageIds || []) {
    try {
      // Resolve the bundle-folder copy fresh, then copy it back into INBOX — the exact inverse of
      // the sweep, using the copy sweep deliberately did not touch.
      const uid = await resolveLabelCopyUid({ account_id: accountId, message_id: messageId, folder: null, uid: null }, folder);
      if (uid == null) continue;
      const res = await applyLabel(account, { uid, folder }, 'INBOX');
      if (res.applied !== false) restored += 1;
    } catch (err) {
      logger.warn(`[bundles] undo failed for ${messageId}: ${err.message}`);
    }
  }

  await storage.del(PLUGIN_ID, undoKey(accountId, token));

  // Undo restores the messages but deliberately does NOT rewind the sweep counter. Rewinding would
  // resurrect Keeps that decayed during the sweep, so an undo would silently change retention
  // state; leaving the counter costs one sweep of Keep lifetime and keeps decay monotonic.
  broadcast({ type: BUNDLES_EVENT, accountId, bundle: record.bundle }, account.user_id);
  return { bundle: record.bundle, restored };
}

// ── Keep (INV-10b) ──────────────────────────────────────────────────────────────────────────────
// Reachable in one gesture from the bundle list without opening the message, and reversible by the
// same gesture. The route is the gesture's server half; toggling writes the expiry or clears it.
export async function setKeep(account, messageId, on) {
  const cfg = await readConfig(account.id);
  const anns = await getMessageAnnotations(account.id, [messageId], PLUGIN_ID);
  const ann = anns[messageId];
  const cursor = readCursor(cfg, ann?.bundle);
  await setMessageAnnotation(account.id, messageId, PLUGIN_ID, {
    keepUntilSweep: on ? keepUntilFor(cursor) : null,
  });
  broadcast({ type: BUNDLES_EVENT, accountId: account.id, bundle: ann?.bundle || null }, account.user_id);
  return { messageId, keep: on, until: on ? keepUntilFor(cursor) : null };
}

export const __testing = { undoKey, MEMBER_LIMIT };
