import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedRecoveryFixture } from '../tests/recovery-fixture.mjs';

// This is a disposable, local-only drill. It never accepts an account, database,
// bucket, source path, destination path, or remote option from the command line.
assert.equal(process.argv.length, 2, 'The recovery drill accepts no options.');
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.WRANGLER_WRITE_LOGS = 'false';
const { getPlatformProxy } = await import('wrangler');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonicalRoot = await realpath(root);
const workRoot = join(root, 'work');
const artifacts = resolve(root, '../artifacts');
await mkdir(workRoot, { recursive: true });
const verifiedWorkRoot = await realpath(workRoot);
assert.equal(
  verifiedWorkRoot,
  join(canonicalRoot, 'work'),
  'The temporary directory must resolve inside this project, not through a junction.',
);
await mkdir(artifacts, { recursive: true });
const scratch = await mkdtemp(join(workRoot, 'recovery-'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const runFile = promisify(execFile);
const proxies = new Set();
const started = performance.now();
const report = {
  date: new Date().toISOString(),
  status: 'running',
  scope:
    'Local D1 SQL export/import and R2 object restoration using synthetic fixtures only.',
  productionRestoreVerified: false,
  remoteBindingsEnabled: false,
  phases: [],
  limitations: [
    'Not a backup of the hosted Site or its production account.',
    'Does not verify Time Travel, provider retention, a scheduled backup, recovery-point objectives, or cross-region recovery.',
    'R2 keys, bytes and HTTP/custom metadata are restored; provider-generated object versions and upload timestamps are new.',
    'The manifest detects accidental corruption; it is not encryption or an independently authenticated signature.',
  ],
};

async function phase(name, action) {
  const start = performance.now();
  const result = await action();
  report.phases.push({
    name,
    passed: true,
    ms: Math.round(performance.now() - start),
  });
  console.log(`PASS ${name}`);
  return result;
}

async function treeDigest(directory) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true }).catch(
      (error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    )) {
      assert.ok(
        !entry.isSymbolicLink(),
        'The drill refuses to follow symbolic links.',
      );
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        files.push([
          relative(directory, path).replaceAll('\\', '/'),
          bytes.length,
          hash(bytes),
        ]);
      }
    }
  }
  await walk(directory);
  files.sort((a, b) => a[0].localeCompare(b[0]));
  return {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file[1], 0),
    sha256: hash(JSON.stringify(files)),
  };
}

async function makeConfig(name) {
  const directory = join(scratch, name);
  await mkdir(directory);
  const path = join(directory, 'wrangler.json');
  await writeFile(
    path,
    JSON.stringify(
      {
        name: `findnewgame-recovery-${name}`,
        compatibility_date: '2026-08-28',
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'recovery-fixture',
            database_id: randomUUID(),
            remote: false,
          },
        ],
        r2_buckets: [
          {
            binding: 'FILES',
            bucket_name: 'recovery-fixture-assets',
            remote: false,
          },
        ],
      },
      null,
      2,
    ),
  );
  return path;
}

async function openBindings(configPath) {
  const proxy = await getPlatformProxy({
    configPath,
    envFiles: [],
    remoteBindings: false,
    persist: { path: join(dirname(configPath), '.wrangler/state/v3') },
  });
  proxies.add(proxy);
  return proxy;
}

async function closeBindings(proxy) {
  await proxy.dispose();
  proxies.delete(proxy);
}

async function cli(configPath, args) {
  assert.ok(args.includes('--local') && !args.includes('--remote'));
  const result = await runFile(
    process.execPath,
    [
      join(root, 'node_modules/wrangler/bin/wrangler.js'),
      ...args,
      '--config',
      configPath,
    ],
    {
      cwd: dirname(configPath),
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CI: 'true' },
    },
  );
  return result.stdout;
}

async function databaseSnapshot(db) {
  const schema = (
    await db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name",
      )
      .all()
  ).results;
  const tables = {};
  for (const item of schema.filter((item) => item.type === 'table')) {
    assert.match(item.name, /^[a-z_]+$/);
    const rows = (await db.prepare(`SELECT * FROM "${item.name}"`).all())
      .results;
    // Compare all values, including nullable fields, frozen JSON, and ledger IDs.
    const canonical = rows
      .map((row) =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(row).sort(([a], [b]) => a.localeCompare(b)),
          ),
        ),
      )
      .sort();
    tables[item.name] = {
      rows: rows.length,
      sha256: hash(JSON.stringify(canonical)),
    };
  }
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  return { schemaSha256: hash(JSON.stringify(schema)), tables };
}

async function captureAssets(bucket, backupPath) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const item of page.objects) {
      assert.ok(
        objects.length < 100,
        'Fixture assets unexpectedly exceeded the drill limit.',
      );
      const object = await bucket.get(item.key);
      assert.ok(object, 'An asset disappeared while writes were paused.');
      const bytes = Buffer.from(await object.arrayBuffer());
      const file = `asset-${objects.length}.bin`;
      await writeFile(join(backupPath, file), bytes);
      objects.push({
        key: item.key,
        file,
        bytes: bytes.length,
        sha256: hash(bytes),
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

async function verifyBackup(backupPath) {
  const manifest = JSON.parse(
    await readFile(join(backupPath, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.format, 'findnewgame-local-recovery-v1');
  assert.deepEqual(
    manifest.sql.map((file) => file.file),
    ['schema.sql', 'data.sql'],
  );
  for (const file of manifest.sql) {
    assert.equal(
      hash(await readFile(join(backupPath, file.file))),
      file.sha256,
      'SQL backup checksum mismatch.',
    );
  }
  for (const object of manifest.objects) {
    assert.match(object.file, /^asset-\d+\.bin$/);
    const bytes = await readFile(join(backupPath, object.file));
    assert.equal(bytes.length, object.bytes, 'Asset backup length mismatch.');
    assert.equal(hash(bytes), object.sha256, 'Asset backup checksum mismatch.');
  }
  return manifest;
}

let localStateBefore;
try {
  localStateBefore = await treeDigest(join(root, '.wrangler'));
  const sourceConfig = await makeConfig('source');
  const targetConfig = await makeConfig('restored');
  const source = await openBindings(sourceConfig);
  const migrations = JSON.parse(
    await readFile(join(root, 'drizzle/meta/_journal.json'), 'utf8'),
  ).entries;
  await phase(
    'Apply every committed migration to a fresh local D1 fixture',
    async () => {
      await source.env.DB.prepare(
        'CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
      ).run();
      for (const entry of migrations) {
        assert.match(entry.tag, /^\d{4}_[a-z_]+$/);
        const sql = await readFile(
          join(root, 'drizzle', `${entry.tag}.sql`),
          'utf8',
        );
        const statements = sql
          .split('--> statement-breakpoint')
          .map((part) => part.trim())
          .filter(Boolean);
        await source.env.DB.batch(
          statements.map((statement) => source.env.DB.prepare(statement)),
        );
        await source.env.DB.prepare(
          'INSERT INTO schema_migrations VALUES (?,?)',
        )
          .bind(entry.tag.slice(0, 4), 1788177600000)
          .run();
      }
      report.migrations = migrations.map((entry) => entry.tag);
    },
  );
  await phase(
    'Seed linked quiz, experiment, payment, moderation, profile and private-asset fixtures',
    async () => {
      await seedRecoveryFixture(source.env, root);
    },
  );
  const expected = await databaseSnapshot(source.env.DB);
  assert.equal(
    Object.keys(expected.tables).length,
    30,
    'Update the fixture coverage when application tables change.',
  );
  assert.ok(
    Object.values(expected.tables).every((table) => table.rows > 0),
    'Every application table must have a recovery fixture.',
  );
  const backupPath = join(scratch, 'backup');
  await mkdir(backupPath);
  const objects = await captureAssets(source.env.FILES, backupPath);
  await closeBindings(source);
  await phase(
    'Export schema and data separately with Wrangler while fixture writes are stopped',
    async () => {
      // D1's combined dump may insert children before parent tables exist. The
      // supported schema-only/data-only exports avoid rewriting SQL ourselves.
      const sql = [];
      for (const [file, option] of [
        ['schema.sql', '--no-data'],
        ['data.sql', '--no-schema'],
      ]) {
        await cli(sourceConfig, [
          'd1',
          'export',
          'DB',
          '--local',
          option,
          '--output',
          join(backupPath, file),
        ]);
        const bytes = await readFile(join(backupPath, file));
        sql.push({ file, bytes: bytes.length, sha256: hash(bytes) });
      }
      await writeFile(
        join(backupPath, 'manifest.json'),
        JSON.stringify(
          { format: 'findnewgame-local-recovery-v1', sql, expected, objects },
          null,
          2,
        ),
      );
      report.backup = {
        sqlBytes: sql.reduce((sum, file) => sum + file.bytes, 0),
        assets: objects.length,
        assetBytes: objects.reduce((sum, object) => sum + object.bytes, 0),
      };
    },
  );
  await phase(
    'Reject a corrupted asset before importing any database or object',
    async () => {
      assert.ok(objects.length > 0);
      const path = join(backupPath, objects[0].file);
      const original = await readFile(path);
      const damaged = Buffer.from(original);
      damaged[0] ^= 1;
      await writeFile(path, damaged);
      await assert.rejects(verifyBackup(backupPath), /checksum mismatch/);
      await writeFile(path, original);
      await verifyBackup(backupPath);
    },
  );
  await phase(
    'Restore verified schema before data into a separate empty local D1 database',
    async () => {
      const target = await openBindings(targetConfig);
      assert.deepEqual((await databaseSnapshot(target.env.DB)).tables, {});
      assert.equal((await target.env.FILES.list()).objects.length, 0);
      await closeBindings(target);
      await verifyBackup(backupPath);
      for (const file of ['schema.sql', 'data.sql']) {
        await cli(targetConfig, [
          'd1',
          'execute',
          'DB',
          '--local',
          '--file',
          join(backupPath, file),
          '--yes',
        ]);
      }
    },
  );
  const restored = await openBindings(targetConfig);
  await phase(
    'Restore private R2 bytes and metadata and match every database table',
    async () => {
      const manifest = await verifyBackup(backupPath);
      for (const object of manifest.objects) {
        const bytes = await readFile(join(backupPath, object.file));
        await restored.env.FILES.put(object.key, bytes, {
          httpMetadata: object.httpMetadata,
          customMetadata: object.customMetadata,
        });
        const recovered = await restored.env.FILES.get(object.key);
        assert.ok(recovered);
        assert.equal(
          hash(Buffer.from(await recovered.arrayBuffer())),
          object.sha256,
        );
        assert.deepEqual(recovered.httpMetadata, object.httpMetadata);
        assert.deepEqual(recovered.customMetadata, object.customMetadata);
      }
      const actual = await databaseSnapshot(restored.env.DB);
      assert.deepEqual(actual, expected);
      for (const upload of (
        await restored.env.DB.prepare(
          'SELECT object_key,size,sha256,content_type FROM uploads',
        ).all()
      ).results) {
        const asset = await restored.env.FILES.get(upload.object_key);
        assert.ok(asset, 'Restored database references a missing asset.');
        assert.equal(asset.size, upload.size);
        assert.equal(asset.httpMetadata.contentType, upload.content_type);
        assert.equal(
          hash(Buffer.from(await asset.arrayBuffer())),
          upload.sha256,
        );
      }
      report.tables = actual.tables;
      report.rows = Object.values(actual.tables).reduce(
        (sum, table) => sum + table.rows,
        0,
      );
      report.schemaSha256 = actual.schemaSha256;
    },
  );
  await phase(
    'Retain uniqueness, foreign keys and campaign-budget constraints after restoration',
    async () => {
      const db = restored.env.DB;
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO quiz_final_results SELECT * FROM quiz_final_results WHERE assignment_id='fixture-round-0'",
          )
          .run(),
        /UNIQUE|constraint/i,
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO game_interactions (user_id,game_id,kind,active,tag_ids_json,created_at) VALUES ('missing-account','fixture-game-0','follow',1,'[]',1)",
          )
          .run(),
        /FOREIGN KEY|constraint/i,
      );
      await assert.rejects(
        db
          .prepare(
            "UPDATE ad_campaigns SET delivered=paid_impressions+1 WHERE id='fixture-campaign'",
          )
          .run(),
        /CHECK|constraint/i,
      );
      assert.deepEqual(
        await databaseSnapshot(db),
        expected,
        'Rejected operations must not change restored data.',
      );
    },
  );
  await closeBindings(restored);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
  console.error(`FAIL ${error.message}`);
} finally {
  for (const proxy of proxies) {
    try {
      await closeBindings(proxy);
    } catch (error) {
      report.status = 'failed';
      report.runtimeCleanupError = error.message;
      process.exitCode = 1;
    }
  }
  if (localStateBefore) {
    report.existingLocalStateUnchanged =
      JSON.stringify(await treeDigest(join(root, '.wrangler'))) ===
      JSON.stringify(localStateBefore);
    if (!report.existingLocalStateUnchanged) {
      report.status = 'failed';
      report.error =
        'Existing local state changed during the drill; inspect other writers before rerunning.';
      process.exitCode = 1;
    }
  }
  // Only the unique directory created by this invocation may be removed.
  // Previously blocked caches and the application's .wrangler are never targets.
  try {
    assert.equal(
      proxies.size,
      0,
      'A fixture runtime did not close; retain its directory for inspection.',
    );
    const parent = await realpath(workRoot);
    assert.equal(
      parent,
      verifiedWorkRoot,
      'The temporary directory changed location during the drill.',
    );
    const target = await realpath(scratch);
    const child = relative(parent, target);
    assert.ok(
      !isAbsolute(child) &&
        !child.includes('/') &&
        !child.includes('\\') &&
        /^recovery-[A-Za-z0-9]+$/.test(child),
    );
    await treeDigest(target); // Refuse symlink descendants before recursive cleanup.
    await rm(target, { recursive: true, force: false });
    report.fixtureCleanup =
      'removed only this invocation’s verified temporary directory';
  } catch (error) {
    report.status = 'failed';
    report.fixtureCleanup = `retained: ${error.message}`;
    report.retainedFixturePath = scratch;
    process.exitCode = 1;
  }
  report.elapsedMs = Math.round(performance.now() - started);
  report.nodePeakRssBytes = process.resourceUsage().maxRSS * 1024;
  report.memoryScope =
    'Node orchestrator only; this is not Worker memory or production capacity.';
  await writeFile(
    join(artifacts, 'recovery-drill.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    `Recovery drill ${report.status}; report: artifacts/recovery-drill.json`,
  );
}
