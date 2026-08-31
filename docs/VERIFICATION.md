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
| Bounded concurrency      | Seven groups passing across 312 native Worker requests: eight sample sessions, at most 16 in flight, immutable assignments, finalization, rate limits and partial-seed recovery |
| Local recovery           | Seven phases passing: all 30 tables / 51 fixture rows and one private asset restored; checksums, metadata, foreign keys, uniqueness and budget constraints verified          |
| Tag search diagnostic    | 240 local desktop measurements below 100 ms; maximum 48.1 ms from the input handler through a rendering opportunity. This is not production INP or a mobile guarantee      |
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
- Rechecked search across genre, gameplay, mood and Hard No scopes. Case/whitespace normalization, unmatched results, favorite-tag exclusions and adding/removing a selected chip passed. This follow-up did not submit preferences.
- Exercised the five- and fifteen-second trailer controls. Confirmed no iframe before consent, actual `youtube-nocookie.com` embedding with `hl=en` and English caption preference, and iframe removal after the timed segment.
- Downloaded and visually inspected a real 1200×630 PNG share. Downloaded the account JSON export and inspected its fields. Verified account deletion requires the exact confirmation and left the QA account intact.
- Opened developer registration, submission, experiment and campaign surfaces. Did not assert ownership, submit fake rights confirmations, or charge a payment method.
- Inspected admin queues, aggregate health and operations, bounded cleanup, and the disabled unverified studio-claim action.
- Switched the local discovery control through MMR and contextual exploration, checked conditional inputs and persisted audit reasons, then restored baseline. Reload confirmed the saved policy. The optional policies were not activated on the hosted Site.
- Checked desktop and 390-pixel mobile layouts, keyboard controls, selected radio semantics, visible focus, and both themes. No horizontal overflow in the checked views.
- Rechecked the discovery form at a 390-pixel viewport, shortened a clipped policy label, and verified the full label and unchanged document width. The temporary viewport override was reset afterward.
- Performed a fresh-page navigation after development hot updates and confirmed no new error/warning logs in that check. Earlier hot-module React errors during dependency/source updates are not a production acceptance result.

### Tag search timing

The original plan's Week 2 target is client-side search below 100 ms. A local desktop diagnostic on 2026-08-31 measured 240 searches in the development build: three cycles of 20 queries in each of four scopes. Broad prefixes rendered up to 60 results; the cases also included narrow prefixes, no matches, mixed case and whitespace. All measurements were below the target, with the following scope limits.

| Picker scope | Samples | Median | 95th percentile | Maximum |
| ------------ | ------- | ------ | --------------- | ------- |
| Genres       | 60      | 11.6 ms | 44.6 ms        | 48.1 ms |
| Gameplay     | 60      | 10.3 ms | 24.0 ms        | 30.5 ms |
| Moods        | 60      | 11.4 ms | 36.1 ms        | 38.5 ms |
| Hard No      | 60      | 11.2 ms | 35.8 ms        | 42.1 ms |

A temporary component probe started the clock in `onValueChange`, immediately before `setSearch`, and ended it at the second animation-frame callback after the search-state commit. It reported through DOM attributes. Every measured page state was visible. This covers component processing and a rendering opportunity, but excludes input delay before the handler and does not measure the complete page lifecycle. It must not be called INP, a production service-level result, or a slower-device guarantee. See [the browser's animation-frame contract](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) and [the fuller INP definition](https://web.dev/articles/inp).

The probe was removed afterward. Git confirmed no remaining component changes, and a fresh navigation showed no probe attributes, the original three selected genres, and an empty search with 24 suggestions. No preferences were submitted, and no telemetry or dependency was added. The prior keyboard check remains separate; this follow-up measured search and a reversible pointer-selection flow.

The workspace artifacts `tag-search-browser.json` and `tag-search-probe.patch` retain the query results, exact measurement method and temporary patch for review. The initial external automation timings included browser-control overhead, so they were not used as client performance. An initial assertion also incorrectly expected exactly one result for `imm` in every scope: the all-tags picker legitimately returns both Immersive Sim and Immersive. The final assertion compares normalized queries within the same scope; the genre example still requires exactly Immersive Sim. Mobile and real-user performance remain open.

### Hosted database inspection

A supported read-only Sites inspection on 2026-08-31 found all 30 expected tables and all 216 column names from the committed schema. The Site remained owner-only, in demo mode, with billing disabled. This verifies names only; the connector does not expose the full index, type, default and constraint definitions or perform a backup/restore drill.

Hosted initialization was incomplete at that inspection: four bounded pages contained 100 unique tag rows, the games table was empty, and the application-owned migration ledger had no records. An empty application ledger does not mean the platform failed to install the independently observed schema. The recent error-filtered log window returned two canceled `/api/me` invocations at 12:30:34–35 UTC, with no database exception. Their cause is not established by that window. Fresh browser navigation still reached the external ChatGPT sign-in gate, so a successful authenticated application startup must not be claimed.

The native-Worker check now reproduces the partial durable state in a new local database. It reaches 430 tags and 20 sample games, preserves an existing disabled-tag setting, verifies foreign keys and migration records, and leaves seed state unchanged on repeated health requests. A separate abort diagnostic did not establish safe cancellation inside an existing Worker isolate: one attempt stalled and was stopped; the bounded follow-up finished initialization before the abort took effect. Controlled checks then paused the actual initializer at 100 tags and disconnected the client, both through the test harness and directly through Miniflare HTTP. Subsequent requests completed, but the Worker did not observe an aborted request signal, so these do not establish propagation of production cancellation. No application or SDK patch was justified. `hosted-database-audit.json`, `startup-cancellation-probe.json`, and `startup-lifecycle-probe.json` preserve this narrower evidence; no live data was changed.

A later read-only recheck, completed at 13:55 UTC on the same day, found 430 unique tags, 20 sample games, 20 unique game versions, all four numbered migration records, and the demo-catalog completion marker. One admin account row was present; no account identity was retained in the report. The expected seed counts are now complete. This does not establish the cause of the earlier interruption or verify every stored payload. The preview tab had advanced to Google sign-in and was left untouched; authenticated browser flows remain unverified. `hosted-initialization-recheck.json` preserves the sequential page counts and their limits.

### Quiz tabs and dialog close targets

The design brief requires 44 by 44 CSS pixel pointer targets. A rendered desktop check found 36 px quiz tabs and a 28 by 28 px dialog close button. The tabs now have a 44 px minimum inside a 52 px container, and the shared close button is 44 by 44 px. The smaller mobile tab override was removed. This follows the design brief and the [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html).

At a 1280 by 720 viewport, all three quiz tabs and the report-dialog close button measured at least 44 by 44 px in both themes. Genre, Gameplay and Mood switching still worked, and the report dialog opened and closed without submitting a report. Both dialog layouts were visually inspected. No answers, preferences or video consent were submitted during this check.

A temporary wrapper also showed the real quiz fitting a 390 px frame in the light theme. Child DOM measurements were unavailable through the browser read interface, so this is a visual layout observation, not a numeric mobile pass or physical-device test. The second phone-width capture did not establish a dark-theme result. Removal of `public/qa-touch-target-layout-20260831.html` was blocked by execution policy; it remains untracked and must not enter a release. The release is built from a separate clean checkout without that file. `touch-target-audit.json` records the measurements, actions and limitations. This does not establish complete WCAG conformance or the full component-state matrix.

## Artifacts and reruns

Reproducible audit commands are listed in the README. Machine-readable outputs live in the parent workspace's `artifacts/`: `http-smoke.json`, `compiled-worker-smoke.json`, `concurrency-smoke.json`, `recovery-drill.json`, `contrast-audit.json`, `media-audit.json`, `resource-audit.json`, `discovery-benchmark.json`, and `tag-search-browser.json`. Historical lint/removal reports preserve the before/after work; they are not current release failures. Personal account exports and temporary fixture backups are not committed.

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
