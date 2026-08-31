import {
  BANDIT,
  DEFAULT_DISCOVERY,
  parseDiscoverySettings,
  validFeatures,
  type BanditObservation,
} from '@/lib/discovery-policy';
import type { PublicUser } from '@/lib/types';
import { all, first, id } from './database';
import { requireCondition, textField } from './security';

export async function discoverySettings(db: D1Database) {
  const row = await first<{ value_json: string }>(
    db,
    "SELECT value_json FROM site_config WHERE key='discovery_policy'",
  );
  try {
    return (
      parseDiscoverySettings(JSON.parse(row?.value_json ?? 'null')) ?? {
        ...DEFAULT_DISCOVERY,
      }
    );
  } catch {
    return { ...DEFAULT_DISCOVERY };
  }
}

export async function discoveryOutcomes(db: D1Database, now = Date.now()) {
  return all<{
    policy: string;
    sets: number;
    started: number;
    completed: number;
    rated: number;
    positive: number;
    fallbacks: number;
    similarity: number | null;
  }>(
    db,
    `SELECT COALESCE(json_extract(d.selection_json,'$.policy.applied'),'baseline') policy,COUNT(*) sets,
      SUM(EXISTS (SELECT 1 FROM daily_assignments a WHERE a.set_id=d.id AND a.started_at IS NOT NULL)) started,
      SUM(d.completed_at IS NOT NULL) completed,SUM(d.relevance IS NOT NULL) rated,SUM(CASE WHEN d.relevance='yes' THEN 1 ELSE 0 END) positive,
      SUM(CASE WHEN json_extract(d.selection_json,'$.policy.fallbackReason') IS NOT NULL THEN 1 ELSE 0 END) fallbacks,
      AVG(json_extract(d.selection_json,'$.meanPairwiseSimilarity')) similarity
      FROM daily_sets d JOIN users u ON u.id=d.user_id WHERE d.catalog_mode='live' AND u.is_demo=0 AND d.created_at>=?
      GROUP BY policy ORDER BY policy`,
    now - 30 * 86400000,
  );
}

export async function updateDiscoveryPolicy(
  db: D1Database,
  user: PublicUser,
  body: Record<string, unknown>,
) {
  requireCondition(
    user.role === 'admin',
    'Administrator access is required.',
    403,
  );
  const settings = parseDiscoverySettings(body);
  requireCondition(
    settings,
    'Choose a valid policy, a relevance weight from 0.5 to 1, and exploration from 0 to 1.',
  );
  const reason = textField(body.reason, 'Policy change reason', 10, 500),
    now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO moderation_actions (id,admin_user_id,target_type,target_id,action,reason,created_at) SELECT ?,?,'discovery','discovery_policy','update','From '||COALESCE((SELECT value_json FROM site_config WHERE key='discovery_policy'),?)||' to '||?||'. '||?,?",
      )
      .bind(
        id('audit-'),
        user.id,
        JSON.stringify(DEFAULT_DISCOVERY),
        JSON.stringify(settings),
        reason,
        now,
      ),
    db
      .prepare(
        "INSERT INTO site_config (key,value_json,updated_at) VALUES ('discovery_policy',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
      )
      .bind(JSON.stringify(settings), now),
  ]);
  return { settings };
}

/** At most one explicit outcome per independent game; missing feedback is not a dislike. */
export async function discoveryFeedback(
  db: D1Database,
  user: PublicUser,
  now = Date.now(),
): Promise<BanditObservation[]> {
  if (user.isDemo) return [];
  const rows = await all<{ game_id: string; features: string; reward: 0 | 1 }>(
    db,
    `WITH feedback AS (
      SELECT assignment_id,MAX(kind='not_for_me') negative,MAX(kind IN ('would_play','save','follow','steam_click')) positive
      FROM game_interactions WHERE user_id=? AND active=1 AND assignment_id IS NOT NULL GROUP BY assignment_id
    ), examples AS (
      SELECT r.game_id,json_extract(c.value,'$.features') features,CASE WHEN f.negative=1 THEN 0 ELSE 1 END reward,
        ROW_NUMBER() OVER (PARTITION BY r.game_id ORDER BY r.completed_at DESC,r.assignment_id) position,r.completed_at
      FROM quiz_final_results r JOIN feedback f ON f.assignment_id=r.assignment_id
      JOIN users u ON u.id=r.user_id JOIN games g ON g.id=r.game_id
      JOIN daily_assignments a ON a.id=r.assignment_id JOIN daily_sets d ON d.id=a.set_id
      JOIN json_each(d.selection_json,'$.decisions') c ON json_extract(c.value,'$.gameId')=r.game_id
      WHERE r.user_id=? AND u.is_demo=0 AND g.is_demo=0 AND r.qualified=1 AND r.repeat_exposure=0
      AND d.catalog_mode='live' AND r.completed_at>=? AND r.completed_at<=?
      AND json_extract(d.selection_json,'$.policy.featureVersion')=? AND (f.negative=1 OR f.positive=1)
    ) SELECT game_id,features,reward FROM examples WHERE position=1 ORDER BY completed_at DESC,game_id LIMIT ?`,
    user.id,
    user.id,
    now - BANDIT.historyDays * 86400000,
    now,
    BANDIT.featureVersion,
    BANDIT.maximumSamples,
  );
  const observations: BanditObservation[] = [];
  for (const row of rows) {
    try {
      const features: unknown = JSON.parse(row.features);
      if (validFeatures(features))
        observations.push({ features, reward: row.reward });
    } catch {
      /* Old or malformed contexts are excluded, never reconstructed from current taste. */
    }
  }
  return observations;
}
