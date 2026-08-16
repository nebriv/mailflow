// HTTP surface for the bundles plugin. Mounted by the platform at /api/bundles.
//
// Every route is account-scoped and re-establishes ownership through getOwnedAccount before doing
// anything — the session says who is asking, the account id says what they are asking about, and
// the two are never assumed to match.
//
// What is NOT here matters as much as what is. There is no settings endpoint, no rules endpoint and
// no category editor (INV-21, AV-8): the tuning constants are environment variables and the
// classifier's policy is code. There is no folder-picker endpoint either (INV-20).

import { Router } from 'express';
import { requireAuth, getOwnedAccount, isPluginActivated } from '../api.js';
import { PLUGIN_ID } from './constants.js';
import { config } from './bundlesConfig.js';
import { BUNDLE_ORDER, bundleLabel } from './taxonomy.js';
import { readConfig, readCursor } from './cursor.js';
import { readBundles, sweepBundle, undoSweep, setKeep } from './sweep.js';
import { planSweep, sweepLabel } from './retention.js';
import { getMessageAnnotations } from '../api.js';
import { migrateToZero } from './hooks.js';
import { dryRunReport } from './dryRun.js';

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve and authorize the account for a request. Returns the account, or sends the response and
// returns null — callers just `if (!account) return;`.
async function resolveAccount(req, res, accountId) {
  if (!accountId || !UUID_RE.test(accountId)) {
    res.status(400).json({ error: 'Invalid account id' });
    return null;
  }
  if (!(await isPluginActivated(req.session.userId, PLUGIN_ID))) {
    res.status(403).json({ error: 'Bundles is not activated' });
    return null;
  }
  const account = await getOwnedAccount(req.session.userId, accountId);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return null;
  }
  return account;
}

// Shape a thread head for the client. Deliberately narrow: the list needs a sender, a subject, a
// date and the two state flags, and nothing else. Note there is no unread count and no lifetime
// total anywhere in this payload (INV-5, INV-7, AV-2).
const toRow = (row, annotation) => ({
  id: row.id,
  threadKey: row.thread_key,
  messageId: row.message_id,
  folder: row.folder,
  uid: row.uid,
  subject: row.subject,
  fromName: row.from_name,
  fromEmail: row.from_email,
  snippet: row.snippet,
  date: row.date,
  // Pin is the star (see retention.js). Surfaced under both names: `pinned` is the concept this
  // build talks about, `isStarred` is what the rest of the app calls the same bit.
  pinned: row.is_starred === true,
  isStarred: row.is_starred === true,
  unread: row.thread_unread === true,
  keepUntilSweep: Number.isInteger(annotation?.keepUntilSweep) ? annotation.keepUntilSweep : null,
  reason: annotation?.reason || null,
});

// Strip the unread flag for reading-feed rows (INV-7).
function omitUnread(row) {
  const out = { ...row };
  delete out.unread;
  return out;
}

// GET /api/bundles?accountId= — every bundle's current state.
//
// INV-6: a bundle with nothing after its cursor renders no row. That is enforced here by returning
// `empty: true` and a zero count rather than by hoping the client hides it — a bundle that is
// always present cannot be cleared, so there would be nothing to clear and no zero state (§1.4).
router.get('/', async (req, res) => {
  const account = await resolveAccount(req, res, req.query.accountId);
  if (!account) return;

  const cfg = await readConfig(account.id);
  const bundles = await readBundles(account.id);

  const allIds = Object.values(bundles).flatMap((b) => b.members.map((m) => m.id));
  const annotations = await getMessageAnnotations(account.id, allIds, PLUGIN_ID);

  const out = BUNDLE_ORDER.map((key) => {
    const members = bundles[key]?.members || [];
    const cursor = readCursor(cfg, key);
    return {
      key,
      label: bundleLabel(key),
      // The count is the length of the member list — what has arrived since the last sweep. The
      // lifetime totals the read capability also returns are never forwarded (INV-5).
      count: members.length,
      empty: members.length === 0,
      lastSweptAt: cursor.lastSweptAt,
      sweepCount: cursor.sweepCount,
      messages: members.map((m) => toRow(m, annotations[m.id])),
    };
  });

  res.json({
    accountId: account.id,
    bundles: out,
    rowBudget: config.ROW_BUDGET,
    undoWindowSeconds: config.UNDO_WINDOW_SECONDS,
    // Whether MailFlow's own categorizer is running for this account.
    //
    // It is OFF by default (email_accounts.categorization_enabled, migration 0023), and when it is
    // off the `category` column is NULL for every message. The classifier still works — it falls
    // back to the bulk headers — but everything bulk then lands in Newsletters, and Promotions,
    // Notifications and Social stay permanently empty. That reads like a broken classifier when it
    // is really an unset toggle, so the state is reported rather than left to be guessed.
    categorizationEnabled: account.categorization_enabled === true,
    // Whether the plugin is currently forbidden from touching the mail server. The client renders
    // the dry-run report instead of bundle rows when this is set — and since a dry run produces no
    // folder copies, `bundles` above is empty, which without this flag would be indistinguishable
    // from "nothing to bundle".
    dryRun: config.DRY_RUN,
  });
});

// GET /api/bundles/dry-run?accountId= — what the classifier WOULD do, having done nothing.
//
// The GATE 1 instrument. Available whether or not the dry run is active (the response says which),
// so it doubles as an audit of live classification.
router.get('/dry-run', async (req, res) => {
  const account = await resolveAccount(req, res, req.query.accountId);
  if (!account) return;
  res.json(await dryRunReport(account));
});

// GET /api/bundles/feed/:key?accountId= — the reading feed for one category (Phase 4).
//
// Reverse chronological, opened deliberately, and carrying no count, badge or bold state (INV-7).
// `unread` is intentionally omitted from these rows: the feed is for reading, and an unread marker
// would turn it back into a queue.
router.get('/feed/:key', async (req, res) => {
  const account = await resolveAccount(req, res, req.query.accountId);
  if (!account) return;
  const key = req.params.key;
  if (!BUNDLE_ORDER.includes(key)) return res.status(404).json({ error: 'Unknown bundle' });

  const bundles = await readBundles(account.id);
  const feed = bundles[key]?.feed || [];
  const annotations = await getMessageAnnotations(account.id, feed.map((m) => m.id), PLUGIN_ID);

  res.json({
    key,
    label: bundleLabel(key),
    // `unread` is dropped rather than merely ignored by the client: the feed carries no count,
    // badge or bold state (INV-7), and an unread marker is what would turn it back into a queue.
    messages: feed.map((m) => omitUnread(toRow(m, annotations[m.id]))),
  });
});

// GET /api/bundles/:key/plan?accountId=&seenIds= — what a sweep WOULD do.
//
// Exists so the sweep control's label and the sweep itself are computed by the same code on the
// same inputs (INV-9b). A label produced independently of the action is how a control comes to
// overstate its scope, which is the confirmation-dialog problem (§1.3) reintroduced.
router.get('/:key/plan', async (req, res) => {
  const account = await resolveAccount(req, res, req.query.accountId);
  if (!account) return;
  const key = req.params.key;
  if (!BUNDLE_ORDER.includes(key)) return res.status(404).json({ error: 'Unknown bundle' });

  const seenIds = String(req.query.seenIds || '').split(',').filter(Boolean);
  const cfg = await readConfig(account.id);
  const bundles = await readBundles(account.id);
  const members = bundles[key]?.members || [];
  const annotations = await getMessageAnnotations(account.id, members.map((m) => m.id), PLUGIN_ID);
  const plan = planSweep({ members, seenIds, annotations, cursor: readCursor(cfg, key) });

  res.json({
    key,
    label: sweepLabel(plan),
    sweepCount: plan.sweep.length,
    survivors: plan.survivors.map((s) => ({ id: s.row.id, reason: s.reason })),
    unseen: plan.unseen.length,
  });
});

// POST /api/bundles/:key/sweep { accountId, seenIds } — one tap, no confirmation (INV-9).
//
// `seenIds` is required and may be empty, but is never defaulted to "everything". Defaulting would
// make an omitted field clear the whole bundle, which is exactly the unsafe sweep Spark's
// confirmation dialog exists to guard (§1.3) — the dialog is a symptom to design out, and the way
// to design it out is to make the unsafe operation unrepresentable.
router.post('/:key/sweep', async (req, res) => {
  const { accountId, seenIds } = req.body || {};
  const account = await resolveAccount(req, res, accountId);
  if (!account) return;
  const key = req.params.key;
  if (!BUNDLE_ORDER.includes(key)) return res.status(404).json({ error: 'Unknown bundle' });
  if (!Array.isArray(seenIds)) return res.status(400).json({ error: 'seenIds (array) is required' });

  const result = await sweepBundle(account, key, seenIds);
  // 409, not 400: the request is well-formed and would be honoured but for the server's current
  // mode, and the client shows that as state rather than as a malformed-request error.
  if (result.error === 'dry-run') return res.status(409).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// POST /api/bundles/undo { accountId, token } — INV-12.
router.post('/undo', async (req, res) => {
  const { accountId, token } = req.body || {};
  const account = await resolveAccount(req, res, accountId);
  if (!account) return;
  if (typeof token !== 'string' || !token) return res.status(400).json({ error: 'token is required' });

  const result = await undoSweep(account, token);
  if (result.error === 'dry-run') return res.status(409).json(result);
  if (result.error === 'unknown-token') return res.status(404).json(result);
  if (result.error) return res.status(410).json(result);
  res.json(result);
});

// POST /api/bundles/keep { accountId, messageId, keep } — INV-10b, one gesture, reversible by the
// same gesture.
router.post('/keep', async (req, res) => {
  const { accountId, messageId, keep } = req.body || {};
  const account = await resolveAccount(req, res, accountId);
  if (!account) return;
  if (!messageId || !UUID_RE.test(messageId)) return res.status(400).json({ error: 'Invalid message id' });
  if (typeof keep !== 'boolean') return res.status(400).json({ error: 'keep (boolean) is required' });

  res.json(await setKeep(account, messageId, keep));
});

// POST /api/bundles/migrate { accountId } — Phase 3's one-time start-from-zero migration.
//
// Idempotent: it records `migratedAt` and refuses to run twice, so it cannot be used to
// accidentally clear a bundle a second time.
router.post('/migrate', async (req, res) => {
  const account = await resolveAccount(req, res, req.body?.accountId);
  if (!account) return;
  res.json(await migrateToZero(account));
});

export default router;
