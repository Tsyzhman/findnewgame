# Recovery and concurrency verification

These checks strengthen release evidence. They do not configure production backups, restore the hosted Site, or establish production capacity.

## Local recovery drill

Run `npm run test:recovery` from `web/`. No server, account, provider credential, or command-line option is required. The command cannot target a remote database or accept a user-supplied restore path.

Stop normal development traffic for this check: another writer changing existing local data makes the before/after preservation check fail. The temporary parent must resolve inside this project; a junction to an outside directory is rejected before fixture creation.

The drill creates a unique directory under ignored `web/work/`, with separate source and destination D1/R2 bindings. It disables remote bindings and environment-file loading. It applies every migration in the committed Drizzle journal, then seeds synthetic records in all 29 application tables plus `schema_migrations`.

The fixture covers a complete three-round Daily, immutable game versions and experiment assignment, profile preferences and reactions, moderation records, upload ownership, sponsored delivery, and simulated payment/donation ledgers. All people and payments are fixtures; no merchant event is sent and no real rights assertion is made.

With fixture writes stopped, it exports schema and data separately through the installed Wrangler CLI. It captures asset bytes, keys, HTTP metadata, custom metadata, and a checksum manifest. Before restoring, it deliberately corrupts one asset and verifies that validation rejects it. It then restores the original fixture bytes and imports schema before data into an empty destination.

The successful drill verifies:

- Every schema definition and every row value matches the source snapshot, including quoted strings, nulls, frozen JSON and ledger identifiers.
- Every uploaded asset reference resolves to the expected bytes, size, content type and metadata.
- Foreign-key checks return no violations, and duplicate results, orphan interactions and excess campaign spending remain rejected without changing restored data.
- Existing `web/.wrangler` files have the same content hashes before and after the drill.
- Only the new, verified temporary directory is removed after its runtimes close. Symlinks or an unresolved cleanup failure stop cleanup and are reported; unrelated and previously blocked caches are never deletion targets.

The initial successful fixture had **30 tables, 51 rows and one 1,423,448-byte PNG**. Counts and timings are recorded in `artifacts/recovery-drill.json` in the parent workspace. Temporary SQL dumps and fixture assets are removed; the report contains hashes and counts, not a usable backup of the product.

### Why schema and data are separate

The first combined-export restore failed with a missing parent-table error. This matches the [Cloudflare export-order issue](https://github.com/cloudflare/workers-sdk/issues/5683). The supported `--no-data` and `--no-schema` exports let us create all tables before inserting data, without rewriting SQL or disabling integrity checks. Both exports must describe the same paused state. See [D1 import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## Compiled Worker concurrency check

After `npm run build`, run `npm run test:concurrency`. It uses Cloudflare's isolated native Worker test harness, not the standalone network proxy. It creates eight anonymous sample sessions and permits at most 16 requests in flight.

The check exercises cold initialization, 128 interleaved Daily requests, cross-session ownership, concurrent repeated finalization of all 24 assigned rounds, complete Daily state, and a bounded 64-request excess burst. It verifies stable game/version assignments, one result and guess per round, no qualified live outcomes, rate-limit rejection and continued Worker health. It respects the actual clue timer.

A second fresh database receives all generated migrations before the application starts. This reproduces the platform-first migration order. The check verifies that application startup adopts the existing schema without adding columns twice. This caught the bootstrap parser's previous failure to recognize `d7_returned_at`; both the service regression and the compiled Worker now cover it.

A third fresh database starts with the same schema, 100 canonical tag rows, no games, and an empty application migration ledger. This matches the durable-state pattern found by the read-only hosted inspection. One local fixture tag is deliberately disabled to verify preservation of moderation settings. Initialization completes to 430 tags and 20 games without duplicates; foreign keys and migration records pass. Repeated health requests preserve the completed seed state. This exercises recovery on a new startup, not the fate of a canceled request's promise inside a still-running isolate.

The report is `artifacts/concurrency-smoke.json`: request count, functional outcomes, local timing percentiles, and Node orchestrator memory. The measured run contains seven groups and 312 requests. These are local observations on the sample catalog. They exclude the Sites gateway, static asset router, real login, external callbacks, distributed load, and child Worker process memory. They are not a latency SLA or evidence of 200 real players.

## Hosted recovery gate

Sites owns the real Cloudflare resources. Do not infer a production database ID, use a Site sign-in bypass token, or aim the local fixture command at live data. A production drill still requires the operator's supported platform access and an approved isolated destination.

1. Record the deployed source/schema version, actual backup mechanism, retention and restore authority. D1's documented [Time Travel behavior](https://developers.cloudflare.com/d1/reference/time-travel/) does not prove that this Site's operator has access to those controls or that R2 objects are backed up with it.
2. Establish a consistent database/object snapshot by stopping writes or using a verified equivalent procedure. Protect exports and manifests separately from the live account. Checksums detect accidental corruption; they do not encrypt a backup or authenticate an untrusted manifest.
3. Restore into an empty, private destination using the source schema. Avoid starting normal application initialization before the import. Verify schema, rows, immutable history, financial references and private assets before testing the application.
4. Confirm sign-in, account ownership, admin access, Daily continuation, upload access, payment replay protection and safe disabled billing. Reapply deletion decisions made after the snapshot before reopening access.
5. Record observed recovery duration and recoverable data age against operator-approved targets. Keep the original source intact, approve any traffic switch explicitly, and document rollback.

No production restore, backup scheduler, recovery-point/recovery-time target, retention promise or automatic cross-store snapshot is claimed by the local checks.
