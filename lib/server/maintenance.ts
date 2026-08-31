// Only expiring operational data is removed. Player history, uploaded artwork,
// immutable material versions, and financial records are not caches.
export async function cleanTransientData(db: D1Database, now = Date.now()) {
  const results = await db.batch([
    db
      .prepare(
        'DELETE FROM users WHERE is_demo=1 AND id IN (SELECT user_id FROM demo_sessions WHERE expires_at<? LIMIT 1000)',
      )
      .bind(now),
    db
      .prepare(
        'DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at<? LIMIT 5000)',
      )
      .bind(now - 3600000),
    db
      .prepare(
        'DELETE FROM ad_offers WHERE id IN (SELECT id FROM ad_offers WHERE expires_at<? LIMIT 5000)',
      )
      .bind(now - 86400000),
  ]);
  await db.prepare('PRAGMA optimize').run();
  return {
    expiredDemoUsers: results[0].meta.changes,
    expiredRateBuckets: results[1].meta.changes,
    expiredAdOffers: results[2].meta.changes,
  };
}

let nextCheck = 0;
export async function maintainIfDue(db: D1Database) {
  const now = Date.now();
  if (now < nextCheck) return;
  nextCheck = now + 300000;
  try {
    // One durable hourly claim prevents every worker isolate from doing cleanup.
    const claim = await db
      .prepare(
        "INSERT INTO site_config (key,value_json,updated_at) VALUES ('transient_cleanup','true',?) ON CONFLICT(key) DO UPDATE SET updated_at=excluded.updated_at WHERE site_config.updated_at<?",
      )
      .bind(now, now - 3600000)
      .run();
    if (claim.meta.changes) await cleanTransientData(db, now);
  } catch {
    nextCheck = now + 60000;
    // Release only our own failed claim; do not overwrite another isolate's.
    await db
      .prepare(
        "DELETE FROM site_config WHERE key='transient_cleanup' AND updated_at=?",
      )
      .bind(now)
      .run()
      .catch(() => undefined);
    console.error(
      'Transient data cleanup failed; the administrator can retry maintenance.',
    );
  }
}
