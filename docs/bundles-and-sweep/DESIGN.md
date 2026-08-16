# Bundles and Sweep — implementation notes

Companion to [SPEC.md](./SPEC.md). The spec says what to build and why; this says how it was
built, which decisions were forced by MailFlow's actual internals, and what is deliberately
not done.

Read the spec first. Section numbers below (§1.2, INV-9a, S-7) all refer to it.

---

## 1. Where the code is

```
backend/src/plugins/bundles/     classification, cursor, sweep, hooks, HTTP
frontend/src/plugins/bundles/    bundle rows, sweep control, reveal, undo toast
```

Core changes, 47 lines against the 50-line budget (INV-22, S-12):

| File | Lines | What |
|---|---|---|
| `backend/src/plugins/loadPlugins.js` | +2 | register the backend manifest |
| `frontend/src/plugins/index.js` | +1 | import the frontend registrations |
| `frontend/src/plugins/registry.js` | +14 | `registerListTransform` / `getListTransforms` |
| `frontend/src/plugins/PluginSlot.jsx` | +13 −1 | `usePluginListTransform` |
| `frontend/src/components/MessageList.jsx` | +15 −3 | the transform seam, the slot, the empty-state guard |

Two of those are new **platform seams**, not bundles-specific code: `registerListTransform` and
`usePluginListTransform` name no plugin and are reusable by any future one. `MessageList.jsx` is
the only core component touched and it also names no plugin — contrast the pre-existing GTD leak
at `MessageList.jsx:2954`, which imports `GtdTabList` and checks `enabledPlugins.includes('gtd')`
directly. If the fork is ever upstreamed (OQ-5), these two seams are the part to offer.

Measure the budget with:

```bash
git diff <release-tag> --numstat -- ':!*/plugins/bundles' ':!*package-lock.json'
```

---

## 2. The four decisions that shaped everything

### 2.1 Membership is two IMAP copies, so the count cannot drift

A bundled message **keeps its INBOX copy** and **gains a copy in its bundle folder**:

| State | Copies | Renders as |
|---|---|---|
| In the bundle | `INBOX` + `Bundles/X` | inside the bundle row |
| In the reading feed | `Bundles/X` | browsable, out of the inbox |

Sweep removes the INBOX copy. Nothing is deleted and nothing moves to Archive.

The payoff is that INV-5 is **structural rather than computed**: "what arrived since the last
sweep" *is* "what still has an INBOX copy", read off the `in_inbox` flag
`listThreadHeadsByLabels` already returns. There is no subtraction anywhere to get wrong, so
§1.1's failure — a count that accumulates to 332 and stops being a triage unit — is not
prevented by careful arithmetic; it is unrepresentable.

It also makes undo exactly symmetric. Sweep removes the INBOX copy; undo copies it back from the
bundle folder, which sweep never touched.

`sweep.js` never forwards the `total` / `unread` columns that same query returns. Those are
lifetime counts and INV-5 forbids displaying them.

### 2.2 The classifier reads five persisted signals, not raw headers

MailFlow parses RFC headers at ingest and then **discards them** — only derived results are
stored. So the header signals reachable from a stored row are:

| Column | Derived from |
|---|---|
| `is_bulk` | `List-Unsubscribe` \| `List-Id` \| `List-Post`, or `Precedence: bulk\|list` |
| `category` | the above plus `Auto-Submitted`, `Content-Type: text/calendar`, noreply senders, and marketing-platform headers (Mailchimp, Klaviyo, Marketo, …) |
| `list_unsubscribe` | verbatim |
| `subject` | verbatim (a header, so inside INV-3) |
| `from_email` / `from_name` | verbatim |

The spec's Phase 1 also names **Feedback-ID** and **DKIM `d=`**. Those are never parsed and are
not recoverable from the database. Persisting them means a migration (INV-23 forbids one) plus
edits to `messageParser.js` and both ingest upserts — roughly 15 lines of core, a third of the
remaining budget. They are ESP fingerprints, and `category === 'promotion'` already carries that
signal from the same ingest pass, so they are out of scope. **This is a recorded narrowing, not
an oversight.**

`signals.js` is the whole INV-3 story: it enumerates the classifier's inputs field by field and
never spreads the message row, so a body column cannot reach the classifier by accident even
though `loadOwnedMessage` returns `m.*` including `body_text`. `signals.test.js` asserts it from
the other side — classification of a message whose body is replaced with a fake security alert is
byte-identical. GATE 1's "verified by code review" is one short function to read.

### 2.3 The guard is per-message; exemption is per-sender

§1.2's two failures — a CRITICAL VMware advisory and a Binance account notice filed as
newsletters — cannot be fixed by a sender exemption. Both senders genuinely send marketing from
the same domain with the same bulk headers. The only signal separating "your account was accessed
from a new device" from "upgrade to vSphere 9" is the **Subject**.

So the two mechanisms are layered, and only the stable half is cached:

- `classifySender` — exemption + bulk signal + category → cached per address ("a sender is
  classified once")
- `guardReason` — subject and sender local-part → **never cached**, runs for every message

A cached `newsletters` verdict therefore still lets an individual message be held back.

Guard matching is token- and phrase-based, not substring. Plain `String.includes` was tried first
and is wrong: `'deactivated'` contains `'vat'`, as do `'innovative'` and `'private'`. A guard that
fires on every message containing those three letters holds back the entire Promotions bundle,
which is the guard destroying the feature it exists to protect. Three rules, one visible per
needle in `guards.js`:

| Needle | Rule |
|---|---|
| `'security alert'` (has a space) | substring on the normalised subject |
| `'vulnerab*'` (trailing star) | prefix match against a whole token |
| `'otp'` (bare) | exact whole-token match |

No regular expressions with backtracking anywhere — subjects are attacker-controlled and the repo
carries a ReDoS audit.

The guard is deliberately **over-inclusive**. INV-2's asymmetry is not a preference: a false
positive permanently destroys trust in sweep, a false negative costs one row and one swipe.

### 2.4 The seen mark is a count, and nothing is inferred

`seen[bundleKey]` is how many rows from the top have been on screen. One number that is
simultaneously the divider position, the promise ("everything above this line"), and the request
payload — computed once, so the control's label cannot overstate its scope. That is what replaces
the confirmation dialog (§1.3, INV-9b).

It advances from exactly one observable fact: an `IntersectionObserver` reports a row ≥75%
visible. Never scroll speed, never dwell time (INV-9d). It is monotonic while a bundle is open;
the draggable divider is the one thing that can move it back, which is the point of INV-9c.

The server does no inference of its own. `POST /:key/sweep` requires `seenIds` explicitly and
never defaults it — an omitted field is a 400, not "clear everything". The unsafe sweep that makes
a confirmation dialog necessary is unrepresentable.

---

## 3. Retention tiers

| Tier | Stored as | Survives |
|---|---|---|
| Seen | nothing — the absence of the others | no |
| Keep | `plugin_annotations.bundles.keepUntilSweep` | until `sweepCount` passes it |
| Pin | `messages.is_starred` (IMAP `\Flagged`) | always |

**Pin is the star.** §2's comparison table already promises "starred mail survives a sweep"; a
star is real IMAP state, so a pin outlives this project exactly as INV-19 demands of bundle
membership; and it costs no new storage, no migration and no new gesture. §1.5's complaint about
Spark is that read pins get *hidden* — a rendering bug, fixed in the renderer, not a reason for a
second flag.

**Keep decays in sweeps, not days.** "Survives the next 3 sweeps" is a promise about the user's
own actions and is therefore predictable in a way "3 days" is not. `KEEP_DECAY_SWEEPS` cannot be
made unbounded: every config value is parsed through `clampInt`, which routes anything non-finite
to the default, so "unlimited" has no representation at all (INV-21b).

Auto-file on age (NTH-2) respects the same tiers and deliberately **does not advance the cursor** —
nothing the user did happened, so Keep decay must not move.

---

## 4. Configuration

Environment variables only. No settings screen, no rules UI (INV-21, INV-21a, AV-8).

| Variable | Default | Bounds |
|---|---|---|
| `BUNDLES_ROW_BUDGET` | 7 | 4–20 |
| `BUNDLES_KEEP_DECAY_SWEEPS` | 3 | 1–10, never unbounded |
| `BUNDLES_AUTOFILE_AGE_DAYS` | 7 | 1–90, never unbounded |
| `BUNDLES_MIN_GROUP_SIZE` | 3 | 2–10 |
| `BUNDLES_UNDO_WINDOW_SECONDS` | 10 | 5–60 |
| `BUNDLES_NEVER_BUNDLE` | *(empty)* | ≤50 entries |

`BUNDLES_NEVER_BUNDLE` is the manual override list (INV-4) — comma-separated addresses or bare
domains, e.g. `alerts@bank.com,vendor.com`. A domain covers a sender that rotates its local part,
which is what keeps the list at the 5–10 entries the spec expects. The 50 cap is a smell alarm,
not a knob: past it the classifier is failing and the fix is the classifier.

Out-of-range values are clamped and logged rather than fatal — a typo in an env var must not take
the mail client down.

The plugin adds **no per-account settings**. Whether it runs is core's own per-user activation
(Settings → Plugins).

---

## 4a. Dry run — how to actually pass GATE 1

```yaml
environment:
  BUNDLES_DRY_RUN: "true"
```

With this set the classifier runs on every arrival and records its verdict, and **nothing is written
to the mail server**: no folders created, no messages copied, no messages deleted, no auto-filing.
Sweep, undo and the start-from-zero migration all refuse with `dry-run` rather than silently doing
nothing — a control that reports success while changing nothing teaches the user to distrust it.

The variable is parsed to fail safe, which is the opposite of every other constant here: setting it
to anything at all turns the dry run **on**, and only `false`/`0`/`no`/`off` turns it off. A strict
`=== 'true'` would leave `BUNDLES_DRY_RUN=ture` silently writing to the mailbox, and that is the
expensive direction to be wrong in.

Because there are no folder copies, there is nothing for the bundle UI to read — the inbox looks
exactly like stock MailFlow. In its place the `message-list-top` slot renders the **dry-run report**:
a collapsed line ("23 of 68 would be bundled"), expanding to every message that would have been
bundled, with its sender, subject, and the rule that decided it. The same data is available as JSON
at `GET /api/bundles/dry-run?accountId=…`.

That report is the GATE 1 instrument, and it exists because the gate is a 14-day observation, not a
test run:

- [ ] Corpus test: 0 never-bundle-set messages misclassified (S-6)
- [ ] Corpus test: 0 security, financial, or transactional messages bundled (S-7)
- [ ] **14 consecutive days live with 0 violations of S-6 and S-7**

Scan the list for anything that does not belong — mail from someone you correspond with, or anything
about security, money or a transaction. Those are the two pass/fail metrics, and one violation
resets the 30-day clock. Mail the classifier left alone is deliberately not listed: leaving bulk mail
loose costs one row and one swipe (INV-2), and is not a gate failure.

Both directions of a wrong verdict point at a named rule, so a fix is usually one line in
`guards.js` or one entry in `BUNDLES_NEVER_BUNDLE`. Only remove `BUNDLES_DRY_RUN` once the list has
been clean for 14 days.

## 5. Setup dependencies

Two things must be true or the build underperforms in ways that look like bugs.

### 5.1 Turn on categorization

`email_accounts.categorization_enabled` defaults to **false** (migration 0023). With it off,
`category` is NULL for every message and the classifier falls back to bulk headers alone — so
everything bulk lands in **Newsletters** and Promotions, Notifications and Social stay
permanently empty.

`GET /api/bundles` reports this as `categorizationEnabled`, and the sync tick logs a warning, so
it is discoverable rather than mysterious. Enable it in the account's settings.

### 5.2 Map the Sent folder if it has an unusual name

The never-bundle set is derived by scanning threads the client has sent into. Finding those
threads needs the Sent folder's path. `email_accounts.folder_mappings` defaults to `{}` and
account creation never populates it, so in practice a fallback list does the work — it covers the
common English names plus localized ones (Gesendet, Envoyés, Elementos enviados, Отправленные, …).

If the server calls it something else, set `folder_mappings.sent`. A scan that finds no sent
threads logs a warning rather than silently producing an empty exemption list, because an empty
exemption list is exactly what bundles a correspondent's mail (S-6).

Note this only narrows *which threads are scanned*. Whether a row is outbound is decided by
**sender** (is it one of the account's own addresses?), never by folder, so a wrong folder guess
can never cause the client's own copies to be counted as correspondents.

---

## 6. Two sync-engine behaviours worth knowing

Both were found by reading core against the design, and both are handled inside the plugin.

**A reply sent from MailFlow is a thread of one.** `imapManager.upsertSentMessageRecord` stamps
the sent row's `thread_id` with its *own* Message-ID; `thread_key` is
`COALESCE(thread_id, id::text)`; and later syncs `COALESCE` onto the existing value, so it is
permanent. The convergence repair excludes the row via `AND message_id != $3`. A thread-walk from
such a message can therefore never reach the person being replied to.

`onSentMessage` reads the sent row's **To/Cc** instead, which sidesteps this entirely and is
anyway the more literal reading of INV-4. Fixing it properly in core would mean calling
`computeThreadId` inside `upsertSentMessageRecord` — a sync-engine change, outside this fork's
budget and blast radius.

**Mail synced from IMAP threads correctly**, because that path runs `computeThreadId` over
`In-Reply-To` / `References`. So the periodic scan does work over historical Sent mail; it is only
newly-sent-from-MailFlow replies that need the send-time path.

---

## 7. What is not built

| Spec item | Status |
|---|---|
| Phase 0 (unsubscribes, aliases, 7-day GTD trial, go/no-go) | Client work, no code |
| Phase 6 — row-budget grouping, Inbox's category set | **Not built.** Needs a `categorize` action in `inboxRules.js` (core) and dynamic categories. `ROW_BUDGET` and `MIN_GROUP_SIZE` are wired and returned by the API so it can land without re-plumbing. |
| Phase 7 — offline cache, action queue, web push | **Not built.** NTH-4/NTH-8, and a large separate concern. |
| NTH-1 — scheduled bundle delivery | **Not built.** Promote to MUST if S-5 or S-9 are missed. |
| NTH-3 — date-group sweep affordance | **Not built.** The bundle-header control covers the same need; the Today/This week headers stay upstream's. |
| §9 — LLM digest | Parked by the spec. Gated on Phase 1. |

Phase 5's inline rendering **is** built, though K-3 says to stop before it if Phases 2–4 satisfy
§3 for 30 days. That judgement needs 30 days of the client's real usage, which no amount of code
can substitute for. The rendering is one slot contribution plus one list transform, so if the
answer turns out to be "Phases 2–4 were enough", deleting it is deleting a registration.

Every §3 metric except S-11 and S-12 is a behavioural measurement over 30 days of real mail. The
gates the code *can* satisfy are satisfied: S-12 is 47 lines, and GATE 1's corpus assertions run
in CI.

---

## 8. Running the gates

```bash
cd backend  && npm test && npm run lint && npm run lint:plugins
cd frontend && npm test && npm run lint && npm run build
```

GATE 1's corpus test (S-6, S-7) runs as part of the backend suite against a committed fixture
corpus weighted toward the cases that actually broke in Spark. To run it against real mail —
the spec's 500 hand-reviewed messages:

```bash
BUNDLES_CORPUS_PATH=~/corpus.json npx vitest run src/plugins/bundles/corpus.test.js
```

The file is a JSON array of records:

```json
[{
  "from": "security-noreply@vmware.com",
  "subject": "VMSA-2026-0011: CRITICAL vCenter Server vulnerability",
  "is_bulk": true,
  "category": "newsletter",
  "truth": "inbox",
  "sensitive": true,
  "correspondent": false
}]
```

`truth`, `sensitive` and `correspondent` are the hand review. The harness asserts zero S-6 and
zero S-7 violations, zero messages whose truth is `inbox` that got bundled, and — the
counterweight — that at least 80% of what *should* bundle actually does. Without that last one, a
guard tuned until nothing bundles would pass every other assertion and deliver nothing.
