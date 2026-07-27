# Common Clearing — Design

**Date:** 2026-07-27
**Status:** Approved (Part 1 and Part 2, with amendments)

## 1. What this is

Common Clearing matches what people have against what people want, using a
human-curated concept vocabulary rather than an algorithm.

Members submit offers ("I have a tent I can lend out") and requests ("looking for
somewhere to sleep") as free text. The engine recognises phrasings it already knows and
binds them to concepts. Phrasings it does not recognise surface for members to judge. All
semantic decisions — is this phrasing that concept, does this offer answer that request —
are made by members, never by a model.

Its first deployment serves The Borderland 2026, but the tool is general.

## 2. Deliverables

| # | Deliverable | Location |
|---|---|---|
| 0 | Development environment | this machine |
| 1 | `commonclearing` — Rust core, engine, REST/WS API, CLI | `theborderland/commonclearing` |
| 2 | Web frontend — three runtime modes from one codebase | same repo, `web/` |
| 3 | npm: Node bindings | `@theborderland/commonclearing` |
| 4 | npm: browser embed library | `@theborderland/commonclearing-embed` |
| 5 | theglobalburn PR — Library page, API keys page, JWT changes | `hermesloom/theglobalburn` |
| 6 | Fly deployment + transcript cron | Fly org `the-borderland-267` |
| 7 | Project website | `commonclearing.org` |

Repo is **public**. All GitHub and npm assets live under **theborderland**.

## 3. Architecture

Rust workspace:

| Crate | Responsibility |
|---|---|
| `cc-core` | Domain logic: concepts, phrasings, offers, requests, votes, connections, thresholds. Pure — no I/O, no HTTP. Depends only on a `Store` trait. |
| `cc-store` | oxigraph wrapper: vocabulary constants, SPARQL, quad read/write |
| `cc-api` | axum 0.8 REST + socketioxide 0.18 WebSockets, JWT auth middleware, notification dispatch |
| `cc-cli` | binary `commonclearing serve`; config loading; static assets embedded via `rust-embed` |
| `cc-node` | napi-rs bindings → deliverable 3 |

Plus `web/` (frontend) and `packages/embed/` (deliverable 4).

`cc-core` must not know about oxigraph or HTTP. Threshold and vote-counting logic is where
correctness matters most, and it should be testable without a store or a server.

### Dependencies

| Crate | Version | Role |
|---|---|---|
| `axum` | 0.8 | HTTP |
| `socketioxide` | 0.18 | WebSockets — reconnection, long-polling fallback, rooms |
| `oxigraph` | 0.5 | embedded quad store |
| `jsonwebtoken` | 11 | RS256 verification |
| `lettre` | 0.11 | SMTP |
| `web-push` | 0.11 | VAPID push |

`web-push` was last released February 2025. The Web Push protocol is frozen so staleness is
tolerable, but it is the least-maintained dependency in the stack and may need vendoring.
Email being the default channel bounds the impact.

## 4. Data model

Namespace `cc:` = `https://commonclearing.org/ns#`. Standard vocabularies are used wherever
they exist; custom predicates only where they do not.

### Concepts and phrasings — SKOS

```turtle
cc:concept/tent  a skos:Concept ;
    skos:prefLabel "tent"@en ;
    skos:altLabel  "tält"@sv , "zelt"@de , "shelter for two"@en .
```

Merging asserts `skos:altLabel` (phrasing belongs to concept) or `skos:exactMatch` (two
concepts are the same).

### Offers and requests — schema.org

```turtle
cc:offer/a1b2  a schema:Offer ;
    schema:itemOffered cc:concept/tent ;
    cc:rawText "I have a tent I can lend out" ;
    cc:submittedAt "2026-07-27T09:00:00Z"^^xsd:dateTime .
```

`schema:Demand` for requests.

### Attribution is the fourth element

Every quad is written into the asserting user's named graph, `cc:user/<sha256(email)>`.
Groups get an IRI in the same namespace, so "individual or group" needs no special-casing.

A vote is therefore not a separate entity. Swiping yes writes one quad into *your* graph:

```
(cc:offer/a1b2, cc:matches, cc:request/c3d4, cc:user/9f8e…)
```

The count is `COUNT(DISTINCT ?g)` over that triple across all graphs. Five members having
independently written it *is* five matches. Double-voting is impossible by construction:
writing the same quad twice is a no-op in a set of quads.

### Connections

At threshold the engine writes to the system graph `cc:graph/system`:

```turtle
cc:connection/e5f6  a cc:Connection ;
    cc:offer cc:offer/a1b2 ; cc:request cc:request/c3d4 ;
    cc:establishedAt "…"^^xsd:dateTime .
```

Metadata added by the two parties is further relations on that node, written into their own
graphs — so provenance is automatic and the metadata editor is a generic quad editor scoped
to one subject.

### User properties

Per-user state (dismissed install banner, notification channel) is a quad in the user's own
graph. No side table.

## 5. The clearing engine

1. Member submits free text.
2. Engine normalises (lowercase, trim, collapse whitespace) and matches spans **exactly**
   against known `skos:prefLabel`/`skos:altLabel`.
3. Recognised spans bind the offer/request to concepts. Unrecognised spans become floating
   phrasings — the population the nerd view renders.
4. Members judge pairs (§6). Merges apply immediately; matches accumulate.
5. At 5 distinct graphs asserting `cc:matches` → connection created → notification sent.

### Thresholds

| Pair type | Threshold | Rationale |
|---|---|---|
| `offer × request` → connection | 5 distinct graphs | A match creates an obligation between two people. |
| `phrasing × concept` → merge | 1, attributed | Merging is janitorial ("tält" is Swedish for "tent"). Gating it behind 5 votes would leave the board clogged with obvious duplicates nobody confirms five times. Attribution makes it auditable and reversible. |

### Embeddings

Each novel string is embedded once via OpenAI and cached forever (the string never changes).
The vector determines **only the x/y coordinate on the nerd view**. It writes no `skos:`
quad and never decides a merge.

Projection is **PCA**, not UMAP or t-SNE. The reason is stability, not quality: t-SNE and
UMAP are stochastic and re-lay-out everything when points are added, destroying the spatial
memory members build up between visits. PCA is deterministic and incremental — existing
points stay put. Clusters separate less crisply, compensated for by showing
cosine-nearest neighbours on hover, which uses the full-dimensional vector rather than the
lossy 2D one and is the actual merge affordance anyway.

## 6. One judging queue

There is no separate merge interface. Merging and matching are the same gesture on a
discriminated pair:

- `kind: "match"` — an offer and a request, side by side. "Should these connect?"
- `kind: "merge"` — either a phrasing and a concept ("does this phrasing mean this?", asserts
  `skos:altLabel`) or two concepts ("are these the same thing?", asserts `skos:exactMatch`).

Same card, same swipe, different threshold. The home screen offers four actions:
**match · submit offer · submit request · connections**.

The server issues each pair with a short-lived `pairId` that identifies both sides, so
`POST /judge` carries an opaque id plus a verdict rather than the client naming IRIs
directly. This keeps the client from asserting arbitrary quads.

## 7. Authentication

Modelled on REA, with two corrections.

Common Clearing holds no credentials. It fetches theglobalburn's JWKS
(`/api/auth/jwks`), caches it with hourly refresh, and verifies RS256. The user IRI derives
from the `email` claim.

**Corrections to the REA pattern:**

1. **Validate `exp`.** REA calls `Joken.verify`, which checks only the signature, so a
   leaked token stays valid indefinitely. We validate `exp`, `iss`, and `aud`.
2. **Gate on the specific burn.** REA's `hasMembership` claim names no burn — a member of
   any burn satisfies it. theglobalburn will add `burnSlug` and `projectId` claims, and we
   require `burnSlug == the-borderland-2026`.

### Session establishment

| Mode | Path |
|---|---|
| Embedded | Parent passes a fresh JWT on every load (`?token=`). Not cookie-dependent: in an iframe the cookie is third-party and Safari's ITP blocks it outright. |
| Browser / installed PWA | Member enters email, receives a 6-digit code. The frontend runs Supabase `signInWithOtp`/`verifyOtp` **directly** with the public anon key, then exchanges the resulting Supabase session at theglobalburn's existing `/api/auth/rea-token` for the RS256 JWT, and posts that to `POST /api/v1/auth/exchange`. |

Doing OTP client-side against Supabase avoids building a relay endpoint on theglobalburn
that would email a code to any address on request — a spam vector and a new authentication
surface. Supabase's own rate limiting and email templates apply, and the code members
receive is identical to the one they already get.

The only theglobalburn change needed is accepting a `Bearer` access token in addition to the
session cookie, since a cross-origin PWA has no cookie on that domain.

## 8. Frontend — three modes, one codebase

| Detection | Mode |
|---|---|
| `window.self !== window.top` | Embedded |
| `matchMedia('(display-mode: standalone)').matches` | Installed PWA |
| neither | Browser |

| Feature | Embedded | Browser | PWA |
|---|---|---|---|
| Four-action home | ✓ | ✓ | ✓ |
| Nerd-view toggle (floating, top right) | ✓ | ✓ | ✓ |
| Install banner (dismissible → quad in user's graph) | ✓ | — | — |
| OS-detected setup instructions | — | first visit | — |
| Own login (email + 6-digit code) | — | ✓ | ✓ |
| Notification settings (top right) | — | — | ✓ |

Constraints:

- **Service worker registers only when not embedded.** Useless in an iframe, and it
  conflicts with the real registration.
- **The point-cloud renderer is a lazy chunk.** It is the heaviest dependency and the
  embedded UI must stay slim — the iframe pays for it only when the toggle is tapped.
- **Speech input** uses the Web Speech API. The microphone button is not rendered when
  `SpeechRecognition` is unavailable rather than shown and failing.

### Notifications

Email is the default and the only channel for members who never install the PWA. The
settings wheel appears only in standalone mode, so a member who cannot receive push is never
offered it. Email must therefore be genuinely useful: name the offer, name the request, and
link directly into the connection view.

## 9. API

REST under `/api/v1`, session cookie or `Bearer`:

```
POST /auth/exchange          theglobalburn JWT → cc session
GET  /me
POST /offers                 { text }
POST /requests               { text }
GET  /judge/next             → { kind: "match"|"merge", left, right }
POST /judge                  { pairId, verdict }
GET  /connections
GET  /connections/:id
POST /connections/:id/metadata
GET  /cloud                  points: { id, text, x, y }
GET  /settings
PATCH /settings
POST /push/subscribe
GET  /public/library/:key    read-only, for the embed library
```

Socket.IO at `/ws`, room `cloud`, events `point:new`, `point:merged`, `connection:new`.

## 10. npm packages

Published under the **`theborderland` npm organisation**; `sigalor` is the publishing
account. CI publishes with an automation token held as a GitHub Actions secret, so no
individual's credentials are needed for a release.

**`@theborderland/commonclearing`** — napi-rs bindings exposing the engine and server to
Node. Prebuilt binaries per platform via the standard napi GitHub Actions matrix.

**`@theborderland/commonclearing-embed`** — browser. `CommonClearing.init({ rootUrl, apiKey })`
where `rootUrl` is the *membership platform* root; the library discovers the clearing API
from a well-known endpoint there. Config resolves from `import.meta.env` / `process.env`
first and literal arguments second. The README states plainly that inlining a key in HTML is
not suitable for production.

## 11. theglobalburn PR

| Change | File |
|---|---|
| Library page — two columns, "What we have" / "What we want" | `app/burn/[slug]/library/page.tsx` |
| API keys page — generate/revoke | `app/burn/[slug]/api-keys/page.tsx` |
| Two menu entries | `app/burn/[slug]/layout.tsx` |
| Server-side proxy so the browser never calls the clearing API directly | `app/api/burn/[slug]/library/route.ts` |
| API key CRUD + migration | `app/api/burn/[slug]/api-keys/route.ts` |
| Add `burnSlug`/`projectId` claims; accept `Bearer` | `app/api/auth/rea-token/route.ts` |

Follows existing conventions: `requestWithProject` / `requestWithMembership` wrappers,
`ajv-ts` schemas, NextUI components, Ant Design icons, migrations with an
`update_updated_at_column()` trigger and no RLS (access enforced in the API layer).

**Revocation.** API keys are RS256 JWTs signed with the existing key, but a JWT cannot be
un-issued. Each carries a `jti`; theglobalburn stores it with a revoked flag; Common Clearing
polls a cached revocation list. Without this, "revoke" in the UI would be a lie.

## 12. Deployment

Fly org `the-borderland-267`, region `arn` (co-located with REA and the membership
platform).

- App `commonclearing`: **single machine + volume `cc_data` at `/data`, snapshots enabled
  explicitly** — they are not on by default. A volume binds to one machine in one region,
  so oxigraph cannot scale horizontally. Acceptable: the dataset is small and the
  availability requirement is modest.

  There is **one** running instance, serving The Borderland, on the single hostname
  `clearing.theborderland.se` — which is also the `aud` claim value. It lives on
  Borderland's domain because `required_burn_slug` scopes it to Borderland 2026
  memberships; it is their instance, not a general service.

  `commonclearing.org` therefore carries only the project website. There is deliberately no
  `app.` subdomain: it would present a login wall for an event most visitors are not members
  of. A future global instance that anyone can sign up to would need its own Fly app and its
  own identity provider — a separate deliverable, designed when wanted, not a DNS record.
- App `commonclearing-website`: static, same org.
- Multi-stage Dockerfile: Rust build + web build.
- Secrets: `OPENAI_API_KEY`, `SMTP_*` (shared with theglobalburn, per instruction), VAPID
  keypair.

Config file, every value overridable by environment variable:

```toml
[store]
path = "/data/oxigraph"

[server]
bind = "0.0.0.0:8080"
public_url = "https://clearing.theborderland.se"

[auth]
jwks_url = "https://members.theborderland.se/api/auth/jwks"
issuer = "theglobalburn"
audience = "https://clearing.theborderland.se"
required_burn_slug = "the-borderland-2026"

[engine]
match_threshold = 5

[embeddings]
provider = "openai"
```

### DNS

`commonclearing.org` via DNSControl against Cloudflare (`dns/`). Apex and `www` → website
via `ALIAS`/`CNAME` to `*.fly.dev`, so Cloudflare's flattening absorbs Fly IP changes. Null
SPF, `p=reject` DMARC and an empty DKIM wildcard make the domain unusable for spoofing,
since it sends no mail.

CAA authorises Let's Encrypt, which is what Fly provisions — but note that Cloudflare
synthesises additional `issue`/`issuewild` entries for its Universal SSL partner CAs
(comodoca.com, digicert.com, pki.goog, ssl.com) into DNS responses for any zone that has
CAA records. So issuance is restricted to those five plus Let's Encrypt rather than to Let's
Encrypt alone, and the `issuewild ";"` is defeated. Accepted deliberately; see
`dns/README.md`.

## 13. Transcript cron

Exports the design conversation to the repo on a schedule.

Pipeline: session JSONL → markdown → **scrub → verify → commit → push**.

The scrubber is the point of this deliverable, not the git plumbing. Because the repo is
public and the cron pushes unreviewed content:

1. Redact known credential shapes: Fly `fm2_`/`fo1_` macaroons, `sk-` API keys, JWTs, SMTP
   passwords, `-----BEGIN … PRIVATE KEY-----` blocks.
2. **Re-scan the output** and abort if anything still matches. A scrubber that errors must
   never fall through to `git push`.
3. `gitleaks` in pre-commit and CI as an independent second line.
4. Deploys run from CI with a GitHub Actions secret, so routine work never handles a token.

## 14. Testing

- `cc-core` is pure: unit tests against an in-memory store. The case that matters most is
  that the same member voting twice does not advance the count.
- `cc-store`: round-trip tests against a temporary oxigraph instance.
- `cc-api`: integration tests with a locally-minted JWKS so auth is genuinely exercised —
  including **expired-token rejection**, the bug REA has.
- Frontend: mode detection (embedded / browser / standalone) is the highest-risk logic
  because it gates the service worker and the settings UI.

## 15. Open items

| Item | Owner |
|---|---|
| Create `theborderland/commonclearing` on GitHub | needs API token or web UI |
| Cloudflare API token in `~/.config/commonclearing/dns.env` | user |
| Mailgun SMTP credentials (shared with theglobalburn) | user, via Vercel |
| Deploy Fly apps before `dnscontrol push`, or accept NXDOMAIN until then | — |

## 16. Deliberate non-goals

- **No algorithmic matching.** Embeddings position points on a board; they never write a
  quad. If a similarity score could create a merge, the human curation this system exists
  for would be undermined, and wrong merges would be invisible because a silent auto-merge
  produces no artifact to review.
- **No user database.** Identity comes from theglobalburn. Common Clearing stores
  attribution, not credentials.
- **No horizontal scaling.** One machine, one volume. Revisit only if the dataset outgrows
  it.
