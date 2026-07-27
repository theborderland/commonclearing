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

### Spans — Web Annotation Data Model

A concept is bound to a **union of character ranges** within an offer or request, not to the
whole text. Ranges may be disjoint. The W3C Web Annotation Data Model (`oa:`) covers this
exactly, so no custom vocabulary is invented:

```turtle
cc:span/x1 a oa:Annotation ;
    oa:motivatedBy oa:linking ;
    oa:hasBody cc:concept/tent ;
    oa:hasTarget [ a oa:Composite ;
        oa:item [ a oa:SpecificResource ;
                  oa:hasSource cc:offer/a1b2 ;
                  oa:hasSelector [ a oa:TextPositionSelector ; oa:start 7 ; oa:end 11 ] ,
                                 [ a oa:TextQuoteSelector ; oa:exact "tent" ] ] ,
                [ a oa:SpecificResource ;
                  oa:hasSource cc:offer/a1b2 ;
                  oa:hasSelector [ a oa:TextPositionSelector ; oa:start 24 ; oa:end 31 ] ] ] .
```

`oa:Composite` means "all of these together" — a true union, as opposed to multiple
selectors on one target, which the spec reads as alternative refinements of the same range.

Each range carries both a `TextPositionSelector` (offsets) and a `TextQuoteSelector` (the
literal text). The quote is redundant until offsets drift, at which point it is the only way
to recover the anchor.

Annotations live in the annotating member's named graph like everything else, so span
marking is attributed and reversible with no additional mechanism.

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

### Profile and contact details

Profile data lives in the member's own graph, like everything else. The vCard ontology
covers the standard fields; messaging handles have no standard vocabulary, so they take
`cc:` predicates:

```turtle
cc:user/9f8e… a vcard:Individual ;
    vcard:hasEmail      <mailto:someone@example.org> ;
    cc:discordHandle    "someone#1234" ;
    cc:signalNumber     "+46701234567" ;
    cc:whatsappNumber   "+46701234567" ;
    cc:shares           cc:contact/email , cc:contact/signal ;   # opt-in per detail
    cc:notifyVia        cc:channel/email ;
    cc:onboardingDone   true .
```

`cc:shares` is the checkbox state from the profile editor: which details a member is willing
to disclose when they choose to share with a connection. It is a *permission*, not an act —
nothing is transmitted until the member taps share on a specific connection (§8).

Storing contact details and the sharing policy in the same graph as everything else means no
separate profile store, and the member's own graph remains the single place their data lives.

### Concept descriptions — the Lexicon

Every concept may carry a `skos:definition`, editable by any member:

```turtle
cc:concept/tent skos:definition "A portable shelter of fabric over poles."@en .
```

Edits are attributed like all else — each member's wording sits in their own graph. Display
resolves to the **most recent** edit, with the author shown and prior versions readable. Not
a consensus mechanism: descriptions are documentation, not assertions about matching, so an
edit war costs clarity rather than correctness.

### User properties

Remaining per-user state (dismissed install banner) is likewise a quad in the member's own
graph. No side table anywhere.

## 5. The clearing engine

1. Member submits free text.
2. Engine normalises (lowercase, trim, collapse whitespace) and looks for **single words**
   that have **exactly one** candidate concept by `skos:prefLabel`/`skos:altLabel`.
3. Each such hit becomes a **proposal**, not an assertion — a `merge` pair in the judging
   queue. Text with no candidate becomes a floating phrasing, the population the nerd view
   renders. Words with more than one candidate are left alone; disambiguation is manual
   marking (§8), not a guess.
4. Members may also mark spans by hand (§8), creating or extending annotations directly.
5. Members judge pairs (§6). Confirmed merges apply immediately; matches accumulate.
6. At 5 distinct graphs asserting `cc:matches` → connection created → notification sent.

**Nothing the engine finds enters the vocabulary on its own.** A proposal is a queue entry
carrying `cc:proposedBy cc:engine` in the system graph; confirming it writes the
`oa:Annotation` into the confirming member's graph. This is what makes §1's claim — that
every semantic decision is a member's — literally true rather than aspirational.

### Recording judgements

Every judgement is recorded, affirmative or not. Without the negative case a rejected pair
would resurface forever, and `/judge/next` would have no way to know what a member has
already seen.

| Verdict | Quad written into the judge's graph |
|---|---|
| match yes | `(offer, cc:matches, request)` |
| match no | `(offer, cc:notMatches, request)` |
| merge yes | the `oa:Annotation` (§4) |
| merge no | `(span, cc:notRefersTo, concept)` |

"Already judged" is the union of both predicates. Only affirmatives count toward a
threshold. Idempotency still falls out of quad-set semantics — re-recording a judgement
changes nothing.

### Thresholds

| Pair type | Threshold | Rationale |
|---|---|---|
| `offer × request` → connection | 5 distinct graphs | A match creates an obligation between two people. |
| `span × concept` → merge | 1, attributed | Merging is janitorial ("tält" is Swedish for "tent"). Gating it behind 5 votes would leave the board clogged with obvious duplicates nobody confirms five times. Attribution makes it auditable and reversible. |

### Embeddings

Each novel string is embedded once via OpenAI and cached forever (the string never changes).
Vectors are used in exactly two places, both presentational: the x/y coordinate on the nerd
view, and the ranking of the "similar" block in the annotation dropdown (§8). They write no
`skos:` quad and never decide a merge.

Projection is **PCA**, not UMAP or t-SNE. The reason is stability, not quality: t-SNE and
UMAP are stochastic and re-lay-out everything when points are added, destroying the spatial
memory members build up between visits. PCA is deterministic and incremental — existing
points stay put. Clusters separate less crisply, compensated for by showing
cosine-nearest neighbours on hover, which uses the full-dimensional vector rather than the
lossy 2D one and is the actual merge affordance anyway.

## 6. One judging queue

There is no separate merge interface. Merging and matching are the same gesture on a
discriminated pair, distinguished only by the question asked:

| `kind` | Question | Sides | Effect |
|---|---|---|---|
| `match` | **"Does this fit together?"** | an offer and a request | 5 votes → connection |
| `merge` | **"Does this mean the same?"** | a span and a concept (asserts `skos:altLabel`), or two concepts (asserts `skos:exactMatch`) | 1 vote, attributed |

Both questions are answerable without documentation, and their parallel phrasing makes the
switch between pair types feel like one activity rather than two.

**Merge cards always show their source.** The span side is rendered highlighted inside the
full offer or request text it came from. Without that context the judgement is often
impossible — "shelter for two" against `tent` is ambiguous until you can see whether the
sentence was about camping or about housing someone.

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
| Five-action home | ✓ | ✓ | ✓ |
| Nerd-view toggle (floating, top right) | ✓ | ✓ | ✓ |
| Profile menu (top right) | ✓ | ✓ | ✓ |
| Push as a notification channel | — | — | ✓ |
| Onboarding (first run) | ✓ | ✓ | ✓ |
| Install banner (dismissible → quad in user's graph) | ✓ | — | — |
| OS-detected setup instructions | — | first visit | — |
| Own login (email + 6-digit code) | — | ✓ | ✓ |

Home actions: **match · submit offer · submit request · connections · lexicon**. Profile
lives in the top-right menu rather than on the home grid — it is visited rarely and would
dilute the four actions that constitute the actual work.

This supersedes the earlier rule that notification settings appear only in standalone mode.
The menu is present everywhere, because the email/push choice is meaningful in every mode;
what varies is that **push is offered only where it is actually available**, so a member who
cannot receive it is never shown a setting that would silently do nothing.

Constraints:

- **Service worker registers only when not embedded.** Useless in an iframe, and it
  conflicts with the real registration.
- **The point-cloud renderer is a lazy chunk.** It is the heaviest dependency and the
  embedded UI must stay slim — the iframe pays for it only when the toggle is tapped.
- **Speech input** uses the Web Speech API. The microphone button is not rendered when
  `SpeechRecognition` is unavailable rather than shown and failing.

### Marking spans

Open to **all members**, not gated behind a role — consistent with everything else members
do here. A `annotation.restricted_to_role` config flag exists so it can be narrowed later
without a migration.

The interaction is text-marker style: select characters in an offer or request the way you
would with a highlighter, including **disjoint selections** (shift/ctrl-extend on desktop,
tap-to-add on touch). Releasing the selection opens a dropdown immediately, ranked:

1. **Exact** — concepts whose `prefLabel`/`altLabel` normalises to the selected text. Marking
   "tent" or "tält" surfaces `cc:concept/tent` at the top, alongside every other concept
   recorded as reasonably referred to by that string.
2. **Similar** — concepts whose labels are cosine-near the selection, visually separated from
   the exact block so the distinction stays legible.
3. **Create new concept…** — always last, always an explicit choice.

Creating a concept is never implicit. An interface that manufactures a concept at typing
speed would work directly against the deduplication the whole system exists to perform:
every typo would become a permanent concept and the board would fill with near-duplicates.

Embeddings rank block 2 but decide nothing — the member picks. This is the second and last
place embeddings appear, and like the nerd-view layout it writes no quad (§16).

### Lexicon

A browsable index of every concept, reachable from the home screen. Each entry shows its
`skos:prefLabel`, all `skos:altLabel`s, its `skos:definition`, and how many offers and
requests currently reference it.

**Any member can edit a description.** No role, no threshold — descriptions are documentation
rather than assertions that drive matching, so the cost of a bad edit is confusion, not a
wrong connection. Edits are attributed and previous versions remain readable.

The term "lexicon" is used rather than "glossary" or "dictionary" because the thing being
catalogued is the set of ways members express meanings, which is precisely what a lexicon is.

### Profile and onboarding

The profile editor holds contact details — email, Discord handle, Signal number, WhatsApp
number — each with a checkbox controlling whether it is *eligible* to be shared. Checking a
box grants permission; it transmits nothing. It also holds the notification channel, with
push offered only when the browser actually supports it and permission has been granted.

**Onboarding** runs once, on first visit, and exists to solve one problem: a member with no
contact details who matches with someone has no way to be reached. It offers their
membership-platform email as a default contact method, addable with a single tap, and is
**skippable** — skipping sets `cc:onboardingDone` immediately and never asks again. The flag
is a quad in the member's own graph like everything else.

Making it skippable is deliberate. An onboarding that cannot be dismissed teaches members to
click past whatever is in front of them, which is exactly the habit not to build in a system
that later asks them to make careful judgements.

### Sharing contact details with a connection

From the connections list, tapping a connection opens it. There, **one tap shares** the
contact details the member has marked eligible in their profile with the other party. The
details are delivered through that person's chosen notification channel.

Two properties worth stating explicitly:

- **Sharing is per-connection and deliberate.** Eligibility in the profile is necessary but
  not sufficient; nothing leaves until the member acts on that specific connection.
- **It is one-directional.** Sharing does not request or entitle you to the other person's
  details. They decide separately. A reciprocal-by-default design would make the first tap
  carry consequences the member did not choose.

### Notifications

Email is the default and the only channel for members who never install the PWA. Email must
therefore be genuinely useful: name the offer, name the request, and link directly into the
connection view. The same applies to a contact-sharing notification — it must carry the
details themselves, not merely announce that something happened.

## 9. API

REST under `/api/v1`, session cookie or `Bearer`:

```
POST /auth/exchange          theglobalburn JWT → cc session
GET  /me
POST /offers                 { text }
POST /requests               { text }
GET  /judge/next             → { kind: "match"|"merge", left, right, source? }
POST /judge                  { pairId, verdict }
GET  /concepts/suggest       ?text=… → ranked { exact[], similar[] }
POST /annotations            { sourceId, ranges: [{start,end}], conceptId }
POST /concepts               { label }   explicit creation only
DELETE /annotations/:id      retract your own annotation
GET  /connections
GET  /connections/:id
POST /connections/:id/metadata
POST /connections/:id/share  share eligible contact details, one tap
GET  /lexicon                ?q=… → concepts with labels, definition, usage counts
GET  /lexicon/:id
PUT  /lexicon/:id/definition { text }   any member
GET  /profile
PATCH /profile               contact details, cc:shares flags, cc:notifyVia
POST /profile/onboarding     { action: "accept"|"skip" } → sets cc:onboardingDone
GET  /cloud                  points: { id, text, x, y }
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

- `cc-core` is pure: unit tests against an in-memory store. The cases that matter most:
  - the same member voting twice does not advance the count;
  - a judged pair — affirmative *or* negative — is never served again to that member;
  - an engine proposal writes nothing until a member confirms it.
- **Contact sharing gets its own tests, treated as privacy-critical.** A detail not marked
  eligible must never be transmitted; sharing must reach only the counterparty of that one
  connection; and sharing must stay one-directional. These are the failures that would harm
  a member personally rather than merely producing a wrong answer.
- `cc-store`: round-trip tests against a temporary oxigraph instance.
- `cc-api`: integration tests with a locally-minted JWKS so auth is genuinely exercised —
  including **expired-token rejection**, the bug REA has.
- Frontend: mode detection (embedded / browser / standalone) is the highest-risk logic
  because it gates the service worker and the settings UI.

## 15. Open items

Done: repo created and pushed; Cloudflare token in place; `commonclearing.org` DNS pushed
(8 records, 0 drift); flyctl authenticated to `the-borderland-267`; DNSControl working.

Remaining:

| Item | Owner | Blocks |
|---|---|---|
| `clearing.theborderland.se` record in SolidCP (`cp.webaccess.se`) | user | deploy |
| Fly secrets: `SMTP_*`, `OPENAI_API_KEY`, VAPID keypair | user, via `fly secrets set` | deploy |
| Rust toolchain on the dev machine | — | implementation |
| npm automation token as a GitHub Actions secret | user | package release |

`theborderland.se` runs on `ns1–3.poise.se` and is administered through SolidCP, which
DNSControl does not support (69 providers, none matching). One record created by hand is
cheaper than automating an unsupported panel; `rea.theborderland.se` was created the same
way. Exact values come from `fly certs add` once the app exists.

Credentials go straight into `fly secrets set` by the user. They are never transmitted
through the design conversation, so there is nothing for the transcript scrubber (§13) to
catch.

## 16. Deliberate non-goals

- **No algorithmic matching.** Embeddings do exactly two things: position points on the nerd
  view (§5) and rank the "similar" block of the annotation dropdown (§8). Both are
  presentation. Neither writes a quad, and in both cases a member makes the decision. If a
  similarity score could create a merge, the human curation this system exists for would be
  undermined — and wrong merges would be invisible, because a silent auto-merge produces no
  artifact for anyone to review.
- **No user database.** Identity comes from theglobalburn. Common Clearing stores
  attribution, not credentials.
- **No horizontal scaling.** One machine, one volume. Revisit only if the dataset outgrows
  it.
