import { buildUserVector } from '@/lib/recommendation';
import { validTimezone } from '@/lib/time';
import type { GameContent, PublicUser } from '@/lib/types';
import { activeTags, all, database, first, id } from './database';
import { requireCondition, textField } from './security';
import { validateTaste } from './validation';

export async function saveProfile(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  const db = await database(),
    tags = await activeTags(db),
    taste = validateTaste(body, tags),
    timezone = textField(body.timezone ?? user.timezone, 'Time zone', 1, 80);
  requireCondition(validTimezone(timezone), 'Choose a valid IANA time zone.');
  const name = textField(
      body.displayName ?? user.displayName,
      'Display name',
      2,
      60,
    ),
    now = Date.now(),
    vector = buildUserVector(taste, tags);
  const statements = [
    db
      .prepare(
        'UPDATE user_profiles SET taste_json=?,timezone=?,onboarding_complete=1,updated_at=? WHERE user_id=?',
      )
      .bind(JSON.stringify(taste), timezone, now, user.id),
    db
      .prepare('UPDATE users SET display_name=?,last_active_at=? WHERE id=?')
      .bind(name, now, user.id),
    db
      .prepare('DELETE FROM user_tag_preferences WHERE user_id=?')
      .bind(user.id),
  ];
  for (const [tag, weight] of vector)
    statements.push(
      db
        .prepare(
          'INSERT INTO user_tag_preferences (user_id,tag_id,explicit_weight,updated_at) VALUES (?,?,?,?)',
        )
        .bind(user.id, tag, weight, now),
    );
  await db.batch(statements);
  return { ok: true, taste, timezone };
}
export async function collection(user: PublicUser) {
  const db = await database(),
    rows = await all<{
      game_id: string;
      kind: string;
      created_at: number;
      content_json: string;
      round_id: string;
    }>(
      db,
      "SELECT i.game_id,i.kind,i.created_at,v.content_json,r.assignment_id round_id FROM game_interactions i JOIN quiz_final_results r ON r.assignment_id=(SELECT assignment_id FROM quiz_final_results WHERE user_id=i.user_id AND game_id=i.game_id ORDER BY completed_at DESC LIMIT 1) JOIN game_versions v ON v.id=r.version_id WHERE i.user_id=? AND i.active=1 AND i.kind IN ('save','follow') ORDER BY i.created_at DESC LIMIT 300",
      user.id,
    );
  const grouped = new Map<
    string,
    {
      id: string;
      roundId: string;
      content: GameContent;
      saved: boolean;
      followed: boolean;
      date: number;
    }
  >();
  for (const row of rows) {
    const item = grouped.get(row.game_id) ?? {
      id: row.game_id,
      roundId: row.round_id,
      content: JSON.parse(row.content_json),
      saved: false,
      followed: false,
      date: row.created_at,
    };
    if (row.kind === 'save') item.saved = true;
    if (row.kind === 'follow') item.followed = true;
    grouped.set(row.game_id, item);
  }
  return { games: [...grouped.values()] };
}
export async function history(user: PublicUser, before?: string) {
  const db = await database();
  requireCondition(
    !before || /^\d{4}-\d{2}-\d{2}$/.test(before),
    'Invalid history cursor.',
  );
  const sets = await all<{
    id: string;
    local_date: string;
    completed_at: number | null;
    catalog_mode: string;
  }>(
    db,
    'SELECT id,local_date,completed_at,catalog_mode FROM daily_sets WHERE user_id=? AND local_date<? ORDER BY local_date DESC LIMIT 30',
    user.id,
    before ?? '9999-12-31',
  );
  const rounds = sets.length
    ? await all<{
        set_id: string;
        assignment_id: string;
        score: number;
        accuracy: number;
        stage: number;
        content_json: string;
      }>(
        db,
        `SELECT a.set_id,r.assignment_id,r.score,r.accuracy,r.stage,v.content_json FROM quiz_final_results r JOIN daily_assignments a ON a.id=r.assignment_id JOIN game_versions v ON v.id=r.version_id WHERE r.user_id=? AND a.set_id IN (${sets.map(() => '?').join(',')}) ORDER BY a.slot`,
        user.id,
        ...sets.map((s) => s.id),
      )
    : [];
  const specializations = await all<{
    tagId: number;
    n: number;
    accuracy: number;
  }>(
    db,
    "SELECT CAST(j.value AS INTEGER) tagId,COUNT(*) n,AVG(r.accuracy) accuracy FROM quiz_final_results r JOIN game_versions v ON v.id=r.version_id,json_each(v.content_json,'$.targets.genre') j WHERE r.user_id=? GROUP BY j.value HAVING COUNT(*)>=3 ORDER BY accuracy DESC LIMIT 5",
    user.id,
  );
  return {
    sets: sets.map((set) => ({
      ...set,
      rounds: rounds
        .filter((r) => r.set_id === set.id)
        .map(({ content_json, ...r }) => ({
          ...r,
          title: (JSON.parse(content_json) as GameContent).title,
        })),
      totalScore: rounds
        .filter((r) => r.set_id === set.id)
        .reduce((sum, r) => sum + r.score, 0),
    })),
    nextCursor: sets.length === 30 ? sets[29].local_date : null,
    specializations,
    notice:
      'Specializations show your own accuracy after at least three rounds; no population percentile is invented.',
  };
}
export async function exportAccount(user: PublicUser) {
  const db = await database();
  const [
    preferences,
    sets,
    guesses,
    interactions,
    payments,
    activity,
    studioActivity,
    discovery,
  ] = await Promise.all([
    all(
      db,
      'SELECT tag_id,explicit_weight FROM user_tag_preferences WHERE user_id=?',
      user.id,
    ),
    all(
      db,
      'SELECT local_date,timezone,completed_at,catalog_mode FROM daily_sets WHERE user_id=?',
      user.id,
    ),
    all(
      db,
      'SELECT s.stage,s.guess_json,s.created_at FROM quiz_stage_guesses s JOIN daily_assignments a ON a.id=s.assignment_id WHERE a.user_id=?',
      user.id,
    ),
    all(
      db,
      'SELECT game_id,kind,active,created_at FROM game_interactions WHERE user_id=?',
      user.id,
    ),
    all(
      db,
      'SELECT provider,purpose,amount_cents,currency,status,created_at FROM payments WHERE user_id=?',
      user.id,
    ),
    first(
      db,
      'SELECT created_at,last_active_at,retention_started_at,d7_returned_at FROM users WHERE id=?',
      user.id,
    ),
    first(
      db,
      'SELECT name,last_dashboard_at FROM developers WHERE owner_user_id=?',
      user.id,
    ),
    all<{
      local_date: string;
      roundId: string;
      slot: number;
      policy: string;
      features: string;
      probability: number | null;
    }>(
      db,
      `SELECT d.local_date,a.id roundId,a.slot,json_extract(d.selection_json,'$.policy') policy,
      json_extract(c.value,'$.features') features,json_extract(c.value,'$.probability') probability
      FROM daily_sets d JOIN daily_assignments a ON a.set_id=d.id
      JOIN json_each(d.selection_json,'$.decisions') c ON json_extract(c.value,'$.gameId')=a.game_id
      WHERE d.user_id=? AND a.status='complete' AND json_type(d.selection_json,'$.policy')='object'
      AND json_type(c.value,'$.features')='array' ORDER BY d.local_date,a.slot`,
      user.id,
    ),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    profile: user,
    preferences,
    dailySets: sets,
    guesses,
    interactions,
    payments,
    activity,
    studioActivity,
    discovery: discovery.map((row) => ({
      ...row,
      policy: JSON.parse(String(row.policy)),
      features: JSON.parse(String(row.features)),
    })),
  };
}
export async function deleteAccount(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  requireCondition(
    body.confirmation === 'DELETE',
    'Type DELETE to confirm removal of your account.',
  );
  const db = await database();
  const developer = await first<{ id: string }>(
    db,
    'SELECT id FROM developers WHERE owner_user_id=?',
    user.id,
  );
  const statements: D1PreparedStatement[] = [];
  if (developer) {
    statements.push(
      db
        .prepare('UPDATE developers SET last_dashboard_at=NULL WHERE id=?')
        .bind(developer.id),
    );
    statements.push(
      db
        .prepare("UPDATE games SET status='withdrawn' WHERE developer_id=?")
        .bind(developer.id),
    );
    statements.push(
      db
        .prepare("UPDATE ad_campaigns SET status='paused' WHERE developer_id=?")
        .bind(developer.id),
    );
  }
  statements.push(db.prepare('DELETE FROM users WHERE id=?').bind(user.id));
  await db.batch(statements);
  return {
    ok: true,
    notice:
      'Your profile, preferences, guesses, and history were removed. Required payment records are retained without a user link. Sign out to avoid creating a new profile.',
  };
}
export async function reportGame(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  const db = await database(),
    roundId = textField(body.roundId, 'Round', 1, 100),
    row = await first<{ game_id: string }>(
      db,
      'SELECT game_id FROM daily_assignments WHERE id=? AND user_id=?',
      roundId,
      user.id,
    );
  requireCondition(row, 'Round not found.', 404);
  const reason = textField(body.reason, 'Report reason', 3, 80),
    details = textField(
      body.details ?? 'No additional details.',
      'Details',
      3,
      1000,
    );
  await db
    .prepare(
      'INSERT INTO reports (id,reporter_user_id,game_id,reason,details,created_at) VALUES (?,?,?,?,?,?)',
    )
    .bind(id('report-'), user.id, row.game_id, reason, details, Date.now())
    .run();
  return { ok: true };
}
