# Verification record

Local verification date: 2026-08-31. Environment: Windows, Node.js 24.11.1, real Cloudflare development runtime, and the in-app browser. Source is English throughout the shipped interface; the unchanged original requirements remain in the parent workspace.

The final production build completed successfully through all five Vinext build stages. The emitted Worker entrypoint, client assets, hosting metadata, and all four generated migrations form the deployment package. Vinext's route-classification notice is a framework limitation; the real route shells are covered separately by the HTTP smoke test.

## Automated checks

| Check                    | Result and scope                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint and TypeScript      | Passing; no suppressed release-blocking type errors                                                                                                                          |
| Domain/server tests      | 57 passing: 27 domain/policy tests and 30 server integration tests                                                                                                           |
| HTTP smoke               | Seven groups passing against localhost, including English route shells, auth gates, origin rejection, stable Daily assignment, media access and replay protection            |
| Compiled Worker          | Seven groups passing through Cloudflare's native Worker test-harness entrypoint, including concurrent assignment, origin rejection and absence of development login          |
| Bounded concurrency      | Six groups passing across 309 native Worker requests: eight sample sessions, at most 16 in flight, immutable assignments, finalization, rate limits and pre-migrated startup |
| Local recovery           | Seven phases passing: all 30 tables / 51 fixture rows and one private asset restored; checksums, metadata, foreign keys, uniqueness and budget constraints verified          |
| English check            | Rendered page shells have `lang="en"`; shipped app copy contains no Cyrillic text                                                                                            |
| Contrast                 | 60 text/input-border token pairs pass their 4.5:1 or 3:1 thresholds in light/dark themes                                                                                     |
| Dependency audit         | Zero known vulnerabilities reported by npm at verification time                                                                                                              |
| Media                    | 120 sample artwork/screenshot URLs returned HTTP 200; all 20 trailer entries have publisher/creator source attribution                                                       |
| Duplicate/resource audit | One installed copy of each React runtime package; no byte-identical files in the scanned application source/asset directories                                                |

Server tests bundle the actual services into an isolated Node SQLite/R2 harness. They exercise assignment races, immutable versions/cohorts, strict exclusions, stage completion, privacy floors, private assets, upload reservation/repair, team exclusion, moderation conflicts, payment authenticity/replay/refund boundaries, ad budgets/frequency, maintenance limits, and live KPI denominators. HTTP tests additionally exercise the development Worker's real HTTP API. `npm run test:production` uses the generated production bundle with Cloudflare's isolated test harness and direct Worker dispatch. It closes the runtime in a `finally` block and does not load a development identity. Neither harness proves distributed production capacity, the real Sites login, or merchant settlement.

The standalone compiled-Worker HTTP attempt was not green: Wrangler 4.127.1 returned a proxy connection error and stopped after rejecting an unread request body. Logs match the open [upstream proxy issue](https://github.com/cloudflare/workers-sdk/issues/15203) and its [pending fix](https://github.com/cloudflare/workers-sdk/pull/15207). Direct Worker-entrypoint checks passed repeatedly, retaining the failing-case origin rejection and concurrent requests. This isolates the observed local proxy failure; it does not prove that an upstream release has fixed it. No SDK patch, automatic retry that hides a failed assertion, or disabled application guard is part of the release.

New metric tests cover the exact D7 window, exclusion of preview/anonymous/unaged cohorts, assignment versus actual start, frozen diversity diagnostics, the 99/100 participant milestone, return/iteration timing, and exclusion of test/refunded campaign funding. Fixtures claiming 100 participants are synthetic test records, not business progress.

Discovery-policy tests check closed-form ridge predictions, uncertainty reduction, bounded/invalid data, diversity and exposure probabilities, strict selection constraints, cold-start fallback, authorized/audited configuration changes, immutable existing sets, and feedback qualification/undo/export. They prove implementation properties, not real-world improvement. `discovery-benchmark.json` records 60 warmed trials per policy on 3,000 synthetic candidates and 200 fixture feedback examples; it separates execution timing, observed heap, and total process RSS.

The new startup regression first failed with `duplicate column name: d7_returned_at`; the compiled Worker also returned HTTP 500 when all generated migrations had been applied before its first request. The bootstrap parser previously excluded digits from column names. It now recognizes an already-installed column instead of applying it twice. Both the isolated service test and a rebuilt Worker pass this platform-first migration case. No schema migration or application data was removed or rewritten for the fix.

The recovery drill first reproduced a combined SQL export that could not import because parent tables did not yet exist. Separate schema-only and data-only exports now restore successfully with foreign-key enforcement retained. Every application table contains a fixture, and all row values and schema definitions are compared. The source and destination are new local databases; existing local D1/R2 files remain byte-identical. See [recovery and concurrency verification](RECOVERY.md) for exact scope, safeguards, and the remaining hosted recovery gate.

## Browser checks

- Completed all three anonymous sample mysteries, including a zero-score path, and verified Daily completion and the spoiler-free result grid.
- Completed English onboarding and profile editing; checked signed-in Daily persistence.
- Exercised the five- and fifteen-second trailer controls. Confirmed no iframe before consent, actual `youtube-nocookie.com` embedding with `hl=en` and English caption preference, and iframe removal after the timed segment.
- Downloaded and visually inspected a real 1200×630 PNG share. Downloaded the account JSON export and inspected its fields. Verified account deletion requires the exact confirmation and left the QA account intact.
- Opened developer registration, submission, experiment and campaign surfaces. Did not assert ownership, submit fake rights confirmations, or charge a payment method.
- Inspected admin queues, aggregate health and operations, bounded cleanup, and the disabled unverified studio-claim action.
- Switched the local discovery control through MMR and contextual exploration, checked conditional inputs and persisted audit reasons, then restored baseline. Reload confirmed the saved policy. The optional policies were not activated on the hosted Site.
- Checked desktop and 390-pixel mobile layouts, keyboard controls, selected radio semantics, visible focus, and both themes. No horizontal overflow in the checked views.
- Rechecked the discovery form at a 390-pixel viewport, shortened a clipped policy label, and verified the full label and unchanged document width. The temporary viewport override was reset afterward.
- Performed a fresh-page navigation after development hot updates and confirmed no new error/warning logs in that check. Earlier hot-module React errors during dependency/source updates are not a production acceptance result.

## Artifacts and reruns

Reproducible audit commands are listed in the README. Machine-readable outputs live in the parent workspace's `artifacts/`: `http-smoke.json`, `compiled-worker-smoke.json`, `concurrency-smoke.json`, `recovery-drill.json`, `contrast-audit.json`, `media-audit.json`, `resource-audit.json`, and `discovery-benchmark.json`. Historical lint/removal reports preserve the before/after work; they are not current release failures. Personal account exports and temporary fixture backups are not committed.

The resource audit is read-only. Its dependency and nested cache totals overlap. A development server plus its local workerd process used approximately 1.1 GiB during a long QA session; that is a development working-set observation, not a production memory guarantee. The temporary test bundle is removed by the harness. Durable local D1/R2 data is retained.

## Limits that must remain explicit

The contrast audit is not full WCAG certification. No independent accessibility audit, automated visual regression suite, production load test, browser-market coverage study, penetration test, hosted backup restoration drill, real payment settlement, real 30-person product spike, 200+ player closed beta, or 30/90-day KPI measurement has been completed. Local recovery and bounded concurrency are now verified, with their narrower scope explicitly recorded.

YouTube can show its own title, branding, ads, or unavailable/region-restricted content. English caption requests cannot create a translation when the source has none. Steam and YouTube media can change or disappear after this check. Rights clearance remains required for a public catalog.

## Primary references used

- Steam's canonical tag concept and ordering: [Steamworks Tags](https://partner.steamgames.com/doc/store/tags). FindNewGame's category mapping remains its own reviewed layer.
- Supported player behavior and language controls: [YouTube player parameters](https://developers.google.com/youtube/player_parameters) and [IFrame API](https://developers.google.com/youtube/iframe_api_reference).
- Input/control contrast interpretation: [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
- Browser download behavior: [MDN anchor element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a).
- Rolling retention windows: [Amplitude retention time](https://amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-time). The app's exact D7 definition is stated above and in Admin.
- Payment contracts: [Lava API](https://developers.lava.top/en) and [Tribute webhooks](https://wiki.tribute.tg/for-content-creators/api-documentation/webhooks).
- Compiled Worker verification: [Cloudflare integration test harness](https://developers.cloudflare.com/workers/testing/test-harness/configure/).
- Recovery: [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [migration tracking](https://developers.cloudflare.com/d1/reference/migrations/), and the reproduced [SQL export-order issue](https://github.com/cloudflare/workers-sdk/issues/5683).

Community reports were used to identify likely pitfalls; implementation decisions were checked against primary documentation and the installed runtime rather than copied blindly.
