// Tests only: isolated SQLite with the same prepared SQL and atomic batches as D1.
import { DatabaseSync } from 'node:sqlite';
export class SqliteD1 {
  sqlite = new DatabaseSync(':memory:');
  constructor() {
    this.sqlite.exec('PRAGMA foreign_keys=ON');
  }
  prepare(sql: string) {
    return new Prepared(this, sql, []);
  }
  async batch(statements: Prepared[]) {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
class Prepared {
  constructor(
    private db: SqliteD1,
    private sql: string,
    private bindings: unknown[],
  ) {}
  bind(...values: unknown[]) {
    return new Prepared(this.db, this.sql, values);
  }
  execute() {
    const result = this.db.sqlite
      .prepare(this.sql)
      .run(...(this.bindings as (string | number | null | Uint8Array)[]));
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
  async run() {
    return this.execute();
  }
  async all() {
    return {
      success: true,
      results: this.db.sqlite
        .prepare(this.sql)
        .all(...(this.bindings as (string | number | null | Uint8Array)[])),
      meta: { changes: 0 },
    };
  }
  async first(column?: string) {
    const row = this.db.sqlite
      .prepare(this.sql)
      .get(...(this.bindings as (string | number | null | Uint8Array)[])) as
      | Record<string, unknown>
      | undefined;
    return column ? (row?.[column] ?? null) : (row ?? null);
  }
}
export class MemoryR2 {
  objects = new Map<string, { bytes: Uint8Array; type: string }>();
  async head(key: string) {
    return this.objects.has(key) ? { key } : null;
  }
  async put(
    key: string,
    bytes: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ) {
    this.objects.set(key, {
      bytes: new Uint8Array(bytes),
      type: options?.httpMetadata?.contentType ?? 'image/webp',
    });
    return { key };
  }
  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new Response(new Uint8Array(object.bytes)).body,
      writeHttpMetadata: (headers: Headers) =>
        headers.set('Content-Type', object.type),
      httpEtag: '"test-etag"',
    };
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
export const env = {
  DB: new SqliteD1(),
  FILES: new MemoryR2(),
  CATALOG_MODE: 'demo',
  BILLING_ENABLED: 'false',
} as unknown as Cloudflare.Env;
