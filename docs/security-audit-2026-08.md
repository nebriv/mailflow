# MailFlow security audit — pre-publication review

**Date:** 2026-08-16
**Commit reviewed:** `d917340`
**Scope:** whole application, weighted toward the unauthenticated attack surface, SSRF into the
host's own network, and disclosure of mailbox contents.
**Method:** manual source review of the full backend route/service tree, the frontend render and
cache paths, the deployment manifests, and the CI workflows. Several findings were confirmed by
executing the relevant module in isolation rather than by reading alone; those are marked
**verified**.

---

## Reachable without a session

Before the findings, the complete list of what an anonymous client can touch. Everything else is
behind `requireAuth` / `requireAdmin`, and that coverage was checked route by route.

| Surface | Notes |
| --- | --- |
| `POST /api/auth/register` | gated on `registration_open` / invite — **except for the first user**, see H3 |
| `POST /api/auth/login`, `/2fa/*`, `/forgot-password`, `/reset-password` | rate-limited per IP |
| `GET /api/auth/registration-status`, `/api/auth/invite/:token` | invite tokens are 32 random bytes; not brute-forceable |
| `GET /api/auth/oidc/providers` | provider names/slugs only |
| `GET /auth/oidc/:slug/start`, `/callback` | outside the `/api` CSRF gate by design |
| `GET/POST /oauth/microsoft*` | each handler checks `req.session.userId` itself |
| `*` `/carddav/**`, `/.well-known/carddav` | HTTP Basic against `users` — **see H1** |
| `GET /api/health`, `/api/version`, `/api/update` | version is disclosed pre-auth (fingerprinting) |
| `WSS /ws` upgrade | origin-checked against `APP_URL`, then session-checked |

---

## Findings

### H1 — CardDAV Basic auth bypasses the admin's MFA policy

`backend/src/routes/carddav.js:99-106`

The CardDAV gate refuses only accounts that have TOTP enrolled:

```js
if (user.totp_enabled) {
  return res.status(403) ... 'CardDAV requires an app-specific password.'
}
```

It never reads `mfa_enforcement`. That setting is consulted in exactly one place —
`routes/auth.js:290` — so it governs the web login and nothing else.

The gap is the email-OTP user. When an admin sets MFA to `required`, a user with a
`recovery_email` and no authenticator app is served an emailed code at web login
(`auth.js:306-317`) and never sets `totp_enabled`. That same account authenticates at
`/carddav/` with username and password alone, and gets full read/write on its address book:
every contact, email address, phone number, and photo the instance holds for that user.

So on an instance where MFA is nominally mandatory, a single stolen or sprayed password is
enough to pull the contact database. `/carddav` also sits outside the `/api` screen-lock gate
(`index.js:151`), so a locked session's password still works there.

**Fix:** read `mfa_enforcement` in `cardavAuth` and refuse Basic auth whenever it is `required`
(not just when `totp_enabled`), until app-specific passwords exist.

---

### H2 — SSRF host guard misses the canonical IPv4-mapped IPv6 form — **verified**

`backend/src/services/hostValidation.js:30-52`

`isPrivateIPv6` carries this comment:

```js
// IPv4-mapped IPv6 (::ffff:x.x.x.x) — check the embedded IPv4 address.
// Without this, ::ffff:127.0.0.1 bypasses the IPv4 private-range checks.
if (h.startsWith('::ffff:')) {
  const embedded = h.slice(7);
  if (isIPv4(embedded)) return isPrivateIPv4(embedded);
}
```

The check is defeated by the URL parser that runs before it. Every caller does
`new URL(...)` and passes `.hostname` to `validateHost`, and WHATWG canonicalization rewrites
the dotted form into hex:

```
new URL('https://[::ffff:127.0.0.1]/').hostname  →  '[::ffff:7f00:1]'
```

`'7f00:1'` is not a dotted-quad, `isIPv4` returns false, the branch falls through, and the
address is allowed. Measured against the live module:

```
blocked   "::ffff:127.0.0.1"              (raw literal — the form the guard expects)
*ALLOWED* "::ffff:7f00:1"                 (same address, canonical form)
*ALLOWED* "0:0:0:0:0:ffff:127.0.0.1"      (canonicalizes to the above)
```

Same walk turned up further gaps in the same function:

| Allowed | Should be blocked |
| --- | --- |
| `fe90::`, `febf::` | link-local is `fe80::/10`, the check is `startsWith('fe80')` |
| `fec0::/10` | site-local |
| `64:ff9b::/96` | NAT64 — embeds an arbitrary IPv4 |
| `::` | unspecified |
| `224.0.0.0/4` | multicast (SSDP `239.255.255.250` — a home-lab discovery target) |
| `192.88.99.0/24` | 6to4 relay anycast |

The pieces that *are* solid: the decimal/octal/hex IPv4 tricks (`2130706433`, `0177.0.0.1`,
`0x7f000001`) are all normalized to `127.0.0.1` by the URL parser and correctly blocked, and
`safeFetch`'s connector re-validates every redirect hop and pins the socket to a checked IP.
The defect is in the address classifier itself, which both layers share.

**Reachable how.** The strongest path starts with an inbound email, i.e. from anyone who knows
the address:

```
List-Unsubscribe: <https://[::ffff:7f00:1]:8006/api/v2/...>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

`POST /api/mail/messages/:id/unsubscribe` (`routes/mail.js:2062`) validates the host, finds it
acceptable, and issues the request. Same classifier also backs `POST /api/auth/push/subscribe`
and OIDC discovery.

Two honest caveats on impact. The unsubscribe path requires `https://`, so a plaintext internal
service will fail at TLS — this is a blind connect/port-probe primitive against the LAN more
than a full request forgery. And it needs one click on the Unsubscribe button. Reaching an
IPv4-mapped address also needs an AF_INET6-capable host; the guard is bypassed regardless, but
this container has no IPv6, so I could not demonstrate the completed connection here.

**Fix:** normalize to a canonical byte form before classifying — parse with `net.isIP`, expand,
and range-check the 16 bytes — instead of string-prefix matching. Add the ranges in the table.

---

### H3 — First registrant on a freshly published instance becomes admin

`backend/src/routes/auth.js:135-186`

`registration_open` and `internal_auth_disabled` are only consulted inside `if (!isFirstUser)`.
With zero rows in `users`, `POST /api/auth/register` is fully open and the account created is
`is_admin = true`.

This is the specific thing that bites when publishing: if DNS/port-forward goes live before
you have registered, whoever finds the host first owns the instance — and admin on this
instance means the OIDC provider config, the system SMTP credentials, the AI provider base URL,
and the ability to invite.

**Fix:** either bind the bootstrap to a one-time `SETUP_TOKEN` from the environment, or refuse
non-loopback registration until the first user exists. As an operational workaround: bring the
instance up on localhost, register, *then* expose it.

---

### M4 — Password login has no per-account rate limit

`backend/src/routes/auth.js:95-108`, `:229`

The limiter is keyed on `auth:${req.ip}` only. The codebase does implement per-user buckets
where it matters elsewhere — `totp:${uid}` at `:356`, `unlock:${userId}` at `:652`, with a good
comment at `:640` explaining exactly why — but `POST /api/auth/login` has no equivalent. Ten
attempts per IP per 15 minutes is no constraint on an attacker with a botnet or a rotating
proxy pool targeting one known username.

**Fix:** add a `login:${username}` bucket alongside the IP bucket, cleared on success.

---

### M5 — No password strength requirement at registration

`backend/src/routes/auth.js:110-124`

`/register` validates the *username* (length 1-120, no control characters) and then hashes
whatever password arrives. A one-character password is accepted. `/reset-password:1085`
requires at least 8 characters — so the same account can be created weaker than it can be
reset. Combined with M4 this is the most likely route to a compromised account on a public
instance.

---

### M6 — `trust proxy: 1` mis-attributes the client IP behind a second proxy — **verified**

`backend/src/index.js:58`

The bundled nginx is correct: it sets `X-Forwarded-For: $proxy_add_x_forwarded_for`, appending
the real peer, and Express with `trust proxy: 1` reads that last entry. Spoofing an
`X-Forwarded-For` header through the bundled stack does **not** work. Confirmed against
`proxy-addr`:

```
1 proxy (bundled nginx):  203.0.113.5    ← real client, correct
2 proxies (CDN → nginx):  104.16.0.1     ← the CDN edge, not the client
```

The second row is the common home-lab shape — Cloudflare Tunnel, Traefik, or an existing
reverse proxy in front of `docker-compose.proxy.yml`. Every request then shares one rate-limit
bucket per edge IP. With the default 10 attempts / 15 minutes that is a trivial lockout of all
users from one attacker, and the throttle stops meaning anything. `logAuthEvent` records the
same wrong IP, so the audit trail points at the CDN.

**Fix:** make the hop count configurable (`TRUST_PROXY_HOPS`, default 1) and document that it
must match the real chain depth.

---

### M7 — `forgot-password` relays through an admin's SMTP account, and leaks account existence by timing

`backend/src/routes/auth.js:1031-1065`

When no system SMTP is configured, the reset mail falls back to
`WHERE ea.enabled = true AND ea.smtp_host IS NOT NULL AND (ea.user_id = $1 OR u.is_admin = true)`.
So an unauthenticated request can make the server authenticate to an admin's real mailbox and
send on their behalf — the message lands in the admin's Sent folder and consumes their
provider's quota.

The endpoint also always returns `{ok:true}`, but only the hit path runs discovery, TLS, SMTP
auth and `await transport.sendMail(...)` (`:1065`) before responding. The miss path returns
immediately. The latency difference is a clean oracle for "is this address a registered
recovery address."

**Fix:** queue the send and respond immediately on both paths; drop the admin-account fallback
or make it opt-in.

---

### L8 — Screen lock is only enforced under `/api`

`backend/src/index.js:151-156`. The 423 gate is mounted at `/api`, so a locked session still
reaches `/oauth/microsoft*`, `/auth/oidc/:slug/start?action=link`, and `/carddav`. Enough to
link an OAuth account or read contacts while the screen shows the PIN prompt.

### L9 — `/api/contacts/photo` reflects a stored Content-Type

`backend/src/routes/contacts.js:130-136`. The MIME type is taken from the stored `data:` URI —
which arrives from a CardDAV `PUT` or a synced vCard — and set as the response header
verbatim. Mitigated by the global `X-Content-Type-Options: nosniff` and by nginx's
`script-src 'self'`, so it is hardening, not a live XSS. Pin it to an image allowlist.

### L10 — `react-router` advisories in the frontend

`npm audit` (production deps): 2 moderate on `react-router` ≤ 7.17.0 — open redirect via
backslash in `<Link>`/`useNavigate`, plus an SSR-hydration issue that does not apply to this
SPA build. `npm audit fix` clears both. The backend has **0** vulnerabilities across all
dependency tiers.

### L11 — `allowVulnerableTags: true` with `<style>` allowed

`backend/src/services/emailSanitizer.js:224-234`. Safe as shipped: email HTML renders in an
iframe whose `sandbox` deliberately omits `allow-scripts`, under a `script-src 'none'` meta CSP
and nginx's `script-src 'self'`. Worth flagging only because the `VITE_EMAIL_DIV_RENDER=true`
build (`MessagePane.jsx:2793`) renders that same HTML into the application DOM with
`dangerouslySetInnerHTML`, where the sandbox no longer applies. Keep that flag off in
production.

### L12 — OIDC link flow is outside the CSRF gate

`/auth/oidc/:slug/start?action=link` mutates `req.session.oidcPending` on a GET and is mounted
outside `/api`. Exploiting it requires the attacker to control the victim's IdP session, so
this is low, but the link flow deserves a CSRF token.

### L13 — Token-endpoint error body logged verbatim

`backend/src/routes/oidc.js:354` logs the full OIDC token response body on failure.

---

## What is already solid

Worth stating explicitly, because it is where an audit usually finds problems and this one did
not:

- **SQL.** Every query is parameterized. The four sites that interpolate an identifier
  (`accounts.js:245`, `db.js:75`, `imapManager.js:1544`, `mail.js:187`) build it from a fixed
  allowlist or an internal constant. No injection found.
- **Authorization.** Ownership is enforced by joining `email_accounts a ON ... WHERE a.user_id
  = $2` on every message-scoped route. No IDOR found across `mail.js`, `search.js`, `draft.js`,
  `send.js`, `contacts.js`, or the plugin routers.
- **Session handling.** `req.session.regenerate()` on every privilege transition — password
  login, TOTP, email OTP, enrollment, and all three OIDC provisioning paths. Redis-backed, with
  a full session sweep on password reset.
- **Credentials.** AES-256-GCM with a distinct IV per value and an auth tag; `ENCRYPTION_KEY`
  validated at boot and the process exits without it. Logs use `redactEmail` / `logAccount`.
- **Auth hardening.** Constant-time dummy bcrypt compare on the miss path, TOTP replay guard in
  Redis, atomic `DELETE ... RETURNING` consumption of reset tokens, advisory locks around the
  first-user and invite races.
- **Outbound requests.** `safeFetch` validates every redirect hop and pins the socket to a
  checked IP; `senderFavicon` is locked to a fixed origin with `redirect: 'error'`, a PNG
  signature check, and a size cap.
- **Email rendering.** Iframe without `allow-scripts`, `<base target="_blank">`, external
  `url()` stripped from `<style>` blocks, remote images blocked at response time without
  polluting the cached body.
- **Offline cache.** Bounded, excludes attachments and any remote-image variant, and cleared on
  the `user → null` transition so it cannot outlive the session.
- **CI.** No `pull_request_target`, no untrusted input interpolated into `run:` steps.

---

## Suggested order

1. **H3** before the host is publicly resolvable — it is the only finding that is a race you
   can lose exactly once.
2. **H1** and **H2** — both are small, contained patches.
3. **M5** then **M4** — cheapest real reduction in account-takeover risk on a public instance.
4. **M6** if anything sits in front of the bundled nginx.
5. **M7**, then the L items.
