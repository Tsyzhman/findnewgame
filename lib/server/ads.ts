import type { PublicUser, TasteProfile } from '@/lib/types';
import {
  matchesAudience,
  pacingAllowance,
  type AudienceTarget,
} from '@/lib/advertising';
import { activeTags, all, database, first, id } from './database';
import {
  requireCondition,
  textField,
  imageReference,
  safeUrl,
  assertUploadOwnership,
} from './security';
import { tagIds } from './validation';
import { developerFor, ownedGame } from './developer';
import { ownedRound } from './quiz';
import { localDate } from '@/lib/time';
import { secureRandom } from '@/lib/recommendation';

type Campaign = {
  id: string;
  developer_id: string;
  game_id: string | null;
  status: string;
  moderation_status: string;
  payment_status: string;
  paid_impressions: number;
  delivered: number;
  start_at: number;
  end_at: number;
  creative_json: string;
  targeting_json: string;
  is_test: number;
};
export async function validateTarget(
  body: Record<string, unknown>,
): Promise<AudienceTarget> {
  const db = await database(),
    tags = await activeTags(db);
  const include = tagIds(body.include, tags, 1, 15, 'Audience tags'),
    exclude = tagIds(body.exclude ?? [], tags, 0, 15, 'Excluded tags');
  requireCondition(
    !include.some((id) => exclude.includes(id)),
    'Audience tags cannot be included and excluded at the same time.',
  );
  requireCondition(
    body.mode === 'any' || body.mode === 'at_least_n',
    'Choose a targeting mode.',
  );
  const minimum = body.mode === 'any' ? 1 : Number(body.minimum);
  requireCondition(
    Number.isInteger(minimum) && minimum >= 1 && minimum <= include.length,
    'Minimum matching tags must fit the audience selection.',
  );
  return { include, exclude, mode: body.mode, minimum };
}
export async function audienceEstimate(target: AudienceTarget) {
  const db = await database(),
    rows = await all<{ taste_json: string }>(
      db,
      'SELECT p.taste_json FROM user_profiles p JOIN users u ON u.id=p.user_id WHERE p.onboarding_complete=1 AND u.is_demo=0 AND u.last_active_at>? LIMIT 20000',
      Date.now() - 30 * 86400000,
    );
  const count = rows.filter((row) => {
    const t: TasteProfile = JSON.parse(row.taste_json);
    return matchesAudience(
      new Set([...t.genres, ...t.mechanics, ...t.moods]),
      target,
    );
  }).length;
  if (count < 20)
    return {
      range: 'Fewer than 20',
      lower: 0,
      upper: 19,
      dailyRange: 'Not enough activity to estimate',
      privacySuppressed: true,
    };
  const lower = Math.floor((count * 0.8) / 10) * 10,
    upper = Math.ceil((count * 1.2) / 10) * 10;
  return {
    range: `${lower.toLocaleString('en-US')}–${upper.toLocaleString('en-US')}`,
    lower,
    upper,
    dailyRange: `0–${Math.ceil(upper * 0.6)}`,
    privacySuppressed: false,
    notice:
      'Rough active-profile range, not guaranteed delivery. One campaign impression per person per local day.',
  };
}
export async function createCampaign(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  const db = await database(),
    developer = await developerFor(user);
  requireCondition(developer, 'Create a developer profile first.', 409);
  const name = textField(body.name, 'Campaign name', 3, 100),
    title = textField(body.title, 'Ad title', 3, 80),
    description = textField(body.description, 'Ad description', 10, 180),
    image = imageReference(body.image),
    destination = safeUrl(body.destination, 'Destination URL');
  const targeting = await validateTarget(
      (body.targeting ?? {}) as Record<string, unknown>,
    ),
    impressions = Number(body.impressions);
  requireCondition(
    Number.isInteger(impressions) &&
      impressions >= 100 &&
      impressions <= 1_000_000,
    'Choose between 100 and 1,000,000 impressions.',
  );
  const startAt = Date.parse(String(body.startAt)),
    endAt = Date.parse(String(body.endAt));
  requireCondition(
    Number.isFinite(startAt) &&
      Number.isFinite(endAt) &&
      endAt > startAt &&
      endAt - startAt <= 90 * 86400000 &&
      endAt > Date.now(),
    'Choose a valid campaign window of up to 90 days.',
  );
  const gameId = body.gameId ? textField(body.gameId, 'Game ID', 1, 100) : null;
  if (gameId) {
    const game = await ownedGame(user, gameId);
    requireCondition(
      game.developer_id === developer.id,
      'Campaign game must belong to your studio.',
    );
  }
  await assertUploadOwnership(db, user.id, [image]);
  const campaignId = id('campaign-');
  await db
    .prepare(
      "INSERT INTO ad_campaigns (id,developer_id,game_id,name,creative_json,targeting_json,status,moderation_status,payment_status,requested_impressions,paid_impressions,delivered,start_at,end_at,is_test,created_at) VALUES (?,?,?,?,?,?,'pending_review','pending_review','unpaid',?,0,0,?,?,?,?)",
    )
    .bind(
      campaignId,
      developer.id,
      gameId,
      name,
      JSON.stringify({ title, description, image, destination }),
      JSON.stringify(targeting),
      impressions,
      startAt,
      endAt,
      body.isTest === true && import.meta.env.DEV ? 1 : 0,
      Date.now(),
    )
    .run();
  return { id: campaignId, status: 'pending_review' };
}
export async function nextAd(user: PublicUser, roundId: string) {
  if (user.isDemo) return { ad: null };
  const db = await database(),
    round = await ownedRound(db, user, roundId);
  if (round.catalog_mode !== 'live' && !import.meta.env.DEV)
    return { ad: null };
  const now = Date.now(),
    date = localDate(now, user.timezone),
    taste = user.taste;
  if (!taste) return { ad: null };
  const positive = new Set([
    ...taste.genres,
    ...taste.mechanics,
    ...taste.moods,
  ]);
  const rows = await all<Campaign>(
    db,
    "SELECT c.* FROM ad_campaigns c WHERE c.status='active' AND c.moderation_status='approved' AND c.payment_status='paid' AND c.developer_id!=? AND (c.game_id IS NULL OR c.game_id!=?) AND c.start_at<=? AND c.end_at>? AND c.delivered<c.paid_impressions AND NOT EXISTS (SELECT 1 FROM ad_impressions i WHERE i.campaign_id=c.id AND i.user_id=? AND i.local_date=?) AND NOT EXISTS (SELECT 1 FROM developers d WHERE d.id=c.developer_id AND d.owner_user_id=?) AND NOT EXISTS (SELECT 1 FROM developer_members m WHERE m.developer_id=c.developer_id AND m.user_id=?) LIMIT 200",
    round.developer_id,
    round.game_id,
    now,
    now,
    user.id,
    date,
    user.id,
    user.id,
  );
  const eligible = rows.filter(
    (c) =>
      (!c.is_test || import.meta.env.DEV) &&
      matchesAudience(positive, JSON.parse(c.targeting_json)) &&
      c.delivered <
        pacingAllowance(c.paid_impressions, c.start_at, c.end_at, now),
  );
  if (!eligible.length) return { ad: null };
  const campaign = eligible[Math.floor(secureRandom() * eligible.length)],
    offerId = id('offer-');
  await db
    .prepare(
      'INSERT INTO ad_offers (id,campaign_id,user_id,assignment_id,local_date,created_at,expires_at) VALUES (?,?,?,?,?,?,?)',
    )
    .bind(
      offerId,
      campaign.id,
      user.id,
      round.id,
      date,
      now,
      now + 15 * 60 * 1000,
    )
    .run();
  const creative = JSON.parse(campaign.creative_json);
  return {
    ad: {
      offerId,
      campaignId: campaign.id,
      title: creative.title,
      description: creative.description,
      image: creative.image.startsWith('r2:')
        ? `/api/assets/${encodeURIComponent(creative.image.slice(3))}`
        : creative.image,
      destination: creative.destination,
      isTest: !!campaign.is_test,
    },
  };
}
export async function recordImpression(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  const db = await database(),
    offerId = textField(body.offerId, 'Ad offer', 1, 100),
    now = Date.now();
  const visibleMs = Number(body.visibleMs),
    ratio = Number(body.ratio);
  requireCondition(
    Number.isFinite(visibleMs) &&
      visibleMs >= 1000 &&
      visibleMs <= 900000 &&
      ratio >= 0.5 &&
      ratio <= 1,
    'The ad must be at least 50% visible for a continuous second.',
  );
  const offer = await first<{
    campaign_id: string;
    assignment_id: string;
    local_date: string;
    created_at: number;
    expires_at: number;
  }>(db, 'SELECT * FROM ad_offers WHERE id=? AND user_id=?', offerId, user.id);
  requireCondition(
    offer && offer.expires_at > now,
    'This ad offer has expired.',
    409,
  );
  requireCondition(
    now - offer.created_at >= 1000,
    'The viewability interval has not elapsed.',
    409,
  );
  requireCondition(
    offer.local_date === localDate(now, user.timezone),
    'This ad offer belongs to an earlier local day.',
    409,
    'offer_expired',
  );
  const round = await ownedRound(db, user, offer.assignment_id),
    campaign = await first<Campaign>(
      db,
      'SELECT * FROM ad_campaigns WHERE id=?',
      offer.campaign_id,
    );
  requireCondition(campaign, 'Campaign not found.', 404);
  const self = await first(
    db,
    'SELECT 1 FROM developers WHERE id=? AND owner_user_id=? UNION ALL SELECT 1 FROM developer_members WHERE developer_id=? AND user_id=? LIMIT 1',
    campaign.developer_id,
    user.id,
    campaign.developer_id,
    user.id,
  );
  requireCondition(
    !self && !user.isDemo && (!campaign.is_test || import.meta.env.DEV),
    'This view is not eligible for paid delivery.',
    409,
  );
  requireCondition(
    campaign.developer_id !== round.developer_id &&
      campaign.game_id !== round.game_id,
    'Self-placement is not allowed.',
    409,
  );
  const allowed = pacingAllowance(
      campaign.paid_impressions,
      campaign.start_at,
      campaign.end_at,
      now,
    ),
    impressionId = id('impression-');
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO ad_impressions (id,offer_id,campaign_id,user_id,local_date,viewable_ms,created_at) SELECT ?,?,?,?,?,?,? FROM ad_campaigns WHERE id=? AND status='active' AND moderation_status='approved' AND payment_status='paid' AND delivered<paid_impressions AND delivered<? AND start_at<=? AND end_at>?",
      )
      .bind(
        impressionId,
        offerId,
        campaign.id,
        user.id,
        offer.local_date,
        Math.floor(visibleMs),
        now,
        campaign.id,
        allowed,
        now,
        now,
      ),
    db
      .prepare(
        'UPDATE ad_campaigns SET delivered=delivered+1 WHERE id=? AND EXISTS (SELECT 1 FROM ad_impressions WHERE id=?)',
      )
      .bind(campaign.id, impressionId),
  ]);
  const impression = await first<{ id: string }>(
    db,
    'SELECT id FROM ad_impressions WHERE campaign_id=? AND user_id=? AND local_date=?',
    campaign.id,
    user.id,
    offer.local_date,
  );
  return { counted: !!impression, impressionId: impression?.id ?? null };
}
export async function recordAdClick(user: PublicUser, offerId: string) {
  const db = await database(),
    offer = await first<{
      creative_json: string;
      impression_id: string | null;
    }>(
      db,
      'SELECT c.creative_json,i.id impression_id FROM ad_offers o JOIN ad_campaigns c ON c.id=o.campaign_id LEFT JOIN ad_impressions i ON i.offer_id=o.id WHERE o.id=? AND o.user_id=? AND o.expires_at>?',
      offerId,
      user.id,
      Date.now(),
    );
  requireCondition(offer, 'Ad offer not found.', 404);
  if (offer.impression_id)
    await db
      .prepare(
        'INSERT OR IGNORE INTO ad_clicks (impression_id,created_at) VALUES (?,?)',
      )
      .bind(offer.impression_id, Date.now())
      .run();
  return { url: JSON.parse(offer.creative_json).destination };
}
export async function updateCampaignState(
  user: PublicUser,
  campaignId: string,
  body: Record<string, unknown>,
) {
  const db = await database(),
    developer = await developerFor(user),
    campaign = await first<Campaign>(
      db,
      'SELECT * FROM ad_campaigns WHERE id=? AND developer_id=?',
      campaignId,
      developer?.id ?? '',
    );
  requireCondition(campaign, 'Campaign not found.', 404);
  requireCondition(
    ['paused', 'active'].includes(String(body.status)),
    'Choose pause or resume.',
  );
  if (body.status === 'active')
    requireCondition(
      campaign.payment_status === 'paid' &&
        campaign.moderation_status === 'approved',
      'Payment and approval are both required before activation.',
      409,
    );
  await db
    .prepare('UPDATE ad_campaigns SET status=? WHERE id=?')
    .bind(body.status, campaignId)
    .run();
  return { ok: true };
}
