# Architecture

## Runtime and boundaries

The app uses React 19, TypeScript, Vinext/Vite, Tailwind, and the Sites Cloudflare Workers deployment path. D1 holds structured records; the private R2 `FILES` binding holds uploaded artwork. There are no browser-held payment credentials, card forms, hosted videos, or external analytics trackers.

The request boundary is `app/api/[...path]/route.ts`. It handles same-origin checks, identity, route limits, JSON errors, private response caching, and dispatch into `lib/server/`. All game ownership, moderation, scoring, assignment, payment, and budget decisions are made on the server. UI-disabled controls are not the authorization mechanism.

Sites supplies the trusted signed-in identity. User IDs are derived from that identity. `ADMIN_EMAILS` is a server-side allowlist; the development fixture is guarded by `import.meta.env.DEV`. A separate random, hashed, HttpOnly demo session expires after 24 hours. The raw worker must not be exposed through an alternative route that bypasses the Sites identity boundary.

## Data model

The Drizzle schema describes 29 application tables. Four generated migrations are committed. The initializer seeds canonical tags and illustrative samples, tolerates already-applied columns, and records application migration markers. Sites also receives the migration files during packaging. Initialization must be validated after every schema release; do not reset a production database to repair a migration.

Data is grouped into accounts/preferences, studios/games/material versions, daily sets/assignments/guesses/results, experiments/cohorts, reactions, campaigns/offers/impressions, payments/webhook events, moderation/audit records, uploads, and short-lived operational records.

Game material versions, assigned experiment variants, taste-at-assignment diagnostics, and completed results are immutable snapshots. Updating a studio's current material never rewrites an existing player's mystery. Tags retain Steam's numeric identifiers and canonical English names. Their genre/mechanic/mood roles are a FindNewGame curation layer, not a claim that Valve publishes this exact taxonomy.

## Daily selection

`lib/recommendation.ts` constructs vectors from explicit preferences, tag ranks, category weights, inverse document frequency, and bounded behavioral feedback. Save, follow, Steam click, Would Play, and Not For Me can affect preference weights. Quiz accuracy does not define taste.

Candidate filtering removes ineligible content, strong Hard No matches, and ordinary repeat exposures. Developer/team self-tests are excluded from calibration and learning eligibility, rather than prevented from playing. Safe, Balanced, and Curious use the 70th, 50th, and 35th relevance percentiles. Selection remains random within the eligible pool, with organic exposure weighting `1 / sqrt(1 + qualified exposures)`.

The three slots enforce studio, publisher, and family diversity. In the default baseline, pairwise cosine similarity above 0.8 triggers up to five alternative draws. Selection is bounded to a 3,000-game catalog in this beta. When constraints cannot produce three games, the app explains the shortage rather than inventing availability or silently repeating games.

A unique daily set uses the player's local calendar date. Assignment writes recheck the current published version and experiment state atomically. Concurrent requests converge on the same set. Retests are an explicit exception: changed B materials, a 14-day cooldown, one retest per permitted experiment path, and separate repeat-exposure reporting.

Default algorithm `taste-random-v1.1` stores mean pairwise similarity and the selected games outside the player's strongest chosen genres at assignment time. These are measurement diagnostics, not later reconstructions from edited preferences. The optional `taste-mmr-v1.0` and `taste-linucb-v1.0` policies add stochastic diversity ranking and shared-feature linear contextual exploration, respectively. The latter needs at least 20 distinct eligible live-game outcomes from that player, including three positive and three negative outcomes, or falls back to MMR. No cross-user collaborative or neural model is implemented.

Decision records freeze eight tag-affinity features, the actual/requested policy, parameter values, feedback sample counts, and the chosen game's conditional probability for the optional policies. The baseline records a null probability because its rejection/resampling step has a different distribution. Completed-round records are available in account export; unplayed mysteries are not exposed there. The per-player model is rebuilt from at most 200 valid outcomes from 90 days, so undo, deletion, and retroactive team exclusion cannot leave a stale hidden model. Details, formulas, limitations, and rollout instructions are in [discovery policies](DISCOVERY_POLICIES.md).

## Quiz and material boundaries

The six possible stages are artwork, screenshot, gallery, five seconds of trailer, fifteen seconds of trailer, and description. Missing media produces an explicit available-stage sequence. Score ceilings are 1,000 / 800 / 650 / 500 / 350 / 150; weighted overlap gives partial credit. Would Click is captured separately and does not alter the score.

The server owns stage progression, limits request speed, and prevents double completion. Title and target perception remain out of ordinary pre-reveal JSON, and mystery images are proxied through assignment authorization. A third-party trailer may still expose its own title or branding; the interface warns before consent. The YouTube IFrame API requests English controls and captions when available, pauses on hidden pages, and destroys the player when the segment ends or the component unmounts.

Finishing all three games completes the Daily even with zero points. Result sharing contains points, dates, and clue progression, not game names or answer tags.

## Analytics and experiments

Developer reports require 20 independent first-impression participants per reported group; 100 is labeled a useful sample, not automatic statistical significance. Owners, registered team testers, demos, and repeats are excluded. Adding a tester retroactively excludes their earlier results; removing them does not restore those results. Reports are version-scoped and capped at the most recent 10,000 eligible results per selected version.

Calibration includes clue funnels, weighted accuracy, misconceptions, confusion pairs, paired information gain, and eligible audience segments. Individual emails, account identifiers, and answer histories are never returned to a developer. A/B variants keep the same targets, randomize between users, and preserve the assigned variant. A second open experiment and reopening a finished experiment are rejected.

Admin product metrics distinguish real catalog activity from sample activity. Exact D7 retention is an authenticated return between 168 and 192 hours after the first live visit, assessed only once that full window has elapsed. Studio return/iteration starts when one non-demo game material version reaches 100 qualified results. Paid campaign metrics exclude test funding and refunded states. Definitions and denominators are shown in the dashboard.

## Advertising and payments

Sponsored inventory is separate from organic Daily selection. Targeting uses Steam tag IDs, any/at-least-N include matching, exclusions, and own-game study exclusions. A client observation requires at least 50% visibility continuously for one second; server offer validity, timing, frequency, pacing, and remaining budget are checked again. Billing writes are idempotent. Browser visibility is a useful signal, not proof of a human or comprehensive advertising fraud detection.

Campaign checkout snapshots price and requested impressions. Provider events are authenticated, normalized, matched to the expected reference/amount/currency, and recorded idempotently. Refunds pause funded campaigns. Uncertain invoice creation must be reconciled before another invoice is attempted.

Lava supports automatic campaign invoicing. Tribute creator-product webhooks do not carry this app's campaign invoice ID, so Tribute uses verified purchase reconciliation, not guessed automatic matching. Donations buy no organic exposure. Payment adapters are implemented and fixture-tested; merchant settlement has not been validated.

## Resource policy

React Query keeps account data in memory with 30-second staleness and three-minute garbage collection. Personalized API responses use `private, no-store`. Theme preference is the only intentional persistent client preference. Requests, temporary object URLs, canvas buffers, video players, observers, and timers have bounded lifetimes.

Maintenance deletes only expired demo users, old rate buckets, and expired unused ad offers in bounded batches. A durable hourly claim coordinates worker isolates. A failed cleanup releases its claim for retry. Player history, material versions, uploaded assets, and financial records are not caches.
