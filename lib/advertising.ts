export interface AudienceTarget {
  include: number[];
  exclude: number[];
  mode: 'any' | 'at_least_n';
  minimum: number;
}
export function matchesAudience(
  positiveTags: Set<number>,
  target: AudienceTarget,
): boolean {
  if (target.exclude.some((id) => positiveTags.has(id))) return false;
  const matches = target.include.filter((id) => positiveTags.has(id)).length;
  return matches >= (target.mode === 'any' ? 1 : target.minimum);
}
export function pacingAllowance(
  budget: number,
  startAt: number,
  endAt: number,
  now: number,
): number {
  if (now < startAt || now >= endAt || budget <= 0 || endAt <= startAt)
    return 0;
  const durationDays = Math.max(1, Math.ceil((endAt - startAt) / 86400000));
  const elapsedDays = Math.min(
    durationDays,
    Math.floor((now - startAt) / 86400000) + 1,
  );
  return Math.min(budget, Math.ceil((budget * elapsedDays) / durationDays));
}
export function eligibleAd(
  campaign: {
    developerId: string;
    gameId: string | null;
    status: string;
    moderationStatus: string;
    paymentStatus: string;
    paidImpressions: number;
    delivered: number;
    startAt: number;
    endAt: number;
    targeting: AudienceTarget;
  },
  context: {
    developerId: string;
    gameId: string;
    positiveTags: Set<number>;
    alreadySeen: boolean;
    now: number;
  },
): boolean {
  return (
    campaign.status === 'active' &&
    campaign.moderationStatus === 'approved' &&
    campaign.paymentStatus === 'paid' &&
    campaign.developerId !== context.developerId &&
    campaign.gameId !== context.gameId &&
    !context.alreadySeen &&
    campaign.delivered <
      pacingAllowance(
        campaign.paidImpressions,
        campaign.startAt,
        campaign.endAt,
        context.now,
      ) &&
    matchesAudience(context.positiveTags, campaign.targeting)
  );
}
