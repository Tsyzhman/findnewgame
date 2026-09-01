# Operations runbook

## Safe initial state

Keep the Site owner-only, `CATALOG_MODE=demo`, and `BILLING_ENABLED=false` while reviewing the product. The sample catalog uses public materials with source attribution, illustrative targets, and an `is_demo` flag. It cannot establish rights ownership or satisfy the approved-catalog target.

Runtime environment belongs in Sites, or an ignored local `.env`, never in the hosting manifest, a public bundle, Git remote URL, or source control. Changing a Sites environment value requires deploying a saved version to apply it.

| Variable               | Meaning                                                      | Secret                         |
| ---------------------- | ------------------------------------------------------------ | ------------------------------ |
| `CATALOG_MODE`         | `demo` for samples; `live` for approved non-demo content     | No                             |
| `BILLING_ENABLED`      | `false` until the merchant and callback path are verified    | No                             |
| `SITE_URL`             | Exact deployed HTTPS origin for trusted return/metadata URLs | No                             |
| `ADMIN_EMAILS`         | Comma-separated verified Sites identity emails               | Treat as private configuration |
| `TURNSTILE_SITE_KEY`   | Hostname-bound client challenge key                          | No                             |
| `TURNSTILE_SECRET_KEY` | Matching server verification key                             | Yes                            |
| `LAVA_API_KEY`         | Merchant API credential                                      | Yes                            |
| `LAVA_WEBHOOK_TOKEN`   | Separate receiver credential configured in Lava              | Yes                            |
| `LAVA_OFFER_ID`        | Offer enabled for a custom amount through the API            | No                             |
| `TRIBUTE_API_KEY`      | Tribute webhook HMAC verification key                        | Yes                            |
| `TRIBUTE_DONATION_URL` | Verified creator donation link on an allowed host            | No                             |
| `MAINTENANCE_TOKEN`    | Optional bearer credential for external maintenance          | Yes                            |

Never promote the first arbitrary user to admin. Use the verified owner identity. Removing an admin from the allowlist removes admin privileges on the next authenticated request. Studio team membership excludes their results from calibrated analytics and recommendation learning; it does not prevent play or grant the owner dashboard to another account.

## Recommendation rollout

Keep **Personalized random · baseline** selected in Admin → Operations for the initial launch check. The optional MMR and contextual policies affect only future Daily sets and require an audit reason. Contextual exploration falls back to MMR until each player has enough qualified live feedback; sample outcomes cannot satisfy that gate.

Use the [discovery policy guide](DISCOVERY_POLICIES.md) for parameter limits, measurement, and rollback. Review the separate 30-day policy cohorts as observational reports, not evidence of causal improvement. Roll back through the same control without rewriting existing assignments or historical decisions.

## Catalog onboarding

1. A real developer signs in, creates a studio, and submits a Steam page or manual record.
2. The developer supplies 3–5 screenshots, valid artwork, a trailer when available, description, ranked tags, and genre/gameplay/mood targets. Rights and title-free artwork confirmations must be their own assertions.
3. Review materials, identity/ownership evidence, targets, publisher/family grouping, and image suitability in Admin. Approve the current submitted version; stale approvals are rejected.
4. A sample studio may be claimed only after verifying a real registered owner and recording the evidence reason. Claiming does not approve the sample. The owner must submit a new rights-confirmed version, followed by moderation.
5. Validate candidate availability under Hard No and studio/family exclusions before selecting live mode. The SMART launch gate is at least 100 approved games, not merely three technically eligible games.

Uploads accept sniffed PNG/JPEG/WebP up to 3 MiB each, with a 100 MiB per-account quota. Reservation and duplicate detection occur before storage writes. Unpublished artwork remains private. There is no bulk arbitrary upload or hosted video pipeline.

To refresh reference data deliberately:

```powershell
node scripts/import-steam-data.mjs --tags-only
npm run prepare:demo
npm test
```

The import uses Steam's English response, preserves existing files on a failed fetch, and retains Steam IDs. `--games-only` refreshes sample metadata from the existing tag snapshot. Review the diff and attribution before release. Preparation validates categories, deduplicates target lists, and applies the verified trailer map. It never certifies sample rights. Existing assigned material versions remain unchanged.

## Billing activation

No real purchase, refund, account activation, or merchant configuration was performed during local verification. The app intentionally returns an unavailable message while billing is disabled.

For Lava, verify the merchant account and an offer supporting a custom amount. Configure the API key, offer ID, and a distinct webhook receiver token. The callback path is `/api/webhooks/lava`; it verifies `X-Api-Key`. Match a real authorized test invoice's reference, amount, currency, completion, duplicate delivery, and failure before enabling campaigns. Invoice errors that leave the provider outcome uncertain require reconciliation, not a blind second charge. See [Lava's API and webhook documentation](https://developers.lava.top/en).

For Tribute, configure the HMAC key and callback `/api/webhooks/tribute`. The app verifies `trbt-signature` over the raw body, handles supported donations/purchases/refunds, and deduplicates purchase references. Associate an unmatched verified purchase with a campaign only after independently checking its ownership and value; record an admin reason. Do not infer a match from an email or arbitrary custom field. See [Tribute's webhook contract](https://wiki.tribute.tg/for-content-creators/api-documentation/webhooks).

An owner-only Sites access gate may prevent an external provider from reaching webhooks. Provider callback reachability must be explicitly solved and verified as part of commercial launch; adding secrets alone is insufficient. Do not share a Sites bypass token with a merchant or silently broaden Site access to work around it.

Native Lava donation links do not automatically return donation confirmation to this app. A refund updates local funding state only when a supported authenticated event or verified reconciliation establishes it. Disputes, taxes, payout eligibility, refunds outside the supported contract, and commercial terms remain operator responsibilities.

## Maintenance and incident response

Admin → Operations shows database size, asset usage, transient record counts, and bounded cleanup. Normal traffic also checks for a durable hourly cleanup claim. For unattended operation an external scheduler may call `POST /api/maintenance` with the configured bearer token; no scheduler is installed by this repository. The same reachability caveat applies to private Sites.

Each cleanup processes at most 1,000 expired demo users, 5,000 rate buckets more than an hour past expiry, and 5,000 ad offers more than a day past expiry. It runs `PRAGMA optimize`. A large backlog may require several runs. It does not delete completed player records, studio assets, material history, or payments.

Before a schema or access change, create and verify a platform-supported D1/R2 backup. Backups and restoration drills are operational gates, not features that have been silently configured. Keep migrations append-only. A code rollback does not reverse data migrations. Stop incoming writes if a migration is inconsistent, preserve data, inspect the applied schema, and repair forward.

The repeatable local `npm run test:recovery` drill verifies SQL export/import, R2 bytes and metadata, all application tables, constraints, and preservation of existing local data. It restores schema before data after reproducing an export-order failure. This is an isolated synthetic drill, not a hosted backup. Follow the [recovery guide](RECOVERY.md) for its boundaries and the still-required production procedure.

For a payment incident, disable new checkout, pause affected campaigns, preserve the signed event evidence, and reconcile with the provider. Never mark a campaign paid merely to clear an error. For a rights report, withdraw the affected content and preserve moderation history.

## Cache, duplicates, and memory

Run `npm run audit:resources` during longer development sessions and before handoff. `node_modules/.vite`, `.vinext`, `.next`, `dist`, and `tests/.runtime` are rebuildable; `.wrangler` can contain the only copy of local D1/R2 data. Stop this project's server before removing rebuildable caches. Verify resolved absolute paths and keep deletion inside the intended project. Never wipe a global npm cache or another project's processes as routine cleanup.

The audit counts nested caches separately from `node_modules`; those byte counts overlap and must not be added. It hashes app source/assets for exact duplicates and reports physical React package entries. Do not confuse development process memory with Cloudflare production memory or a load-test result.

## Release checks

Run lint, typecheck, all tests, the contrast audit, dependency audit, local HTTP checks, a production build, `npm run test:production`, `npm run test:concurrency`, and `npm run test:recovery`. The compiled checks use native Worker dispatch; the standalone Wrangler HTTP-proxy limitation is recorded in [verification](VERIFICATION.md). The concurrency check also starts the app on a schema already applied by a platform migration runner. Run the synthetic discovery benchmark after recommendation changes and label its limits. Restore local policy controls to baseline after QA. Package the exact tracked source with `scripts/package-sites-release.sh PROJECT_DIR ARCHIVE_PATH PACKAGE_SITE_HELPER`; it excludes untracked files copied from `public/`, then invokes the supported Sites helper and verifies those files stayed out. Verify the returned deployment status and preserve the same user-facing browser tab. Do not upload `.env`, `.wrangler`, fixture directories, SQL backups, test accounts, downloaded account exports, or dependency/cache folders.

After a successful deployment, check the home page, `/api/health`, sign-in/account, demo flow, and authorized admin access. Retain owner-only access until the launch gates in [plan coverage](PLAN_COVERAGE.md) are met and broader access is authorized.
