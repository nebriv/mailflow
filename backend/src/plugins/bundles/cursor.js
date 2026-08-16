// Per-account state: the sweep cursor (Phase 3).
//
// Everything here lives in the generic `plugin_account_config` store (INV-23 — no migrations, no
// plugin-specific columns). The blob is opaque to core; this module owns its shape.
//
// Note what is NOT here. There is no per-account enable flag: whether the plugin runs for an
// account is core's own per-user activation (Settings → Plugins), so this build adds no settings
// surface of its own (INV-21, AV-8). And there is no override list: it comes from the
// BUNDLES_NEVER_BUNDLE environment variable (INV-21a), so there is exactly one source of truth for
// it rather than a stored copy that can disagree with the environment.
//
// ── Why a cursor exists at all ──────────────────────────────────────────────────────────────────
// INV-5: a bundle shows only messages that arrived after its sweep cursor, and lifetime totals are
// never displayed. §1.1 is the failure being corrected — Spark showed 332, which is a backlog
// already lost, and the rational response to a backlog already lost is to stop looking at it.
//
// In this build the count is structural rather than computed: sweeping removes a message's INBOX
// copy, so what remains in INBOX with a bundle label is exactly what has arrived since the last
// sweep. The cursor cannot drift out of sync with the count, because the count is not derived from
// the cursor. What the cursor is actually FOR:
//
//   lastSweptAt   — display ("swept 2h ago"), the auto-file window (NTH-2), and the Phase 3
//                   one-time migration that starts the client from zero rather than importing a
//                   498-message backlog.
//   sweepCount    — the clock Keep decays against (INV-10a). Decay is counted in sweeps, not days,
//                   because "survives 3 sweeps" is a promise about the user's own actions and is
//                   therefore predictable in a way "3 days" is not.

import { getAccountConfig, setAccountConfig } from '../api.js';
import { PLUGIN_ID } from './constants.js';
import { BUNDLE_ORDER, isBundleKey } from './taxonomy.js';

export const emptyCursor = () => ({ lastSweptAt: null, sweepCount: 0 });

// Normalise a stored blob into the full shape, so every reader can assume every field exists.
// Unknown bundle keys are dropped rather than preserved: they can only come from a taxonomy that no
// longer exists, and keeping them would let a removed bundle's cursor resurrect it.
export function normalizeConfig(raw) {
  const cursors = {};
  for (const key of BUNDLE_ORDER) {
    const stored = raw?.cursors?.[key];
    cursors[key] = {
      lastSweptAt: typeof stored?.lastSweptAt === 'string' ? stored.lastSweptAt : null,
      sweepCount: Number.isInteger(stored?.sweepCount) && stored.sweepCount >= 0 ? stored.sweepCount : 0,
    };
  }
  return {
    cursors,
    // Set by the Phase 3 one-time migration so it never runs twice.
    migratedAt: typeof raw?.migratedAt === 'string' ? raw.migratedAt : null,
  };
}

export async function readConfig(accountId) {
  return normalizeConfig(await getAccountConfig(PLUGIN_ID, accountId));
}

export async function writeConfig(accountId, config) {
  await setAccountConfig(PLUGIN_ID, accountId, normalizeConfig(config));
}

// Advance one bundle's cursor. Pure — returns the next config, so the caller decides when to
// persist and the transition is testable without a database.
export function advanceCursor(config, bundleKey, at = new Date()) {
  if (!isBundleKey(bundleKey)) return config;
  const current = config.cursors[bundleKey] || emptyCursor();
  return {
    ...config,
    cursors: {
      ...config.cursors,
      [bundleKey]: {
        lastSweptAt: at.toISOString(),
        sweepCount: current.sweepCount + 1,
      },
    },
  };
}

export const readCursor = (config, bundleKey) => config?.cursors?.[bundleKey] || emptyCursor();
