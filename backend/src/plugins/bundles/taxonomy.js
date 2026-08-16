// Bundle categories, and the mapping from MailFlow's own per-message category.
//
// Four bundles, derived — there is no rules UI and no category editor (AV-8, INV-21). The set is
// deliberately small: each bundle header is one chunk against a working-memory budget of about
// 4±1 un-chunked items (§2, Cowan 2001), and every bundle that renders spends a row out of
// ROW_BUDGET. The spec's Phase 6 adopts Google Inbox's wider set (§2.6); until then these four map
// cleanly onto signals MailFlow already computes at ingest, so the mapping stays a table lookup
// (INV-3) rather than anything that has to inspect a message.
//
// INBOX is not a bundle. It is the absence of one — the value the classifier returns when a
// message must stay a first-class row. Naming it here keeps every caller's return type total, so
// "unclassified" is never represented as null and never accidentally treated as a bundle key.
export const INBOX = 'inbox';

export const BUNDLES = Object.freeze({
  NEWSLETTERS: 'newsletters',
  PROMOTIONS: 'promotions',
  NOTIFICATIONS: 'notifications',
  SOCIAL: 'social',
});

// Display order, which is also sweep order and row order. Newsletters first because it is the
// bundle the client actually reads for pleasure (§1, "non-problems"); Social last because it is
// the one most likely to be empty.
export const BUNDLE_ORDER = Object.freeze([
  BUNDLES.NEWSLETTERS,
  BUNDLES.PROMOTIONS,
  BUNDLES.NOTIFICATIONS,
  BUNDLES.SOCIAL,
]);

export const isBundleKey = (key) => BUNDLE_ORDER.includes(key);

// The IMAP folder each bundle's membership lives in (INV-19). Membership is a real folder, not a
// database flag, so the state survives across clients and outlives this project — the client can
// abandon this fork and still find his mail filed sensibly in any IMAP client.
//
// The same folder is also the category's reading feed (Phase 4). That is not two features sharing
// storage by coincidence: a bundled message gets a copy here at classification time and keeps it
// forever; sweep only removes the INBOX copy. "In the bundle" therefore means "in this folder AND
// still in INBOX", and "in the reading feed" means "in this folder", which is a superset. Sweep
// files, never deletes (INV-11), and that falls out of the storage model rather than needing to be
// enforced by the sweep code.
export const BUNDLE_FOLDER_ROOT = 'Bundles';

export const bundleFolder = (key) => `${BUNDLE_FOLDER_ROOT}/${bundleLabel(key)}`;

// Folder path segment per bundle. Capitalised because it is user-visible in other IMAP clients.
export function bundleLabel(key) {
  switch (key) {
    case BUNDLES.NEWSLETTERS: return 'Newsletters';
    case BUNDLES.PROMOTIONS: return 'Promotions';
    case BUNDLES.NOTIFICATIONS: return 'Notifications';
    case BUNDLES.SOCIAL: return 'Social';
    default: return null;
  }
}

export const allBundleFolders = () => BUNDLE_ORDER.map(bundleFolder);

// Resolve a folder path back to its bundle key, or null. Used when reading state back off IMAP.
export function bundleFromFolder(path) {
  return BUNDLE_ORDER.find((key) => bundleFolder(key) === path) || null;
}

// Map MailFlow's per-message `category` column to a bundle.
//
// The column is computed at ingest by services/messageParser.js `detectCategoryFromHeaders` from
// header signals only, which is exactly the input INV-3 permits. Reusing it means the classifier
// adds no header parsing of its own and stays a lookup.
//
// 'primary' and null map to null here, NOT to a bundle: no positive noise signal was found, so
// there is nothing to justify moving the message out of the inbox (INV-2).
export function bundleForCategory(category) {
  switch (category) {
    case 'newsletter': return BUNDLES.NEWSLETTERS;
    case 'promotion': return BUNDLES.PROMOTIONS;
    case 'automated': return BUNDLES.NOTIFICATIONS;
    case 'social': return BUNDLES.SOCIAL;
    default: return null;
  }
}
