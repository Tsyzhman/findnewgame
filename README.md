# FindNewGame

An English-language daily game-discovery app with a Cloudline interface. Players explore three unknown indie games through six clues. Developers learn how independent players perceive their store materials.

This is a working private beta implementation, not evidence that the business targets have been achieved. The initial catalog contains 20 clearly marked sample games and 430 canonical English Steam tags. Samples are not approved developer submissions. Billing is disabled by default.

## Run locally

Use Node.js 24 LTS and npm. The minimum supported Node version is 22.13.

```powershell
cd web
npm ci
if (-not (Test-Path -LiteralPath .env)) {
  Copy-Item -LiteralPath .env.example -Destination .env
}
npm run dev
```

Open `http://localhost:3000`. The port is strict: an existing listener must be stopped or reused, not silently replaced with a second server. The Sites development identity is a local test fixture; it does not grant access in production. Local D1 and R2 state lives in `.wrangler` and must not be treated as disposable cache.

## What is implemented

- Player onboarding, weighted taste preferences, Hard No exclusions, personalized daily selection, six-stage quizzes, partial-match scoring, reveals, save/follow reactions, streaks, history, account export/deletion, and spoiler-free image sharing.
- Selectable MMR diversity and contextual exploration policies with real-feedback gates, bounded per-player learning, immutable decision records, admin rollout controls, and observational outcome reports. The original personalized-random policy remains the default.
- Developer studios, private asset uploads, Steam lookup, manual submissions, ranked perception targets, immutable material versions, team-test exclusions, calibration reports, misconception matrices, information gain, and between-user A/B tests.
- Sponsored campaigns, Steam-tag audience targeting, viewable impressions, pacing, budget/frequency limits, and payment reconciliation. Campaign funding and donations remain unavailable until merchant configuration is verified.
- Admin moderation, taxonomy controls, pricing, verified sample-studio claims, aggregate product metrics, an audit trail, and bounded maintenance.
- Responsive light/dark themes, English copy and metadata, keyboard controls, visible focus states, reduced motion, error/empty/loading states, and explicit consent before loading YouTube.

## Verify

```powershell
npm run lint
npm run typecheck
npm test
npm run check:contrast
npm audit
npm run build
```

With the development server running, `npm run test:http` checks the real HTTP boundary and the local login fixture. After a successful build, `npm run test:production` starts Cloudflare's integration test harness for the compiled Worker, runs the same request checks with development authentication required to be absent, and closes its isolated runtime. It cannot replace a real hosted sign-in check. Both modes intentionally refuse non-local origins.

`npm run test:concurrency` exercises the compiled Worker with eight synthetic sessions, at most 16 requests in flight, frozen Daily assignments, repeated round finalization, rate limiting, and startup on pre-applied schemas with empty or partially seeded data. It verifies that partial seeding completes without duplicates or lost tag moderation settings. `npm run test:recovery` restores all application tables and private-asset bytes/metadata into separate local storage, then verifies values and constraints. Neither command accepts a remote target. See [recovery and concurrency verification](docs/RECOVERY.md) for evidence and production limits.

Wrangler 4.127.1's standalone HTTP proxy can stop after an early rejection of a request body ([upstream issue](https://github.com/cloudflare/workers-sdk/issues/15203)). The compiled test uses the supported harness's direct Worker entrypoint; it retains the cross-site rejection check. This checks application requests without the local network proxy or Sites gateway. No vendor patch or weakened application guard is applied. `npm run start` remains available for manual local inspection, with this known tooling limitation.

`npm run audit:resources` inventories caches, durable runtime state, React installations, and byte-identical source files without deleting anything. `npm run benchmark:discovery` measures pure selection on 3,000 synthetic candidates; it does not claim production capacity. Reports are written to `../artifacts/`.

## Project map

| Location                   | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `app/`, `components/`      | Pages and reusable interface components                          |
| `lib/`                     | Scoring, recommendation, advertising, time and payment contracts |
| `lib/server/`              | Authorization, persistence and domain services                   |
| `db/schema.ts`, `drizzle/` | D1 schema and incremental migrations                             |
| `data/`                    | English tag snapshot, sample catalog and source attribution      |
| `tests/`                   | Domain tests and isolated server integration tests               |
| `scripts/`                 | Import, preparation, HTTP and resource audits                    |
| `.openai/hosting.json`     | Sites identity and logical DB/FILES bindings only                |

Read [architecture](docs/ARCHITECTURE.md), [operations](docs/OPERATIONS.md), [SMART-plan coverage](docs/PLAN_COVERAGE.md), and [verification and limits](docs/VERIFICATION.md) before operating a live catalog. The original SMART plan and design brief remain unchanged in the parent workspace for reference.

## Launch boundary

Private preview uses `CATALOG_MODE=demo`, `BILLING_ENABLED=false`, and the baseline discovery policy. Moving to a commercial public beta requires rights-cleared submissions, real participants, merchant verification, operator/contact/terms information, and a production capacity check. Empirical recommendation quality and 30/90-day business outcomes still need real data. See [discovery policy operation](docs/DISCOVERY_POLICIES.md) before enabling an experimental policy.
