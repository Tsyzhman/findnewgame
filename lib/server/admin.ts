import { env } from 'cloudflare:workers';
import type { GameContent, PublicUser } from '@/lib/types';
import { all, database, first, id, tags } from './database';
import { parseSteamUrl, requireCondition, textField } from './security';
import { CONFIG } from '@/lib/config';
import { cleanTransientData } from './maintenance';
import { productMetrics } from './product-metrics';

export async function adminOverview() {
  const db = await database(),
    now = Date.now();
  const [
    games,
    experiments,
    campaigns,
    reports,
    counts,
    exposures,
    measurements,
    unmatched,
    audit,
    price,
  ] = await Promise.all([
    all<{
      id: string;
      status: string;
      moderation_note: string | null;
      content_json: string;
      version: number;
      current_version_id: string;
      studio: string;
    }>(
      db,
      'SELECT g.id,g.status,g.moderation_note,g.current_version_id,v.content_json,v.version,d.name studio FROM games g JOIN game_versions v ON v.id=g.current_version_id JOIN developers d ON d.id=g.developer_id WHERE g.is_demo=0 ORDER BY g.created_at DESC LIMIT 100',
    ),
    all(
      db,
      "SELECT id,name,game_id,kind,is_retest,status FROM experiments WHERE status='pending_review' ORDER BY created_at",
    ),
    all(
      db,
      'SELECT id,name,creative_json,targeting_json,status,moderation_status,payment_status,is_test,requested_impressions,paid_impressions,delivered FROM ad_campaigns ORDER BY created_at DESC LIMIT 100',
    ),
    all(
      db,
      "SELECT id,game_id,reason,details,status,created_at FROM reports WHERE status='open' ORDER BY created_at DESC LIMIT 100",
    ),
    first<Record<string, number>>(
      db,
      `SELECT (SELECT COUNT(*) FROM users WHERE is_demo=0) users,(SELECT COUNT(*) FROM user_profiles p JOIN users u ON u.id=p.user_id WHERE u.is_demo=0 AND p.onboarding_complete=1) onboarded,(SELECT COUNT(*) FROM games WHERE status='published' AND is_demo=0) approvedGames,(SELECT COUNT(*) FROM daily_sets d JOIN users u ON u.id=d.user_id WHERE u.is_demo=0 AND d.catalog_mode='live' AND d.created_at>? AND EXISTS (SELECT 1 FROM daily_assignments a WHERE a.set_id=d.id AND a.started_at IS NOT NULL)) setsStarted,(SELECT COUNT(*) FROM daily_sets d JOIN users u ON u.id=d.user_id WHERE u.is_demo=0 AND d.catalog_mode='live' AND d.created_at>? AND d.completed_at IS NOT NULL) setsCompleted,(SELECT COUNT(*) FROM quiz_final_results WHERE qualified=1 AND repeat_exposure=0) qualifiedRounds,(SELECT COUNT(*) FROM daily_sets WHERE relevance='yes' AND catalog_mode='live') relevantSets,(SELECT COUNT(*) FROM daily_sets WHERE relevance IS NOT NULL AND catalog_mode='live') ratedSets`,
      now - 7 * 86400000,
      now - 7 * 86400000,
    ),
    all<{ id: string; n: number }>(
      db,
      "SELECT g.id,COUNT(r.assignment_id) n FROM games g LEFT JOIN quiz_final_results r ON r.game_id=g.id AND r.qualified=1 AND r.repeat_exposure=0 WHERE g.status='published' AND g.is_demo=0 GROUP BY g.id ORDER BY n",
    ),
    productMetrics(db, now),
    all(
      db,
      "SELECT id,provider,external_payment_id,amount_cents,currency,status,created_at FROM payments WHERE purpose='unmatched' ORDER BY created_at DESC LIMIT 50",
    ),
    all(
      db,
      'SELECT id,target_type,target_id,action,reason,created_at FROM moderation_actions ORDER BY created_at DESC LIMIT 50',
    ),
    first<{ value_json: string }>(
      db,
      "SELECT value_json FROM site_config WHERE key='impression_price_cents'",
    ),
  ]);
  const total = exposures.reduce((sum, g) => sum + g.n, 0),
    n = exposures.length;
  const gini =
    n && total
      ? (2 * exposures.reduce((sum, g, i) => sum + (i + 1) * g.n, 0)) /
          (n * total) -
        (n + 1) / n
      : 0;
  const diagnostic = await db.prepare('SELECT 1').all();
  const cacheCounts = await first(
    db,
    'SELECT (SELECT COUNT(*) FROM rate_limits) rateLimitBuckets,(SELECT COUNT(*) FROM demo_sessions) demoSessions,(SELECT COUNT(*) FROM ad_offers) adOffers,(SELECT COUNT(*) FROM uploads) assets,(SELECT COALESCE(SUM(size),0) FROM uploads) assetBytes',
  );
  return {
    games: games.map(({ content_json, ...game }) => ({
      ...game,
      content: JSON.parse(content_json),
    })),
    experiments,
    campaigns,
    reports,
    unmatchedPayments: unmatched,
    audit,
    metrics: {
      ...counts,
      ...measurements,
      onboardingRate: counts?.users
        ? (100 * counts.onboarded) / counts.users
        : null,
      dailyCompletionRate: counts?.setsStarted
        ? (100 * counts.setsCompleted) / counts.setsStarted
        : null,
      positiveRelevanceRate: counts?.ratedSets
        ? (100 * counts.relevantSets) / counts.ratedSets
        : null,
      coverage: n ? (100 * exposures.filter((g) => g.n > 0).length) / n : 0,
      exposureGini: gini,
      gamesWithUsefulSample: exposures.filter(
        (g) => g.n >= CONFIG.minimumUsefulSample,
      ).length,
    },
    storage: {
      ...(cacheCounts as object),
      databaseBytes: diagnostic.meta.size_after ?? null,
    },
    config: {
      catalogMode: env.CATALOG_MODE ?? 'demo',
      billingEnabled: env.BILLING_ENABLED === 'true',
      turnstileEnabled: !!env.TURNSTILE_SECRET_KEY,
      localMode: import.meta.env.DEV,
      impressionPriceCents: Number(price?.value_json ?? 1),
    },
    limits: { qualifiedTarget: 100, privacyThreshold: 20 },
  };
}
export async function moderate(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  const db = await database(),
    type = String(body.type),
    targetId = textField(body.id, 'Target ID', 1, 100),
    action = String(body.action),
    reason = textField(
      body.reason ?? 'Reviewed by an administrator.',
      'Moderation reason',
      3,
      500,
    );
  requireCondition(
    ['game', 'experiment', 'campaign', 'report'].includes(type),
    'Unknown moderation target.',
  );
  requireCondition(
    ['approve', 'reject', 'request_changes', 'resolve'].includes(action),
    'Unknown moderation action.',
  );
  const table =
    type === 'game'
      ? 'games'
      : type === 'experiment'
        ? 'experiments'
        : type === 'campaign'
          ? 'ad_campaigns'
          : 'reports';
  const target = await first<Record<string, unknown>>(
    db,
    `SELECT * FROM ${table} WHERE id=?`,
    targetId,
  );
  requireCondition(target, 'Moderation target not found.', 404);
  const now = Date.now(),
    statements: D1PreparedStatement[] = [];
  if (type === 'game') {
    requireCondition(
      !body.versionId || body.versionId === target.current_version_id,
      'These materials changed after the review opened. Refresh and review the new version.',
      409,
      'review_changed',
    );
    requireCondition(
      !target.is_demo,
      'Sample materials are not live developer submissions.',
    );
    if (action === 'approve') {
      const row = await first<{ content_json: string }>(
        db,
        'SELECT content_json FROM game_versions WHERE id=?',
        target.current_version_id,
      );
      const content: GameContent = JSON.parse(row!.content_json);
      requireCondition(
        content.youtubeId &&
          content.screenshots.length >= 3 &&
          content.targets.genre.length &&
          content.targets.core.length,
        'This game does not have complete quiz assets.',
      );
    }
    statements.push(
      db
        .prepare(
          "UPDATE games SET status=?,moderation_note=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,?) ELSE published_at END WHERE id=? AND current_version_id=? AND status=?",
        )
        .bind(
          action === 'approve'
            ? 'published'
            : action === 'reject'
              ? 'rejected'
              : 'changes_requested',
          reason,
          action === 'approve' ? 'published' : '',
          now,
          targetId,
          target.current_version_id,
          target.status,
        ),
    );
  } else if (type === 'experiment') {
    requireCondition(
      action !== 'approve' || target.status === 'pending_review',
      'Only a pending experiment can be activated. Completed cohorts cannot be reopened.',
      409,
    );
    const liveGame = await first<{
      status: string;
      current_version_id: string;
    }>(
      db,
      'SELECT status,current_version_id FROM games WHERE id=?',
      target.game_id,
    );
    requireCondition(
      action !== 'approve' ||
        (liveGame?.status === 'published' &&
          liveGame.current_version_id === target.base_version_id),
      'Approve the current game materials first. An experiment for a superseded version cannot be activated.',
    );
    if (action === 'approve') {
      const active = await first(
        db,
        "SELECT id FROM experiments WHERE game_id=? AND status='active' AND id!=?",
        target.game_id,
        targetId,
      );
      requireCondition(
        !active,
        'Another experiment is already active for this game.',
        409,
      );
    }
    statements.push(
      db
        .prepare(
          "UPDATE experiments SET status=? WHERE id=? AND status=? AND (?!='approve' OR EXISTS (SELECT 1 FROM games g WHERE g.id=experiments.game_id AND g.status='published' AND g.current_version_id=experiments.base_version_id))",
        )
        .bind(
          action === 'approve' ? 'active' : 'rejected',
          targetId,
          target.status,
          action,
        ),
    );
  } else if (type === 'campaign')
    statements.push(
      db
        .prepare(
          "UPDATE ad_campaigns SET moderation_status=?,moderation_note=?,status=CASE WHEN ?='approved' AND payment_status='paid' THEN 'active' WHEN ?='approved' THEN 'awaiting_payment' ELSE 'rejected' END WHERE id=?",
        )
        .bind(
          action === 'approve'
            ? 'approved'
            : action === 'reject'
              ? 'rejected'
              : 'changes_requested',
          reason,
          action === 'approve' ? 'approved' : '',
          action === 'approve' ? 'approved' : '',
          targetId,
        ),
    );
  else
    statements.push(
      db
        .prepare("UPDATE reports SET status='resolved' WHERE id=?")
        .bind(targetId),
    );
  statements.push(
    db
      .prepare(
        'INSERT INTO moderation_actions (id,admin_user_id,target_type,target_id,action,reason,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1',
      )
      .bind(id('moderation-'), user.id, type, targetId, action, reason, now),
  );
  const outcome = await db.batch(statements);
  requireCondition(
    outcome[0].meta.changes === 1,
    'The review target changed. Refresh before trying again.',
    409,
    'review_changed',
  );
  return { ok: true };
}
export async function maintenance() {
  return cleanTransientData(await database());
}
export async function updateTag(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  const db = await database(),
    tagId = Number(body.id);
  requireCondition(Number.isInteger(tagId), 'Invalid tag ID.');
  requireCondition(typeof body.active === 'boolean', 'Choose an active state.');
  if (body.active === false) {
    const inUse = await first(
      db,
      "SELECT a.id FROM daily_assignments a JOIN daily_sets d ON d.id=a.set_id JOIN game_versions v ON v.id=a.version_id,json_each(v.content_json,'$.tagIds') j WHERE a.status!='complete' AND d.reset_at>? AND j.value=? LIMIT 1",
      Date.now(),
      tagId,
    );
    requireCondition(
      !inUse,
      'This tag is used by an unfinished round. Deactivate it after those rounds finish.',
      409,
    );
  }
  const now = Date.now();
  const result = await db.batch([
    db
      .prepare(
        "UPDATE steam_tags SET is_active=?,updated_at=? WHERE id=? AND (?=1 OR NOT EXISTS (SELECT 1 FROM daily_assignments a JOIN daily_sets d ON d.id=a.set_id JOIN game_versions v ON v.id=a.version_id,json_each(v.content_json,'$.tagIds') j WHERE a.status!='complete' AND d.reset_at>? AND j.value=steam_tags.id))",
      )
      .bind(body.active ? 1 : 0, now, tagId, body.active ? 1 : 0, now),
    db
      .prepare(
        "INSERT INTO moderation_actions (id,admin_user_id,target_type,target_id,action,reason,created_at) SELECT ?,?,'tag',?,?,?,? WHERE changes()=1",
      )
      .bind(
        id('moderation-'),
        user.id,
        String(tagId),
        body.active ? 'activate' : 'deactivate',
        'Canonical tag availability updated; IDs and names preserved.',
        now,
      ),
  ]);
  if (!result[0].meta.changes) {
    requireCondition(
      await first(db, 'SELECT id FROM steam_tags WHERE id=?', tagId),
      'Tag not found.',
      404,
    );
    requireCondition(
      false,
      'A new unfinished round uses this tag. Try again after it finishes.',
      409,
    );
  }
  return { ok: true };
}
export async function updatePrice(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  const price = Number(body.impressionPriceCents);
  requireCondition(
    Number.isInteger(price) && price >= 1 && price <= 100,
    'Price must be 1–100 cents per impression.',
  );
  const db = await database();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO moderation_actions (id,admin_user_id,target_type,target_id,action,reason,created_at) SELECT ?,?,'price','impression_price_cents','update','Changed from '||value_json||' to '||?||' US cents; existing invoices unchanged.',? FROM site_config WHERE key='impression_price_cents'",
      )
      .bind(id('moderation-'), user.id, String(price), now),
    db
      .prepare(
        "UPDATE site_config SET value_json=?,updated_at=? WHERE key='impression_price_cents'",
      )
      .bind(String(price), now),
  ]);
  return { ok: true };
}
export async function claimSampleStudio(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  requireCondition(
    user.role === 'admin',
    'Administrator access is required.',
    403,
  );
  requireCondition(
    body.ownershipVerified === true,
    'Verify studio ownership before assigning an account.',
  );
  const { appId } = parseSteamUrl(body.steamUrl),
    email = textField(body.ownerEmail, 'Owner email', 3, 254).toLowerCase(),
    reason = textField(body.reason, 'Ownership verification', 20, 500),
    db = await database(),
    marker = id('moderation-'),
    now = Date.now();
  // The audit row is the atomic claim. An existing owned studio cannot be
  // transferred, and existing sample versions are never certified as live.
  const result = await db.batch([
    db
      .prepare(
        "INSERT INTO moderation_actions (id,admin_user_id,target_type,target_id,action,reason,created_at) SELECT ?,?,'studio',d.id,'claim',?,? FROM games g JOIN developers d ON d.id=g.developer_id JOIN users u ON lower(u.email)=? AND u.is_demo=0 WHERE g.steam_app_id=? AND g.is_demo=1 AND d.owner_user_id IS NULL AND NOT EXISTS (SELECT 1 FROM developers owned WHERE owned.owner_user_id=u.id)",
      )
      .bind(marker, user.id, reason, now, email, appId),
    db
      .prepare(
        'UPDATE developers SET owner_user_id=(SELECT id FROM users WHERE lower(email)=? AND is_demo=0) WHERE id=(SELECT target_id FROM moderation_actions WHERE id=?)',
      )
      .bind(email, marker),
    db
      .prepare(
        'INSERT OR IGNORE INTO developer_members (developer_id,user_id) SELECT id,owner_user_id FROM developers WHERE id=(SELECT target_id FROM moderation_actions WHERE id=?)',
      )
      .bind(marker),
    db
      .prepare(
        "UPDATE users SET role=CASE WHEN role='admin' THEN 'admin' ELSE 'developer' END WHERE id=(SELECT owner_user_id FROM developers WHERE id=(SELECT target_id FROM moderation_actions WHERE id=?))",
      )
      .bind(marker),
    db
      .prepare(
        "UPDATE games SET status='changes_requested',moderation_note='Studio ownership verified. Submit a new version with your approved artwork, trailer, intended tags, and rights confirmation.' WHERE developer_id=(SELECT target_id FROM moderation_actions WHERE id=?) AND is_demo=1",
      )
      .bind(marker),
  ]);
  requireCondition(
    result[0].meta.changes === 1,
    'No claim was made. Choose an unclaimed sample studio and a signed-in owner who does not already have a studio profile.',
    409,
    'claim_unavailable',
  );
  return { ok: true };
}
export async function fundTestCampaign(campaignId: string) {
  requireCondition(
    import.meta.env.DEV,
    'Test funding is only available in local development.',
    403,
  );
  const db = await database();
  const result = await db
    .prepare(
      "UPDATE ad_campaigns SET paid_impressions=requested_impressions,payment_status='paid',status=CASE WHEN moderation_status='approved' THEN 'active' ELSE status END WHERE id=? AND is_test=1 AND paid_impressions=0",
    )
    .bind(campaignId)
    .run();
  requireCondition(
    result.meta.changes,
    'Only an unfunded local test campaign can be funded.',
    409,
  );
  return { ok: true };
}
export async function adminTags() {
  const db = await database(),
    rows = await all<{ id: number; is_active: number }>(
      db,
      'SELECT id,is_active FROM steam_tags',
    );
  const active = new Map(rows.map((r) => [r.id, !!r.is_active]));
  return {
    tags: tags.map((tag) => ({
      ...tag,
      is_active: active.get(tag.id) ?? false,
    })),
  };
}
export async function adminExperiment(experimentId: string) {
  const db = await database();
  return {
    variants: (
      await all<{ label: string; content_json: string }>(
        db,
        'SELECT label,content_json FROM experiment_variants WHERE experiment_id=? ORDER BY label',
        experimentId,
      )
    ).map((v) => ({
      label: v.label,
      content: JSON.parse(v.content_json) as GameContent,
    })),
  };
}
export async function reconcilePurchase(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  const db = await database(),
    paymentId = textField(body.paymentId, 'Payment', 1, 100),
    campaignId = textField(body.campaignId, 'Campaign', 1, 100),
    reason = textField(body.reason, 'Verification reason', 10, 500),
    marker = id('reconcile-'),
    now = Date.now();
  const outcome = await db.batch([
    db
      .prepare(
        "INSERT INTO moderation_actions (id,admin_user_id,target_type,target_id,action,reason,created_at) SELECT ?,?,'payment',?,'reconcile',?,? FROM payments p JOIN ad_campaigns c ON c.id=? JOIN developers d ON d.id=c.developer_id WHERE p.id=? AND p.provider='tribute' AND p.purpose='unmatched' AND p.status='paid' AND p.provisioned_at IS NULL AND p.campaign_id IS NULL AND p.currency='USD' AND p.amount_cents=c.requested_impressions*CAST((SELECT value_json FROM site_config WHERE key='impression_price_cents') AS INTEGER) AND c.payment_status='unpaid' AND c.paid_impressions=0 AND c.is_test=0 AND d.owner_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payments other WHERE other.campaign_id=c.id AND other.status IN ('creating','pending','uncertain','paid'))",
      )
      .bind(marker, user.id, paymentId, reason, now, campaignId, paymentId),
    db
      .prepare(
        "UPDATE payments SET purpose='campaign',campaign_id=?,user_id=(SELECT owner_user_id FROM developers WHERE id=(SELECT developer_id FROM ad_campaigns WHERE id=?)),impressions=(SELECT requested_impressions FROM ad_campaigns WHERE id=?),provisioned_at=? WHERE id=? AND EXISTS (SELECT 1 FROM moderation_actions WHERE id=?)",
      )
      .bind(campaignId, campaignId, campaignId, now, paymentId, marker),
    db
      .prepare(
        "UPDATE ad_campaigns SET paid_impressions=requested_impressions,payment_status='paid',status=CASE WHEN moderation_status='approved' AND status!='paused' THEN 'active' ELSE status END WHERE id=? AND EXISTS (SELECT 1 FROM moderation_actions WHERE id=?)",
      )
      .bind(campaignId, marker),
  ]);
  requireCondition(
    outcome[0].meta.changes === 1,
    'Reconciliation did not match an unassigned paid purchase and an unfunded campaign at the exact current USD price. No budget was changed.',
    409,
    'reconciliation_mismatch',
  );
  return { ok: true };
}
