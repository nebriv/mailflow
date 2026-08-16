# Bundles and Sweep — Build Specification

**Deliverable:** A self-hosted email client that reaches and holds inbox zero, built as a
fork of MailFlow (AGPL-3.0), deployed as Docker containers, used as a PWA on Android.

**Client:** Single user. No multi-tenancy, no public release required.

**Status:** Specification. No code written.

Requirement keywords MUST, MUST NOT, SHOULD, and MAY are used in the RFC 2119 sense.
Requirements are numbered for reference in review.

---

## 1. Problem statement

The client currently uses Spark ($120/yr). Spark presents bundles (Notifications,
Newsletters, Pinned) as collapsed rows inline in the message list. The presentation is
correct. Every mechanic behind it is wrong, and the observed result is a Notifications
bundle at 166 unread and a Newsletters bundle at 332 unread, neither of which is ever
cleared.

The four mechanical failures, in order of severity:

**1.1 — Counts are lifetime totals, not arrivals since last clear.** Inbox counted what had
arrived since the bundle was last swept, so the number was typically 8 to 14. A bundle
showing 14 invites a sweep. A bundle showing 332 is a backlog already lost, and the rational
response is to stop looking at it. Spark converted a triage unit into an accumulator.

**1.2 — The bundle bucket is not trustworthy.** The current Newsletters bucket contains a
CRITICAL VMware vCenter advisory and a Binance account-action notice. Both carry bulk or
List-Unsubscribe headers, so header-based classification files them alongside marketing.
Refusing to bulk-archive is a correct response to an unreliable classifier, not loss aversion.
**Sweep confidence is downstream of classifier precision. This is the blocking dependency for
the entire project.**

**1.3 — Skimming produces no actionable state, so triage must be re-expressed manually.**
This is the sharpest failure and the one most worth fixing. The client *does* read the
bundles, skimming nearly all of them. That skim is the triage decision. Spark captures none
of it, so the decision must be re-entered by hand: either tap each message individually
(7 taps for 7 messages) or use "Mark as Done all emails," which opens a confirmation dialog
asking a question the client cannot answer, because "all emails in the group" includes
messages below where he stopped scrolling. The result is neither path gets taken.

Spark's confirmation dialog exists because Spark's sweep is genuinely unsafe. It is a symptom
to design out, not a pattern to reproduce.

**1.4 — The bundle row is a permanent fixture.** It sits in the list whether or not anything
new is in it. Something always present cannot be cleared, so there is nothing to clear, and
there is no zero state.

Two secondary failures:

**1.5 — Read pins are hidden.** Pinning a message that is later read requires enabling "show
read mail" to see it again. This treats "I have seen it" as "I am done with it," the opposite
of why it was pinned.

**1.6 — Categories are fixed.** Spark's auto-sorting cannot be customized, so mail that does
not fit its categories lands in the main inbox as one undifferentiated pile.

Non-problems, explicitly: the client wants the newsletter mail he receives. Zillow, Crowd
Supply, WIRED Gear, Humble Bundle, and Kobo are read for pleasure. Volume is not the problem.
The problem is that there is nowhere for reading material to go except the queue reserved for
things that need doing.

---

## 2. Why Google Inbox remains superior — analysis

Inbox (2014–2019) is still the benchmark seven years after shutdown. The superiority is
mechanical, not visual. Spark copied the appearance and none of the machinery.

| Mechanic | Google Inbox | Spark | This build |
|---|---|---|---|
| Bundle count | Since last sweep | Lifetime unread | Since last sweep |
| Bundle row when empty | Disappears | Always present | Disappears |
| Clear a bundle | One click | Select, then archive | One tap |
| Starred mail on sweep | Survives | n/a | Survives |
| Scheduled delivery | Per-bundle, per-day/time | None | Per-category |
| Custom bundles | Yes, with rules | No | Derived, no rules UI |
| Zero state | Yes | None | Yes |
| Read pins | Visible | Hidden behind toggle | Always visible |

The design rationale, from Michael Leggett, who led Inbox for its first four years:

**2.1 — Classify the bottom, do not rank the top.** "Instead of trying to rank the top 10%
[of emails], let's just group or bundle the bottom 80%." This is the governing principle of
the entire system. It is a noise detector with an exemption list, not an importance ranker.
Header signals are good at the former and bad at the latter.

**2.2 — Grouped but visible, not filed away.** Bundled mail is "grouped together but still
visible — not completely out of sight and out of mind, as they are with Gmail's tabs system."
This is why bundles beat both folders and Gmail's category tabs.

**2.3 — Homogeneity enables batch processing.** "I open that up, and now I have 20 emails
that are very similar, and I can process those in batch in ways I can't do when they're all
intermixed in the inbox."

**2.4 — Sweep is not all-or-nothing.** In Leggett's later Simplify implementation, a sweep
clears the bundle "leaving behind only those messages that are starred and thus require
further attention."

**2.5 — Scheduled delivery.** Bundles can surface only at set times: social mail once daily
in the late afternoon, finance and purchase mail only on Sundays.

**2.6 — The category set came from data**, specifically a study of how people actually used
Gmail labels, yielding Promos, Social, Updates, Finance, Purchases, Travel, Forums, and a
catch-all Low Priority.

Inbox did not fail on design. It was narrowed from a broader personal-information product
down to email only, at which point it was competing with Gmail and had no winning path.
None of that applies to a single-user self-hosted client.

Supporting psychology, from the research pass, with the weak claims excluded:

- Reduced checking frequency lowers stress (Kushlev & Dunn 2015, within-subjects, n=124,
  d≈0.45). The benefit came from checking less often, not clearing faster. **Scheduled
  delivery is the structural implementation of this.**
- Attention residue: unfinished tasks degrade subsequent performance, and incompleteness is
  the strongest predictor of residue intensity (Leroy 2009). **A clean one-tap completion is
  the correct response.**
- Working memory holds roughly 4±1 un-chunked items (Cowan 2001). **Justifies a short row
  budget; each bundle header is a chunk.**
- Layer-cake scanning (fixating on headings) is the most efficient scan pattern, and requires
  headings that are easy to pick out (NN/g). **Justifies visually distinct bundle headers.**
- Pre-attentive processing: single visual features (colour, weight, size) are found in
  constant time; conjunctions and text are serial. **Encode "has new mail" in one channel.**
- Overjustification effect and variable-ratio reinforcement. **Justifies the gamification
  prohibitions in §6.**

Do not build rationale on ego depletion, the paradox of choice, or the Zeigarnik effect.
All three replicate poorly.

---

## 3. Definition of success

The build is successful when all of the following hold for 30 consecutive days.

| ID | Metric | Target |
|---|---|---|
| S-1 | Inbox rows remaining at end of a triage session, excluding pinned | 0 |
| S-2 | Median rows visible on inbox open | ≤ 7 |
| S-3 | Taps to clear one bundle, from inbox open | 1 |
| S-3a | Confirmation dialogs shown during routine triage | 0 |
| S-3b | Unseen messages cleared by a sweep | 0 |
| S-4 | Taps entering selection mode during routine triage | 0 |
| S-5 | Median time to fully triage a morning's mail | < 90 seconds |
| S-6 | Messages from the never-bundle set misfiled into a bundle | 0 |
| S-7 | Security, financial, or transactional mail landing in a bundle | 0 |
| S-8 | Maximum count displayed on any bundle | ≤ 25 |
| S-9 | Days per week on which a sweep occurs | ≥ 5 |
| S-10 | Manual maintenance actions per week (list edits, recategorisation) | ≤ 1 |
| S-11 | Upstream releases merged without a conflict outside `plugins/` | ≥ 80% |
| S-12 | Lines of diff in MailFlow core | ≤ 50 |

S-6 and S-7 are pass/fail. A single violation resets the 30-day clock.

S-9 is the adoption metric and the one that actually matters. If sweep is not used, nothing
else in this specification matters.

---

## 4. Design invariants (MUST)

Violating any of these means the build has regressed to the product it replaces.

**Classification**

- **INV-1** — The classifier MUST detect noise and exempt known correspondents. It MUST NOT
  attempt to rank importance, score priority, or identify urgency.
- **INV-2** — Failure modes are asymmetric. A false positive (real mail bundled) permanently
  destroys trust in sweep. A false negative (bulk mail left loose) costs one row and one
  swipe. When uncertain, the classifier MUST leave the message in the inbox.
- **INV-3** — Classification MUST read headers and sender only. It MUST NOT read message
  bodies. No inference call in the common path; classification is a table lookup.
- **INV-4** — The never-bundle set MUST be derived from sent mail: every address ever replied
  to, recomputed on a schedule. A manual override list MAY exist for senders that matter but
  are never replied to. Expected override size is 5 to 10 entries.

**Counts and state**

- **INV-5** — A bundle MUST show only messages that arrived after its sweep cursor. Lifetime
  totals MUST NOT be displayed anywhere.
- **INV-6** — A bundle with no messages after its cursor MUST NOT render a row.
- **INV-7** — The reading feed MUST NOT display an unread count, badge, or bold state.
- **INV-8** — The inbox MUST render at most N rows (see OQ-1). Grouping is constrained by the
  row budget, not by which senders qualify. A group that does not compress is worse than no
  group.

**Actions**

- **INV-9** — Sweep MUST complete in one tap. It MUST NOT require selection mode and MUST
  NOT present a confirmation dialog on any path.
- **INV-9a** — Sweep MUST clear only messages the user has seen, determined by a scroll-depth
  high-water mark per bundle. Messages below the deepest scroll position reached MUST remain.
  Reading is the selection mechanism; skimming is the triage decision and the system MUST
  capture it. Scroll depth is used rather than read flags because the client skims subject
  lines without opening messages, so read state is never set.
- **INV-9c** — The seen boundary MUST be visible in the list as a rule or divider, and the
  count above it MUST match the sweep control's label. The boundary SHOULD be draggable so
  the user can correct it by hand.
- **INV-9d** — The seen boundary MUST NOT be inferred from scroll speed, dwell time, or any
  other behavioural signal. The mechanic works because it is mechanically legible and
  perfectly predictable; inference reintroduces the uncertainty that made the confirmation
  dialog necessary, fails silently and asymmetrically, and cannot be debugged when wrong.
- **INV-9b** — The sweep control MUST state its exact scope in its own label ("Clear 9 seen"),
  never a generic verb. Stating scope in the control removes the need to confirm scope in a
  dialog. Scope labelling, seen-only operation, and the undo toast together replace
  confirmation entirely.
- **INV-10** — Three retention tiers MUST exist, separated by duration:

  | State | Effect | Duration |
  |---|---|---|
  | Seen | Cleared by sweep | Until next sweep |
  | Keep | Survives sweep, stays in the bundle | 2–3 sweeps, then reverts to seen |
  | Pin | Top of list, immune to all filters and sweeps | Until manually removed |

- **INV-10a** — Keep MUST decay. A permanent flag applied casually becomes a silent second
  backlog, which is how stars fail in every client. Decay makes marking cheap: being wrong
  costs nothing and self-corrects. Decay period is OQ-7.
- **INV-10b** — Keep MUST be reachable in one gesture from the bundle list without opening
  the message, and MUST be reversible by the same gesture.
- **INV-11** — Sweep MUST file, never delete. Swept mail moves to the category's reading feed
  and remains browsable. The UI MUST state this.
- **INV-12** — Every sweep MUST be undoable for at least 10 seconds via a non-blocking toast.

**Precedence**

- **INV-13** — Manual state outranks derived state. Classification is derived, read is
  observed, sweep is bulk; a pin is deliberate and therefore wins.
- **INV-14** — Pinned rows MUST render above every filter and MUST NOT be hidden by read
  state, unread-only toggles, category views, or sweep.
- **INV-15** — Pins MUST consume row budget. Past a threshold the pinned block collapses into
  a counted group. Without this, pins accumulate into a silent second backlog.
- **INV-16** — Pinning MUST be the repair path for a misclassification, lifting a message out
  permanently rather than for one session.

**Reveal**

- **INV-17** — A one-tap reveal MUST exist that shows everything derived at once: read mail,
  collapsed bundles, and recently swept items. Hiding is only safe if "where did it go" is
  one tap away.
- **INV-18** — The reveal MUST be read-only, MUST NOT affect pins, and MUST be
  non-persistent, reverting on leaving the screen. It is a glance, not a mode.

**Storage**

- **INV-19** — Bundle membership MUST be a real IMAP folder, so state survives across clients
  and outlives this project.
- **INV-20** — No folder tree, folder picker, or filing interaction may appear in the UI.

**Configuration**

- **INV-21** — Nothing that can be derived may be configured. Every setting the user
  maintains is a classifier failure.
- **INV-21a** — Tuning constants MAY be exposed, but only as values in a single config file
  or environment variables, never as a settings UI. A settings screen costs UI, storage,
  validation, and migration for a single user who has shell access to the container.
- **INV-21b** — Only tuning constants may be exposed. Behavioural policy MUST stay in code:
  which senders are bundled, what counts as seen, retention tier precedence, and pin
  behaviour are not configurable.

  | Constant | Default | Bounds |
  |---|---|---|
  | `ROW_BUDGET` | 7 | 4–20 |
  | `KEEP_DECAY_SWEEPS` | 3 | 1–10, **never unbounded** |
  | `AUTOFILE_AGE_DAYS` | 7 | 1–90, **never unbounded** |
  | `MIN_GROUP_SIZE` | 3 | 2–10 |
  | `UNDO_WINDOW_SECONDS` | 10 | 5–60 |

  `KEEP_DECAY_SWEEPS` and `AUTOFILE_AGE_DAYS` MUST NOT accept a null or infinite value.
  Unbounded Keep recreates the star-accumulation problem the tier exists to prevent;
  unbounded auto-file lets the unread tail below the seen line grow without limit.

**Fork hygiene**

- **INV-22** — Core diff MUST stay ≤ 50 lines (S-12). Reaching the limit is the signal to
  request an upstream slot, not to spend more budget.
- **INV-23** — No database migrations. Plugin state uses the existing `plugin_data`,
  `plugin_account_config`, and `messages.plugin_annotations` stores.
- **INV-24** — Upstream's full test suite and `npm run lint:plugins` MUST pass at zero
  violations after every rebase.

---

## 5. Nice to haves (SHOULD / MAY)

Build only after §4 is complete and §3 targets are met.

- **NTH-1** — Scheduled bundle delivery per category. *SHOULD.* Highest-value item on this
  list; promote to MUST if S-5 or S-9 are missed.
- **NTH-2** — Auto-file on age, so a category clears itself without being asked. *SHOULD.*
- **NTH-3** — Date-group sweep affordance on the existing Today / This week headers. *SHOULD.*
  Cheapest item in the whole build.
- **NTH-4** — Offline caching and action queue for subway use. *SHOULD.*
- **NTH-5** — Row-budget grouping with automatic per-sender groups. *MAY.*
- **NTH-6** — Custom theme via `themes.js` tokens and `custom_css`. *MAY.* Zero merge cost.
- **NTH-7** — LLM digest of the reading feed. *MAY.* See §9. Gated on Phase 1.
- **NTH-8** — Web push, Declarative Web Push payload format. *MAY.*

---

## 6. Avoids (MUST NOT)

- **AV-1** — No streaks, points, XP, levels, leaderboards, or achievement badges. Streaks
  weaponise loss aversion and manufacture the anxiety this build removes. Even Superhuman's
  founder states that points-and-badges gamification "didn't work."
- **AV-2** — No unread badges anywhere except the bounded bundle counts of INV-5.
- **AV-3** — No variable or unpredictable reward framing for new mail. Surfacing is
  deterministic and batched.
- **AV-4** — No escalating celebration on reaching zero. A quiet, constant zero state only;
  an escalating one becomes its own variable-reward loop.
- **AV-5** — No AI assistant, smart reply, auto-draft, or tone rewriting. MailFlow ships
  these; they stay off.
- **AV-6** — No importance ranking, priority inbox, VIP tiers, or urgency detection (INV-1).
- **AV-7** — No folder tree or filing UI (INV-20).
- **AV-8** — No rules-authoring UI in the initial build (INV-21).
- **AV-9** — No recommendations, suggested content, or anything not addressed to the user
  injected into the reading feed. This is the failure that made Pocket a content firehose
  rather than a reading tool.
- **AV-10** — No read receipts or tracking pixels, sent or honoured.
- **AV-11** — No multi-user features, sharing, assignment, or collaboration.
- **AV-12** — No edits to MailFlow's compose, reader, search, settings, or auth surfaces.
  Those stay upstream's and are inherited unchanged.

---

## 7. Architecture

Fork MailFlow. Stay inside its frontend. A separate frontend against MailFlow as a headless
backend was considered and rejected: it requires rebuilding compose, reader, search,
attachments, auth, and settings.

```
MailFlow backend (unmodified)
  Node 22 + Postgres 16 + Redis 7
  IMAP sync, MIME parsing, sanitisation, threading, OAuth, web push
        │
        ├── backend/src/plugins/bundles/     cursor, classifier, sweep, scheduling
        │      imports only ../api.js and own siblings (lint-enforced)
        │
MailFlow frontend (React + Vite)
        │   one conditional in MessageList.jsx  ← the entire core diff
        │
        └── frontend/src/plugins/bundles/    inline rendering, sweep control, reveal
```

Existing capability surface (`backend/src/plugins/api.js`, 98 lines) already provides
`applyLabel`, `removeLabel`, `ensureLabelFolders`, `listThreadHeadsByLabels`,
`archiveInboxCopy`, `broadcast`, per-plugin `storage.*`, `getAccountConfig` /
`setAccountConfig`, and per-message annotations. This covers the entire feature.

**Reference implementation:** the GTD plugin (`backend/src/plugins/gtd/`, 1,718 lines source;
`frontend/src/plugins/gtd/`, 689 lines) is the same architectural shape. Read it first.

**Known obstacle:** the inbox pill-tab strip in `MessageList.jsx` is interleaved with core
category tabs and is not behind a slot. Upstream's own plugin README documents this. It is
the one place the core diff is spent.

**Churn reference** (commits, six months to Aug 2026), which is why INV-22 exists:

| File | Commits |
|---|---|
| `frontend/src/components/MessageList.jsx` | 134 |
| `backend/src/services/imapManager.js` | 101 |
| `frontend/src/store/index.js` | 73 |
| `backend/src/services/categorizer.js` | 4 |
| `backend/src/plugins/api.js` | 3 |
| `frontend/src/plugins/registry.js` | 3 |

**Fork process:** track release tags, never `main`. Rebase, never merge. `git rerere` enabled.
Contract tests run against upstream's API surface before promoting any new image.

---

## 8. Phases and acceptance gates

Each gate MUST pass before the next phase begins. Gates are pass/fail, not judgement calls.

### Phase 0 — Reduce and evaluate (no code)

Work:
- Unsubscribe from dead senders only: services no longer used, abandoned accounts, anything
  not opened in a year. **Not** high-volume senders the client enjoys.
- Configure per-service aliases on the catch-all domain for future signups.
- Deploy MailFlow via Docker against a throwaway IMAP account. Enable the GTD plugin. Use it
  for 7 days.
- If any account is Gmail on desktop, run Simplify Gmail ($2/mo) for 30 days to evaluate
  scheduled delivery, star-survives-sweep, and inline grouping against real mail.

**GATE 0** — All must be true:
- [ ] MailFlow runs, syncs a real account, and survives 7 days without data loss
- [ ] GTD's label-to-IMAP-folder round trip verified in a second client
- [ ] A written go/no-go on MailFlow as the base
- [ ] Dead-sender unsubscribes complete

### Phase 1 — Trust (backend only)

**This is the blocking phase. Nothing downstream is safe without it.**

Work:
- Never-bundle set derived from sent mail (INV-4)
- Manual override list, 5–10 entries
- Sender-keyed classification cache; a sender is classified once
- Header signals only: `List-Id`, `List-Unsubscribe`, `Precedence`, `Auto-Submitted`,
  `Feedback-ID`, DKIM `d=` (INV-3)
- Corpus test harness: 500 real archived messages, classified, reviewed by hand

**GATE 1** — All must be true:
- [ ] Corpus test: 0 never-bundle-set messages misclassified (S-6)
- [ ] Corpus test: 0 security, financial, or transactional messages bundled (S-7)
- [ ] 14 consecutive days live with 0 violations of S-6 and S-7
- [ ] Manual override list ≤ 10 entries at end of period (S-10)
- [ ] No message body read by the classifier, verified by code review (INV-3)

If GATE 1 cannot be met, **stop**. See §10.

### Phase 2 — Date-group sweep

Work: add a sweep affordance to the existing Today / This week / Yesterday headers. The
grouping logic already exists; this adds one control. Ship the reveal (INV-17, INV-18) in
this phase, not later.

**GATE 2**:
- [ ] One tap clears a date group (S-3)
- [ ] Sweep clears only messages above the scroll high-water mark (INV-9a, S-3b)
- [ ] The control states its scope in its label; no confirmation dialog appears (INV-9b, S-3a)
- [ ] Starred messages survive (INV-10)
- [ ] Undo works for ≥ 10s (INV-12)
- [ ] Reveal shows swept items, is read-only, and reverts on leaving the screen
- [ ] 7 consecutive days with ≥ 5 sweep days (S-9)

### Phase 3 — Sweep cursor

Work: `last_swept_at` per category per account in `plugin_account_config`. Bundle contents =
messages newer than cursor. Sweep archives and sets cursor to now.

One-time migration: archive everything older than 7 days, set all cursors to now. Start from
zero rather than importing the existing 498-message backlog.

**GATE 3**:
- [ ] No bundle displays a count above 25 for 14 days (S-8)
- [ ] A swept bundle renders no row until new mail arrives (INV-6)
- [ ] Migration complete; starting state is zero
- [ ] 14 days at S-9 ≥ 5

### Phase 4 — Reading feed

Work: a browse view per category, reverse chronological, opened deliberately. No unread
count. Sweep files into it. Backed by the same IMAP folder; a second view over existing state.

**GATE 4**:
- [ ] No count, badge, or bold state anywhere in the feed (INV-7)
- [ ] Swept mail appears in the feed and is readable offline
- [ ] Nothing not addressed to the user appears in the feed (AV-9)
- [ ] Client reports sweeping feels costless in a written check-in

### Phase 5 — Inline bundles

**Only proceed if Phases 2–4 have not already satisfied §3.** See §10.

Work: replace the pill-tab strip with inline collapsed bundle rows in a single list. Tap to
expand in place. Sweep control on the bundle header. Bundle headers typographically demoted
below human mail but pre-attentively distinct (bold weight, spacing above) per §2.

Core change: one conditional in `MessageList.jsx` delegating to `<BundleList />`.

**GATE 5**:
- [ ] Core diff ≤ 50 lines, verified by `git diff --stat` against the release tag (S-12)
- [ ] Median rows on inbox open ≤ 7 (S-2)
- [ ] Zero selection-mode entries during 14 days of routine triage (S-4)
- [ ] Median triage time < 90s (S-5)
- [ ] Upstream test suite and `lint:plugins` pass after rebase (INV-24)
- [ ] Keyboard navigation, mobile touch, empty and error states all handled in the new view

### Phase 6 — Row-budget grouping

Work: automatic per-sender groups constrained by row budget (INV-8). Not a rules UI. Adopt
the Inbox category set (§2.6) in place of MailFlow's five. Pinned as a special group.
Requires dynamic categories in plugin storage and a `categorize` rule action added to
`inboxRules.js`.

**GATE 6**:
- [ ] Row count never exceeds budget across 14 days
- [ ] No group renders with fewer than 3 members
- [ ] Zero settings screens added (INV-21)

### Phase 7 — Offline and push

Work: IndexedDB cache (list metadata for inbox and bundles, bodies for current working set,
never attachments, never remote images); action queue with idempotency keys applied
optimistically and replayed on reconnect; monotonic change cursor for sync;
`navigator.storage.persist()`; Declarative Web Push format, notify only on mail surviving
classification, debounced with rolled-up counts, constant-size payloads, re-subscribe on
every launch.

**GATE 7**:
- [ ] Full triage session completes offline; actions replay correctly on reconnect
- [ ] A 30-minute subway commute is served entirely from cache
- [ ] No push fires for bundled mail
- [ ] Push subscription survives 14 days without manual re-registration

---

## 9. Parked: LLM digest of the reading feed

Not in scope. Constraints recorded so they are not rediscovered.

Concept: a written digest of bulk mail generated server-side on a schedule and cached for
offline reading. Completing the digest completes the underlying messages. Better than a list
of forty marketing emails because a digest is finite, has an ending, and can be read rather
than skimmed.

Email is fully attacker-controlled input. If built, all of the following are non-negotiable:

- **D-1** — The model has no tools. Text in, text out. No function calls, no fetching, no
  mail actions. This eliminates action hijacking entirely.
- **D-2** — Output is a constrained schema, one gist string per message. Sender, timestamp,
  count, and message ID come from parsed headers, never model output.
- **D-3** — The model never emits URLs. Links are constructed by application code from the
  message ID. This closes the exfiltration channel.
- **D-4** — Rendered as plain text. No markdown image rendering, no model-authored HTML.
- **D-5** — Row list and counts are authoritative from the database, so injected instructions
  to omit a message fail. Only gist text is poisonable.
- **D-6** — Only bulk-classified mail is summarised (gated on Phase 1).
- **D-7** — Tapping any entry opens the raw message with full headers visible. Summarisation
  otherwise launders phishing: it strips the sender domain and formatting tells used to spot
  it and delivers the attacker's framing inside a trusted surface.

---

## 10. Kill criteria

Stop and reassess if any of these occur:

- **K-1** — Phase 0 ends with the problem resolved by unsubscribes and MailFlow as-shipped.
  Cheapest possible outcome; take it.
- **K-2** — GATE 1 cannot be met. Without a trustworthy classifier, sweep is never used and
  the rest of the specification is decoration.
- **K-3** — Phases 2 through 4 ship and §3 targets hold for 30 days without inline bundles.
  Phase 5 is the expensive half and the only one that spends core diff. If the cursor and the
  reading feed alone fix the behaviour, **stop there.**
- **K-4** — Core diff exceeds 50 lines and upstream declines a slot request.
- **K-5** — S-9 falls below 3 days/week for two consecutive weeks at any phase. Sweep is not
  being adopted; diagnose before building more.

---

## 11. Risks

**R-1 — Divergence, not merge conflicts.** After Phase 5 branches the render path, upstream
improvements to the message list stop arriving. Permanent, compounds silently, and does not
announce itself. Accept deliberately.

**R-2 — Ownership burden below the conditional.** Keyboard navigation, virtualisation,
accessibility, mobile touch handling, and empty and error states all become the client's.

**R-3 — Unversioned upstream API.** `routes/mail.js` at 88 commits and `utils/api.js` at 50
in six months. Contract tests are the defence.

**R-4 — Motivation decay.** The standard failure is dying at 80%, impressive but untrusted,
after months of running two clients. Phase ordering is the mitigation: Phases 1–4 deliver
real behaviour change before any expensive UI work.

**R-5 — Single upstream maintainer.** 289 stars, one primary committer. Mitigated by holding
the source, not by anything else.

---

## 12. Open questions for the client

- **OQ-1** — Starting `ROW_BUDGET`. The real constraint is "fits one phone screen without
  scrolling," closer to 6 or 7 on the client's device. Measure during Phase 0.
- **OQ-2** — How many senders send important mail but are never replied to? If the answer is
  near 5, the derived never-bundle set carries the design. If it is 50, the override list
  becomes the maintenance burden the client is trying to escape, and the classifier must get
  smarter instead.
- **OQ-3** — Does NTH-2 (auto-file on age) coexist with manual sweep, or does the cursor make
  it redundant?
- **OQ-4** — Which categories should never notify at all, versus notify with a rolled-up
  count?
- **OQ-5** — Upstream the list-body slot, or keep the fork private? Upstreaming zeroes the
  maintenance burden but requires signing MailFlow's CLA.
- **OQ-7** — Starting values for the constants in INV-21b. Set during Phase 0 from
  observation, not guessed up front.
- **OQ-8** — What gesture sets Keep? Candidate: tapping the unread dot on the row, which is
  already present, small, reversible, and reads as a state indicator.
- **OQ-6** — Should the reading feed auto-expire old unread items to prevent it becoming a
  second backlog, and at what age?
