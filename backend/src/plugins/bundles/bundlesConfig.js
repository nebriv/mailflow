// Tuning constants (INV-21, INV-21a, INV-21b).
//
// Read once from the environment at module load. There is deliberately NO settings UI: a settings
// screen costs UI, storage, validation and migration for one user who has shell access to the
// container. Change a value in the compose file and restart.
//
// The split INV-21b draws is enforced by what lives here versus what lives in code:
//   HERE          — magnitudes. How many rows, how many sweeps, how many days.
//   NOT HERE      — policy. Which senders bundle, what counts as seen, how the retention tiers
//                   rank against each other, what pinning does. Those are behaviour, and
//                   behaviour is reviewed code, not configuration (INV-21b).
//
// Every constant is clamped into its documented bounds. A garbage value degrades to the default
// rather than throwing at boot — a typo in an env var must not take the mail client down — but the
// clamp is logged so it is discoverable. KEEP_DECAY_SWEEPS and AUTOFILE_AGE_DAYS additionally
// refuse null/Infinity: INV-21b calls those out by name because unbounded Keep recreates the
// star-accumulation backlog the tier exists to prevent, and unbounded auto-file lets the unread
// tail below the seen line grow forever. `clampInt` cannot express "unlimited", so the refusal is
// structural rather than a check someone can forget.
import { logger } from '../api.js';

// Parse an integer env var into [min, max], falling back to `fallback` for anything non-finite or
// out of range. Non-finite covers '', undefined, 'none', 'infinity' and NaN in one place, which is
// what makes "never unbounded" unrepresentable rather than merely discouraged.
export function clampInt(raw, { min, max, fallback, name }) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) {
    logger.warn(`[bundles] ${name}="${raw}" is not a finite integer; using ${fallback}`);
    return fallback;
  }
  if (parsed < min || parsed > max) {
    const clamped = Math.min(max, Math.max(min, parsed));
    logger.warn(`[bundles] ${name}=${parsed} outside ${min}–${max}; clamped to ${clamped}`);
    return clamped;
  }
  return parsed;
}

// The manual override list (INV-4): senders that matter but are never replied to, so the derived
// never-bundle set cannot find them. An entry is an address ('alerts@bank.com') or a bare domain
// ('bank.com'); a domain covers a sender that rotates its local part, which is what keeps the list
// at the 5-to-10 entries the spec expects.
//
// An environment variable rather than stored state, because INV-21a allows exactly this — a config
// file or env vars, never a settings UI — and because one source of truth beats two. Editing it
// means editing the compose file and restarting, which for a single user with shell access is the
// whole interaction.
//
// The 50-entry cap is a smell alarm, not a knob: past that the classifier is failing and the answer
// is to fix it, not to keep typing (S-10 caps maintenance at one action per week).
export const MAX_OVERRIDES = 50;

export function parseNeverBundle(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const out = [];
  for (const part of raw.split(',')) {
    const entry = part.trim().toLowerCase();
    // Must look like an address or a domain. A typo that silently exempts nothing is worse than one
    // dropped at parse time.
    if (!entry || out.includes(entry)) continue;
    if (!entry.includes('@') && !entry.includes('.')) continue;
    out.push(entry);
    if (out.length >= MAX_OVERRIDES) break;
  }
  return out;
}

// Build the config from an environment-like object. Taking `env` as a parameter (rather than
// reading process.env inline) is what lets the suite exercise the bounds without mutating global
// state; production calls it once, below.
export function buildConfig(env = {}) {
  return Object.freeze({
    NEVER_BUNDLE: Object.freeze(parseNeverBundle(env.BUNDLES_NEVER_BUNDLE)),
    // Maximum rows the inbox renders before grouping compresses further (INV-8). The real
    // constraint is "fits one phone screen without scrolling" (OQ-1), so it is measured, not
    // guessed — 7 is the spec's starting value.
    ROW_BUDGET: clampInt(env.BUNDLES_ROW_BUDGET, {
      min: 4, max: 20, fallback: 7, name: 'BUNDLES_ROW_BUDGET',
    }),
    // How many sweeps a Keep survives before decaying back to seen (INV-10, INV-10a). Never
    // unbounded: a permanent flag applied casually is how stars fail in every client.
    KEEP_DECAY_SWEEPS: clampInt(env.BUNDLES_KEEP_DECAY_SWEEPS, {
      min: 1, max: 10, fallback: 3, name: 'BUNDLES_KEEP_DECAY_SWEEPS',
    }),
    // Age at which unswept bundled mail files itself without being asked (NTH-2). Never unbounded:
    // this is what stops the tail below the seen line growing without limit.
    AUTOFILE_AGE_DAYS: clampInt(env.BUNDLES_AUTOFILE_AGE_DAYS, {
      min: 1, max: 90, fallback: 7, name: 'BUNDLES_AUTOFILE_AGE_DAYS',
    }),
    // Smallest group that may render as a group. Below this a group costs a row without saving
    // any, and INV-8 is explicit that a group which does not compress is worse than no group.
    MIN_GROUP_SIZE: clampInt(env.BUNDLES_MIN_GROUP_SIZE, {
      min: 2, max: 10, fallback: 3, name: 'BUNDLES_MIN_GROUP_SIZE',
    }),
    // How long a sweep stays undoable (INV-12 sets the floor at 10s).
    UNDO_WINDOW_SECONDS: clampInt(env.BUNDLES_UNDO_WINDOW_SECONDS, {
      min: 5, max: 60, fallback: 10, name: 'BUNDLES_UNDO_WINDOW_SECONDS',
    }),
  });
}

export const config = buildConfig(process.env);
