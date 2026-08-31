import { env } from 'cloudflare:workers';
import migration from '@/drizzle/0000_loving_azazel.sql?raw';
import migration1 from '@/drizzle/0001_gifted_johnny_blaze.sql?raw';
import migration2 from '@/drizzle/0002_glorious_joseph.sql?raw';
import migration3 from '@/drizzle/0003_curly_kang.sql?raw';
import rawTags from '@/data/steam_tags.json';
import rawGames from '@/data/demo_games.json';
import type { GameContent, SteamTag } from '@/lib/types';
import { maintainIfDue } from './maintenance';

let initializing: Promise<void> | undefined;
export const tags = rawTags as SteamTag[];
export function id(prefix = ''): string {
  return `${prefix}${crypto.randomUUID()}`;
}
export function normalizeStudio(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}
export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
export function presentationFingerprint(content: GameContent): Promise<string> {
  return sha256(
    JSON.stringify({
      capsule: content.capsule,
      screenshots: content.screenshots,
      youtubeId: content.youtubeId,
      description: content.description,
    }),
  );
}
export const rawDb = () => env.DB;
export async function database(): Promise<D1Database> {
  if (!env.DB) throw new Error('D1 database binding is missing.');
  initializing ??= initialize(env.DB).catch((error) => {
    initializing = undefined;
    throw error;
  });
  await initializing;
  await maintainIfDue(env.DB);
  return env.DB;
}
async function initialize(db: D1Database) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
    )
    .run();
  const applied = await db
    .prepare('SELECT version FROM schema_migrations WHERE version=?')
    .bind('0000')
    .first();
  if (applied) {
    await applyAdditionalMigrations(db);
    return;
  }
  const statements = migration
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s
        .replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ')
        .replace(/^CREATE UNIQUE INDEX /, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
        .replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS '),
    );
  await db.batch(statements.map((sql) => db.prepare(sql)));
  const now = Date.now();
  for (let start = 0; start < tags.length; start += 50) {
    await db.batch(
      tags
        .slice(start, start + 50)
        .map((tag) =>
          db
            .prepare(
              'INSERT OR IGNORE INTO steam_tags (id,name,slug,category,payload_json,is_active,updated_at) VALUES (?,?,?,?,?,1,?)',
            )
            .bind(
              tag.id,
              tag.steam_name,
              tag.slug,
              tag.category,
              JSON.stringify(tag),
              now,
            ),
        ),
    );
  }
  for (const sample of rawGames) {
    const studio = normalizeStudio(sample.developer);
    const devId = `sample-studio-${studio}`;
    const content: GameContent = {
      ...sample,
      releaseState: sample.releaseState as GameContent['releaseState'],
      youtubeId: sample.youtubeId,
      targets: {
        genre: [...new Set(sample.targets.genre)],
        core: [...new Set(sample.targets.core)],
        mood: [...new Set(sample.targets.mood)],
      },
    };
    const versionId = `${sample.id}-v1`;
    await db.batch([
      db
        .prepare(
          'INSERT OR IGNORE INTO developers (id,owner_user_id,name,studio_key,created_at) VALUES (?,NULL,?,?,?)',
        )
        .bind(devId, sample.developer, studio, now),
      db
        .prepare(
          "INSERT OR IGNORE INTO games (id,developer_id,publisher_key,family_key,steam_app_id,status,current_version_id,is_demo,created_at,published_at) VALUES (?,?,?,?,?,'published',?,1,?,?)",
        )
        .bind(
          sample.id,
          devId,
          normalizeStudio(sample.publisher) || studio,
          String(sample.steamAppId),
          sample.steamAppId,
          versionId,
          now,
          now,
        ),
      db
        .prepare(
          'INSERT OR IGNORE INTO game_versions (id,game_id,version,content_json,presentation_hash,created_at) VALUES (?,?,1,?,?,?)',
        )
        .bind(
          versionId,
          sample.id,
          JSON.stringify(content),
          await presentationFingerprint(content),
          now,
        ),
    ]);
  }
  await db.batch([
    db
      .prepare(
        'INSERT OR IGNORE INTO site_config (key,value_json,updated_at) VALUES (?,?,?)',
      )
      .bind('impression_price_cents', '1', now),
    db
      .prepare(
        'INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (?,?)',
      )
      .bind('0000', now),
  ]);
  await applyAdditionalMigrations(db);
  await db.prepare('PRAGMA optimize').run();
}
async function applyAdditionalMigrations(db: D1Database) {
  for (const [version, source] of [
    ['0001', migration1],
    ['0002', migration2],
    ['0003', migration3],
  ]) {
    const applied = await db
      .prepare('SELECT version FROM schema_migrations WHERE version=?')
      .bind(version)
      .first();
    if (applied) continue;
    const statements: D1PreparedStatement[] = [];
    for (const sourceStatement of source
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const addition = sourceStatement.match(
        /^ALTER TABLE [`"]?([a-z_][a-z0-9_]*)[`"]? ADD (?:COLUMN )?[`"]?([a-z_][a-z0-9_]*)[`"]? /i,
      );
      if (
        addition &&
        (
          await db
            .prepare(`PRAGMA table_info(${addition[1]})`)
            .all<{ name: string }>()
        ).results.some((column) => column.name === addition[2])
      )
        continue;
      statements.push(
        db.prepare(
          sourceStatement
            .replace(
              /^CREATE UNIQUE INDEX /,
              'CREATE UNIQUE INDEX IF NOT EXISTS ',
            )
            .replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS '),
        ),
      );
    }
    statements.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (?,?)',
        )
        .bind(version, Date.now()),
    );
    await db.batch(statements);
  }
  await refreshSampleCatalog(db);
}
async function refreshSampleCatalog(db: D1Database) {
  const marker = `demo-catalog-${(await sha256(JSON.stringify([rawGames, rawTags]))).slice(0, 16)}`;
  if (
    await db
      .prepare('SELECT version FROM schema_migrations WHERE version=?')
      .bind(marker)
      .first()
  )
    return;
  for (const sample of rawGames) {
    const current = await db
      .prepare(
        'SELECT g.current_version_id,v.version,v.content_json FROM games g JOIN game_versions v ON v.id=g.current_version_id JOIN developers d ON d.id=g.developer_id WHERE g.id=? AND g.is_demo=1 AND d.owner_user_id IS NULL',
      )
      .bind(sample.id)
      .first<{
        current_version_id: string;
        version: number;
        content_json: string;
      }>();
    if (!current) continue;
    const content: GameContent = {
      ...sample,
      releaseState: sample.releaseState as GameContent['releaseState'],
      targets: {
        genre: [...new Set(sample.targets.genre)],
        core: [...new Set(sample.targets.core)],
        mood: [...new Set(sample.targets.mood)],
      },
    };
    const serialized = JSON.stringify(content);
    if (current.content_json === serialized) continue;
    const version = current.version + 1,
      versionId = `${sample.id}-v${version}`;
    await db.batch([
      db
        .prepare(
          'INSERT OR IGNORE INTO game_versions (id,game_id,version,content_json,presentation_hash,created_at) VALUES (?,?,?,?,?,?)',
        )
        .bind(
          versionId,
          sample.id,
          version,
          serialized,
          await presentationFingerprint(content),
          Date.now(),
        ),
      db
        .prepare(
          'UPDATE games SET current_version_id=? WHERE id=? AND current_version_id=? AND is_demo=1',
        )
        .bind(versionId, sample.id, current.current_version_id),
    ]);
  }
  for (let start = 0; start < tags.length; start += 50)
    await db.batch(
      tags
        .slice(start, start + 50)
        .map((tag) =>
          db
            .prepare(
              'INSERT INTO steam_tags (id,name,slug,category,payload_json,is_active,updated_at) VALUES (?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,slug=excluded.slug,category=excluded.category,payload_json=excluded.payload_json,updated_at=excluded.updated_at',
            )
            .bind(
              tag.id,
              tag.steam_name,
              tag.slug,
              tag.category,
              JSON.stringify(tag),
              Date.now(),
            ),
        ),
    );
  await db
    .prepare(
      'INSERT OR IGNORE INTO schema_migrations (version,applied_at) VALUES (?,?)',
    )
    .bind(marker, Date.now())
    .run();
}
export async function all<T>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T[]> {
  return (
    await db
      .prepare(sql)
      .bind(...bindings)
      .all<T>()
  ).results;
}
export async function first<T>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...bindings)
    .first<T>();
}
export async function activeTags(db: D1Database): Promise<SteamTag[]> {
  const inactive = await all<{ id: number }>(
    db,
    'SELECT id FROM steam_tags WHERE is_active=0',
  );
  const excluded = new Set(inactive.map((t) => t.id));
  return tags.filter((t) => !excluded.has(t.id));
}
