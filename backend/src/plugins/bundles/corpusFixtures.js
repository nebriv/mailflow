// The committed fixture corpus for GATE 1.
//
// Not a substitute for the spec's 500 hand-reviewed real messages — it is the regression floor that
// keeps CI honest between runs of the real thing, and it is deliberately weighted toward the cases
// that actually broke in Spark:
//
//   • the two named failures from §1.2 (VMware CRITICAL advisory, Binance account action), both
//     carrying bulk headers from senders who also send genuine marketing
//   • the senders the client reads for pleasure and must keep bundling (§1, "non-problems"):
//     Zillow, Crowd Supply, WIRED Gear, Humble Bundle, Kobo
//   • correspondents, whose mail must never bundle no matter what headers it carries (S-6)
//   • security / financial / transactional mail from bulk senders (S-7)
//   • adversarial near-misses in both directions: marketing that uses transactional words, and
//     transactional mail that reads like marketing
//
// `truth` is the hand-reviewed verdict. `sensitive` and `correspondent` drive S-7 and S-6.

export const CORPUS = Object.freeze([
  // ── §1.2's two named failures ────────────────────────────────────────────────────────────────
  {
    from: 'security-noreply@vmware.com', subject: 'VMSA-2026-0011: CRITICAL vCenter Server vulnerability',
    is_bulk: true, category: 'newsletter', truth: 'inbox', sensitive: true,
  },
  {
    from: 'no-reply@binance.com', subject: 'Action Required: Verify your account to continue trading',
    is_bulk: true, category: 'newsletter', truth: 'inbox', sensitive: true,
  },
  // The same two senders' genuine marketing must still bundle, or the guard has simply moved the
  // problem: a sender-level exemption would have held these back too.
  {
    from: 'marketing@vmware.com', subject: 'Explore what is new in vSphere 9',
    is_bulk: true, category: 'promotion', truth: 'promotions',
  },
  {
    from: 'no-reply@binance.com', subject: 'Weekly market roundup',
    is_bulk: true, category: 'newsletter', truth: 'newsletters',
  },

  // ── Mail the client reads for pleasure (§1) — must bundle ────────────────────────────────────
  { from: 'alerts@zillow.com', subject: 'New listings in your saved search', is_bulk: true, category: 'newsletter', truth: 'newsletters' },
  { from: 'newsletter@crowdsupply.com', subject: 'This week on Crowd Supply', is_bulk: true, category: 'newsletter', truth: 'newsletters' },
  { from: 'newsletter@wired.com', subject: 'The best gear we tested this month', is_bulk: true, category: 'newsletter', truth: 'newsletters' },
  { from: 'contact@humblebundle.com', subject: 'New Humble Bundle: indie games for a good cause', is_bulk: true, category: 'promotion', truth: 'promotions' },
  { from: 'news@kobo.com', subject: 'Your weekly Kobo picks', is_bulk: true, category: 'newsletter', truth: 'newsletters' },
  { from: 'digest@substack.com', subject: 'Sunday reading', is_bulk: true, category: 'newsletter', truth: 'newsletters' },
  { from: 'hello@arstechnica.com', subject: 'Ars Technica Weekly', is_bulk: true, category: 'newsletter', truth: 'newsletters' },
  { from: 'deals@steampowered.com', subject: 'Summer Sale starts now', is_bulk: true, category: 'promotion', truth: 'promotions' },
  { from: 'noreply@github.com', subject: '[org/repo] Run failed: CI on main', is_bulk: true, category: 'automated', truth: 'notifications' },
  { from: 'notifications@linear.app', subject: 'ENG-412 moved to In Review', is_bulk: true, category: 'automated', truth: 'notifications' },
  { from: 'noreply@medium.com', subject: 'Stories for you', is_bulk: true, category: 'social', truth: 'social' },
  { from: 'notify@linkedin.com', subject: 'You appeared in 9 searches this week', is_bulk: true, category: 'social', truth: 'social' },

  // ── Correspondents (S-6) — never bundle, whatever the headers say ────────────────────────────
  { from: 'sam@partnerco.com', subject: 'Re: contract draft', is_bulk: false, category: 'primary', truth: 'inbox', correspondent: true },
  { from: 'jules@friend.net', subject: 'dinner saturday?', is_bulk: false, category: null, truth: 'inbox', correspondent: true },
  // A correspondent whose mail carries list headers — they post to a mailing list the client is on.
  // Sender-level exemption is the only thing that saves this one; the guard has no objection to it.
  { from: 'dana@collaborator.org', subject: 'thoughts on the proposal', is_bulk: true, category: 'newsletter', truth: 'inbox', correspondent: true },
  // A correspondent using a marketing platform (a small studio mailing from Mailchimp).
  { from: 'ana@studio.example', subject: 'update on the commission', is_bulk: true, category: 'promotion', truth: 'inbox', correspondent: true },

  // ── Security / financial / transactional from bulk senders (S-7) ─────────────────────────────
  { from: 'no-reply@bank.example', subject: 'Your statement is ready', is_bulk: true, category: 'automated', truth: 'inbox', sensitive: true },
  { from: 'noreply@stripe.com', subject: 'Your invoice for August', is_bulk: true, category: 'automated', truth: 'inbox', sensitive: true },
  { from: 'alerts@paypal.com', subject: 'You sent a payment of $42.00', is_bulk: true, category: 'automated', truth: 'inbox', sensitive: true },
  { from: 'noreply@amazon.com', subject: 'Your order #114-9928 has shipped', is_bulk: true, category: 'automated', truth: 'inbox', sensitive: true },
  { from: 'noreply@accounts.google.com', subject: 'Security alert: new sign-in on Windows', is_bulk: true, category: 'automated', truth: 'inbox', sensitive: true },
  { from: 'no-reply@dropbox.com', subject: 'Your verification code is 448210', is_bulk: true, category: 'automated', truth: 'inbox', sensitive: true },
  { from: 'noreply@airline.example', subject: 'Your flight departs tomorrow — check in now', is_bulk: true, category: 'automated', truth: 'inbox', sensitive: true },
  { from: 'billing@hosting.example', subject: 'Payment failed for your subscription', is_bulk: true, category: 'automated', truth: 'inbox', sensitive: true },
  { from: 'noreply@irs.example', subject: 'Important tax document available', is_bulk: true, category: 'automated', truth: 'inbox', sensitive: true },
  // Calendar invites arrive as category 'automated' because the Content-Type is not persisted.
  { from: 'calendar-notification@google.com', subject: 'Invitation: Design review @ Mon Aug 17, 10am', is_bulk: true, category: 'automated', truth: 'inbox', sensitive: true },
  { from: 'calendar-notification@google.com', subject: 'Updated invitation: Standup', is_bulk: true, category: 'automated', truth: 'inbox', sensitive: true },
  // Operational sender, innocuous subject — the local-part rule is what catches this.
  { from: 'security@acme.example', subject: 'Monthly infrastructure digest', is_bulk: true, category: 'newsletter', truth: 'inbox', sensitive: true },

  // ── Adversarial near-misses: marketing wearing transactional clothes ─────────────────────────
  // These SHOULD bundle. Each contains a word that a naive guard would fire on, and each is the
  // reason the guard matches phrases and whole tokens rather than substrings.
  { from: 'deals@shop.example', subject: 'Order your copy today and save 20%', is_bulk: true, category: 'promotion', truth: 'promotions' },
  { from: 'news@retailer.example', subject: 'Free shipping all weekend', is_bulk: true, category: 'promotion', truth: 'promotions' },
  { from: 'hello@saas.example', subject: 'Innovative new features are here', is_bulk: true, category: 'promotion', truth: 'promotions' },
  { from: 'news@travel.example', subject: 'Private villas from $99 a night', is_bulk: true, category: 'promotion', truth: 'promotions' },
  { from: 'events@conf.example', subject: 'Your exclusive invitation: join us in Berlin', is_bulk: true, category: 'promotion', truth: 'promotions' },
  { from: 'news@charity.example', subject: 'Activate your matching gift', is_bulk: true, category: 'promotion', truth: 'promotions' },

  // ── Ordinary primary mail — no bulk signal, stays put ────────────────────────────────────────
  { from: 'recruiter@company.example', subject: 'Opportunity at Company', is_bulk: false, category: 'primary', truth: 'inbox' },
  { from: 'stranger@example.org', subject: 'quick question about your project', is_bulk: false, category: null, truth: 'inbox' },
]);

// Load the corpus: BUNDLES_CORPUS_PATH when set, else the fixtures above. Kept out of corpus.js so
// that module stays free of filesystem imports and usable in any context.
export async function loadCorpus(env = process.env) {
  const path = env.BUNDLES_CORPUS_PATH;
  if (!path) return { records: CORPUS, source: 'fixtures' };
  const { readFile } = await import('node:fs/promises');
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`BUNDLES_CORPUS_PATH must contain a JSON array, got ${typeof parsed}`);
  return { records: parsed, source: path };
}
