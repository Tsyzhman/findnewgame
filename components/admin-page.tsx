/* oxlint-disable next/no-img-element -- Moderation previews use private uploaded images or approved Steam CDN assets with bounded sizes; the optimizer must not bypass their access controls. */
'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, ShieldCheck } from 'lucide-react';
import { api, assetUrl, useMe, useTags } from '@/lib/api';
import type { GameContent, SteamTag } from '@/lib/types';
import { BANDIT, type DiscoverySettings } from '@/lib/discovery-policy';
import {
  ActionButton,
  AuthGate,
  ErrorBox,
  Field,
  Loading,
  Metric,
  Notice,
  PageHeading,
  StatusBadge,
  TextInput,
} from './product-ui';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { TagChips } from './tag-picker';
type ReviewGame = {
  id: string;
  status: string;
  studio: string;
  version: number;
  current_version_id: string;
  content: GameContent;
};
type AdminData = {
  games: ReviewGame[];
  experiments: {
    id: string;
    name: string;
    game_id: string;
    kind: string;
    is_retest: number;
    status: string;
  }[];
  campaigns: {
    id: string;
    name: string;
    creative_json: string;
    moderation_status: string;
    payment_status: string;
    status: string;
    is_test: number;
    requested_impressions: number;
    paid_impressions: number;
    delivered: number;
  }[];
  reports: {
    id: string;
    game_id: string;
    reason: string;
    details: string;
    status: string;
  }[];
  unmatchedPayments: {
    id: string;
    provider: string;
    external_payment_id: string;
    amount_cents: number;
    currency: string;
    status: string;
  }[];
  metrics: Record<string, number | null>;
  discovery: {
    policy: string;
    sets: number;
    started: number;
    completed: number;
    rated: number;
    positive: number;
    fallbacks: number;
    similarity: number | null;
  }[];
  storage: Record<string, number | null>;
  audit: {
    id: string;
    target_type: string;
    target_id: string;
    action: string;
    reason: string;
    created_at: number;
  }[];
  config: {
    catalogMode: string;
    billingEnabled: boolean;
    turnstileEnabled: boolean;
    localMode: boolean;
    impressionPriceCents: number;
    discovery: DiscoverySettings;
  };
};
type ReviewAction = {
  type: string;
  id: string;
  action: string;
  name: string;
  versionId?: string;
};
function DiscoveryControls({ settings }: { settings: DiscoverySettings }) {
  const client = useQueryClient(),
    [draft, setDraft] = useState<DiscoverySettings | null>(null),
    [reason, setReason] = useState(''),
    value = draft ?? settings;
  const update = useMutation({
    mutationFn: () =>
      api('admin/discovery', { method: 'PATCH', body: { ...value, reason } }),
    onSuccess: async () => {
      setDraft(null);
      setReason('');
      await client.invalidateQueries({ queryKey: ['admin'] });
    },
  });
  return (
    <section className="surface settings-card">
      <h2>Organic discovery policy</h2>
      <p>
        These controls affect newly created Daily sets. Existing sets, strict
        exclusions, and paid campaigns are unchanged.
      </p>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate();
        }}
      >
        <Field id="discovery-policy" label="Selection policy">
          <select
            className="fng-input"
            id="discovery-policy"
            value={value.policy}
            onChange={(event) =>
              setDraft({
                ...value,
                policy: event.target.value as DiscoverySettings['policy'],
              })
            }
          >
            <option value="baseline">Personalized random · baseline</option>
            <option value="mmr">MMR · relevance and diversity</option>
            <option value="linucb">Contextual exploration</option>
          </select>
        </Field>
        <Field id="discovery-relevance" label="Relevance weight (0.5–1)">
          <TextInput
            id="discovery-relevance"
            type="number"
            min={0.5}
            max={1}
            step={0.05}
            required
            value={value.relevanceWeight}
            disabled={value.policy === 'baseline'}
            onChange={(event) =>
              setDraft({
                ...value,
                relevanceWeight: Number(event.target.value),
              })
            }
          />
        </Field>
        <p className="field-help">
          Lower values favor variety among relevant candidates. Within that
          pool, organic exposure weights the random draw.
        </p>
        <Field id="discovery-exploration" label="Exploration strength (0–1)">
          <TextInput
            id="discovery-exploration"
            type="number"
            min={0}
            max={1}
            step={0.05}
            required
            value={value.exploration}
            disabled={value.policy !== 'linucb'}
            onChange={(event) =>
              setDraft({ ...value, exploration: Number(event.target.value) })
            }
          />
        </Field>
        <Notice>
          The learning policy needs {BANDIT.minimumSamples} rated independent
          live games per player, including at least {BANDIT.minimumPerOutcome}{' '}
          positive and {BANDIT.minimumPerOutcome} negative outcomes. Until then
          it uses MMR. It reads at most {BANDIT.maximumSamples} outcomes from
          the last {BANDIT.historyDays} days. Sample games and quiz accuracy
          never train it.
        </Notice>
        <Field id="discovery-reason" label="Reason for this policy change">
          <Textarea
            id="discovery-reason"
            required
            minLength={10}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Record the rollout or rollback decision and what will be measured."
          />
        </Field>
        <ActionButton
          type="submit"
          secondary
          busy={update.isPending}
          disabled={reason.trim().length < 10}
        >
          Save discovery policy
        </ActionButton>
        {update.error && <ErrorBox error={update.error} />}
        {update.isSuccess && (
          <Notice tone="success">
            Policy saved and recorded in the audit trail. Existing Daily sets
            are unchanged.
          </Notice>
        )}
      </form>
    </section>
  );
}
function StudioClaim() {
  const client = useQueryClient(),
    [form, setForm] = useState({
      steamUrl: '',
      ownerEmail: '',
      reason: '',
      ownershipVerified: false,
    });
  const claim = useMutation({
    mutationFn: () => api('admin/claim-studio', { body: form }),
    onSuccess: async () => {
      setForm({
        steamUrl: '',
        ownerEmail: '',
        reason: '',
        ownershipVerified: false,
      });
      await client.invalidateQueries({ queryKey: ['admin'] });
      await client.invalidateQueries({ queryKey: ['developer'] });
    },
  });
  return (
    <section className="surface settings-card">
      <h2>Verify a sample studio owner</h2>
      <p>
        Use this only after independently verifying the studio’s ownership. The
        owner must have signed in and must not already have a studio profile.
        All sample games belonging to that studio will require new materials and
        moderation; this does not approve their existing assets.
      </p>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          claim.mutate();
        }}
      >
        <Field
          id="claim-steam"
          label="Steam URL of a game in the sample catalog"
        >
          <TextInput
            id="claim-steam"
            type="url"
            required
            value={form.steamUrl}
            onChange={(event) =>
              setForm({ ...form, steamUrl: event.target.value })
            }
            placeholder="https://store.steampowered.com/app/…"
          />
        </Field>
        <Field id="claim-owner" label="Registered owner email">
          <TextInput
            id="claim-owner"
            type="email"
            required
            value={form.ownerEmail}
            onChange={(event) =>
              setForm({ ...form, ownerEmail: event.target.value })
            }
            autoComplete="off"
          />
        </Field>
        <Field id="claim-reason" label="How ownership was verified">
          <Textarea
            id="claim-reason"
            required
            minLength={20}
            maxLength={500}
            value={form.reason}
            onChange={(event) =>
              setForm({ ...form, reason: event.target.value })
            }
            placeholder="Record the verification method and evidence reference. Do not paste passwords or identity documents."
          />
        </Field>
        <label className="checkbox-row">
          <input
            type="checkbox"
            required
            checked={form.ownershipVerified}
            onChange={(event) =>
              setForm({ ...form, ownershipVerified: event.target.checked })
            }
          />
          <span>I verified that this account represents the studio.</span>
        </label>
        <ActionButton
          type="submit"
          secondary
          busy={claim.isPending}
          disabled={!form.ownershipVerified}
        >
          Assign verified studio ownership
        </ActionButton>
        {claim.error && <ErrorBox error={claim.error} />}
        {claim.isSuccess && (
          <Notice tone="success">
            Ownership assigned. The developer must submit new materials before
            live approval.
          </Notice>
        )}
      </form>
    </section>
  );
}
export function AdminPage() {
  const me = useMe(),
    tags = useTags(),
    client = useQueryClient(),
    [section, setSection] = useState('review'),
    [review, setReview] = useState<ReviewAction | null>(null),
    [reason, setReason] = useState(''),
    [search, setSearch] = useState(''),
    [price, setPrice] = useState<string | null>(null),
    [reconcile, setReconcile] = useState({
      paymentId: '',
      campaignId: '',
      reason: '',
    });
  const query = useQuery({
    queryKey: ['admin'],
    queryFn: () => api<AdminData>('admin'),
    enabled: me.data?.user?.role === 'admin',
  });
  const allTags = useQuery({
    queryKey: ['admin-tags'],
    queryFn: () => api<{ tags: SteamTag[] }>('admin/tags'),
    enabled: me.data?.user?.role === 'admin' && section === 'operations',
  });
  const moderate = useMutation({
    mutationFn: () => api('admin/moderate', { body: { ...review, reason } }),
    onSuccess: async () => {
      setReview(null);
      setReason('');
      await client.invalidateQueries({ queryKey: ['admin'] });
      await client.invalidateQueries({ queryKey: ['developer'] });
    },
  });
  const maintenance = useMutation({
    mutationFn: () =>
      api<{
        expiredDemoUsers: number;
        expiredRateBuckets: number;
        expiredAdOffers: number;
      }>('admin/maintenance', { body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin'] }),
  });
  const fund = useMutation({
    mutationFn: (campaignId: string) =>
      api('admin/fund-test', { body: { campaignId } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin'] }),
  });
  const updatePrice = useMutation({
    mutationFn: () =>
      api('admin/price', {
        method: 'PATCH',
        body: {
          impressionPriceCents: Number(
            price ?? query.data?.config.impressionPriceCents ?? 1,
          ),
        },
      }),
    onSuccess: async () => {
      setPrice(null);
      await client.invalidateQueries({ queryKey: ['billing-info'] });
      await client.invalidateQueries({ queryKey: ['admin'] });
    },
  });
  const tagUpdate = useMutation({
    mutationFn: (body: { id: number; active: boolean }) =>
      api('admin/tags', { method: 'PATCH', body }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin-tags'] });
      await client.invalidateQueries({ queryKey: ['tags'] });
      await client.invalidateQueries({ queryKey: ['admin'] });
    },
  });
  const reconcilePayment = useMutation({
    mutationFn: () => api('admin/reconcile', { body: reconcile }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin'] });
      setReconcile({ paymentId: '', campaignId: '', reason: '' });
    },
  });
  if (me.isPending) return <Loading />;
  if (me.error) return <ErrorBox error={me.error} />;
  if (!me.data?.user) return <AuthGate returnTo="/admin" />;
  if (me.data.user.role !== 'admin')
    return (
      <main className="container app-main">
        <Notice tone="warning">
          This workspace is available only to authorized administrators.
        </Notice>
      </main>
    );
  function buttons(type: string, id: string, name: string) {
    return (
      <div className="form-actions">
        {(type === 'report'
          ? ['resolve']
          : ['approve', 'request_changes', 'reject']
        ).map((action) => (
          <ActionButton
            secondary
            key={action}
            onClick={() => {
              setReview({
                type,
                id,
                action,
                name,
                versionId:
                  type === 'game'
                    ? query.data?.games.find((game) => game.id === id)
                        ?.current_version_id
                    : undefined,
              });
              setReason('');
            }}
          >
            {action === 'approve' ? <Check size={15} /> : null}
            {action === 'request_changes'
              ? 'Request changes'
              : action[0].toUpperCase() + action.slice(1)}
          </ActionButton>
        ))}
      </div>
    );
  }
  const data = query.data;
  return (
    <main className="container app-main">
      <PageHeading
        eyebrow="MODERATION WORKSPACE"
        title="Keep discovery honest."
        description="Review the materials, protect participant privacy, and watch actual launch metrics."
        action={<ShieldCheck className="accent-icon" size={32} />}
      />
      <fieldset
        className="filter-bar"

        aria-label="Administration section"
      >
        {[
          { id: 'review', label: 'Review queue' },
          { id: 'metrics', label: 'Product health' },
          { id: 'operations', label: 'Operations & data' },
        ].map((s) => (
          <ActionButton
            secondary
            key={s.id}
            aria-pressed={s.id === section}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </ActionButton>
        ))}
      </fieldset>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorBox error={query.error} />
      ) : (
        data && (
          <>
            {section === 'review' && (
              <>
                <section className="surface settings-card">
                  <h2>Game submissions</h2>
                  {!data.games.length ? (
                    <p className="muted-copy">
                      No live submissions. Sample catalog entries are not
                      approval-ready developer games.
                    </p>
                  ) : (
                    data.games.map((g) => (
                      <article key={g.id} className="review-card">
                        <div className="inline-labels">
                          <StatusBadge status={g.status} />
                          <span className="muted-copy">
                            {g.studio} · version {g.version}
                          </span>
                        </div>
                        <h3>{g.content.title}</h3>
                        <p>{g.content.description}</p>
                        <div className="review-images">
                          {[g.content.capsule, ...g.content.screenshots].map(
                            (src, i) => (
                              <a
                                key={i}
                                href={assetUrl(src)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <img
                                  src={assetUrl(src)}
                                  alt={
                                    i === 0
                                      ? 'Title-free artwork'
                                      : `Screenshot ${i}`
                                  }
                                  loading="lazy"
                                />
                              </a>
                            ),
                          )}
                        </div>
                        <p className="field-help">
                          First image: verify no title or developer logo. Verify
                          screenshot quality, ownership, and trailer
                          accessibility before approval.
                        </p>
                        <TagChips
                          ids={g.content.tagIds}
                          tags={tags.data?.tags ?? []}
                        />
                        <div className="form-actions">
                          <a
                            className="text-link"
                            href={g.content.steamUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Check Steam <ExternalLink size={14} />
                          </a>
                          {g.content.youtubeId && (
                            <a
                              className="text-link"
                              href={`https://www.youtube.com/watch?v=${g.content.youtubeId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Check trailer <ExternalLink size={14} />
                            </a>
                          )}
                        </div>
                        {buttons('game', g.id, g.content.title)}
                      </article>
                    ))
                  )}
                </section>
                <section className="surface settings-card">
                  <h2>Experiments awaiting review</h2>
                  {!data.experiments.length ? (
                    <p className="muted-copy">No pending experiments.</p>
                  ) : (
                    data.experiments.map((e) => (
                      <article className="review-card" key={e.id}>
                        <h3>{e.name}</h3>
                        <p>
                          {e.kind.replaceAll('_', ' ')}
                          {e.is_retest ? ' · explicit retest' : ''}
                        </p>
                        <ExperimentMaterials id={e.id} />
                        {buttons('experiment', e.id, e.name)}
                      </article>
                    ))
                  )}
                </section>
                <section className="surface settings-card">
                  <h2>Campaign review</h2>
                  {fund.error && <ErrorBox error={fund.error} />}{' '}
                  {!data.campaigns.length ? (
                    <p className="muted-copy">No campaigns submitted.</p>
                  ) : (
                    data.campaigns.map((c) => {
                      const creative = JSON.parse(c.creative_json);
                      return (
                        <article className="review-card" key={c.id}>
                          <div className="inline-labels">
                            <h3>
                              {c.name}
                              {c.is_test ? ' · LOCAL TEST' : ''}
                            </h3>
                            <StatusBadge status={c.moderation_status} />
                            <StatusBadge status={c.payment_status} />
                          </div>
                          <div className="review-ad">
                            <img
                              src={assetUrl(creative.image)}
                              alt="Sponsored creative"
                              loading="lazy"
                            />
                            <div>
                              <strong>{creative.title}</strong>
                              <p>{creative.description}</p>
                              <a
                                className="text-link"
                                href={creative.destination}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Review destination <ExternalLink size={14} />
                              </a>
                            </div>
                          </div>
                          <p>
                            {c.delivered} delivered / {c.paid_impressions} paid
                            / {c.requested_impressions} requested
                          </p>
                          {buttons('campaign', c.id, c.name)}
                          {data.config.localMode &&
                          c.is_test &&
                          !c.paid_impressions ? (
                            <ActionButton
                              secondary
                              busy={fund.isPending}
                              onClick={() => fund.mutate(c.id)}
                            >
                              Simulate local test funding
                            </ActionButton>
                          ) : null}
                        </article>
                      );
                    })
                  )}
                </section>
                <section className="surface settings-card">
                  <h2>Player reports</h2>
                  {!data.reports.length ? (
                    <p className="muted-copy">No open reports.</p>
                  ) : (
                    data.reports.map((r) => (
                      <article className="review-card" key={r.id}>
                        <h3>{r.reason}</h3>
                        <p>{r.details}</p>
                        <p className="field-help">Game: {r.game_id}</p>
                        {buttons('report', r.id, r.reason)}
                      </article>
                    ))
                  )}
                </section>
              </>
            )}
            {section === 'metrics' && (
              <>
                <Notice>
                  These numbers exclude anonymous demo users and sample-game
                  calibration. D7 retention remains unavailable until an
                  eligible live-beta cohort has aged eight days. Only opening a
                  quiz counts as starting a Daily. No traffic or retention is
                  simulated.
                </Notice>
                <div className="admin-metrics">
                  {[
                    { key: 'users', label: 'Registered users' },
                    { key: 'onboarded', label: 'Completed taste profiles' },
                    {
                      key: 'onboardingRate',
                      label: 'Taste calibration completion',
                      suffix: '%',
                    },
                    { key: 'approvedGames', label: 'Approved live games' },
                    { key: 'setsStarted', label: 'Live sets started · 7 days' },
                    {
                      key: 'setsCompleted',
                      label: 'Live sets completed · 7 days',
                    },
                    {
                      key: 'dailyCompletionRate',
                      label: 'Daily completion · 7 days',
                      suffix: '%',
                    },
                    {
                      key: 'qualifiedRounds',
                      label: 'Independent first impressions',
                    },
                    {
                      key: 'gamesWithUsefulSample',
                      label: 'Games with 100+ impressions',
                    },
                    { key: 'coverage', label: 'Catalog reached', suffix: '%' },
                    {
                      key: 'exposureGini',
                      label: 'Exposure inequality · Gini',
                      decimals: 3,
                    },
                    {
                      key: 'd7Retention',
                      label: 'Observed D7 retention',
                      suffix: '%',
                    },
                    { key: 'd7Cohort', label: 'Eligible D7 cohort' },
                    { key: 'ratedSets', label: 'Relevance ratings' },
                    {
                      key: 'positiveRelevanceRate',
                      label: 'Positive relevance ratings',
                      suffix: '%',
                    },
                    {
                      key: 'measuredDailySets',
                      label: 'Diversity sample · 30 days',
                    },
                    {
                      key: 'meanPairwiseSimilarity',
                      label: 'Mean pairwise tag similarity',
                      decimals: 3,
                    },
                    {
                      key: 'outsideFocusRatings',
                      label: 'Outside-focus intent ratings · 30 days',
                    },
                    {
                      key: 'serendipityRate',
                      label: 'Would play outside strongest genres',
                      suffix: '%',
                    },
                    {
                      key: 'calibratedDevelopers',
                      label: 'Studios with a 100-person version',
                    },
                    {
                      key: 'developerReturnRate',
                      label: 'Studio return after calibration',
                      suffix: '%',
                    },
                    {
                      key: 'developerIterationRate',
                      label: 'Studio iteration after calibration',
                      suffix: '%',
                    },
                    {
                      key: 'payingCampaigns',
                      label: 'Paid campaigns · excludes tests',
                    },
                    { key: 'payingAdvertisers', label: 'Paying advertisers' },
                    {
                      key: 'advertiserRepeatRate',
                      label: 'Advertisers buying again',
                      suffix: '%',
                    },
                  ].map((m) => (
                    <div className="surface" key={m.key}>
                      <Metric
                        label={m.label}
                        value={
                          data.metrics[m.key] == null
                            ? '—'
                            : `${Number(data.metrics[m.key]).toLocaleString('en-US', { maximumFractionDigits: m.decimals ?? 1 })}${m.suffix ?? ''}`
                        }
                      />
                    </div>
                  ))}
                </div>
                <section className="surface settings-card prose">
                  <h2>What these measurements mean</h2>
                  <p>
                    D7 is a signed-in return between 168 and 192 hours after an
                    account’s first authenticated visit while the live catalog
                    is enabled. Preview activity does not create a cohort. The
                    denominator includes only fully elapsed windows.
                  </p>
                  <p>
                    Diversity uses the frozen recommendation vectors for
                    complete three-game sets. The outside-focus proxy compares
                    games with the strongest chosen genres at assignment time
                    and includes only independent participants who explicitly
                    rated play intent. Older sets without these diagnostics are
                    excluded.
                  </p>
                  <p>
                    A studio becomes eligible after one material version
                    receives 100 independent first impressions. Return means a
                    later owner visit to the developer workspace; iteration
                    means a later material revision or experiment. Ad repurchase
                    counts only funded, non-test campaigns without a refunded
                    payment state.
                  </p>
                </section>
                <section className="surface settings-card">
                  <h2>Launch gates</h2>
                  <ul className="check-list">
                    <li>
                      Closed beta: 100 approved games with verified owners
                    </li>
                    <li>
                      Useful calibration: 100 independent participants per game
                    </li>
                    <li>
                      Privacy floor: 20 participants per published aggregate
                    </li>
                    <li>
                      Billing: live merchant configuration and verified webhooks
                    </li>
                    <li>
                      Public launch: legal identity, support contact, and
                      measured retention
                    </li>
                  </ul>
                  <p>
                    Catalog mode: <strong>{data.config.catalogMode}</strong>.
                    Billing:{' '}
                    <strong>
                      {data.config.billingEnabled ? 'enabled' : 'disabled'}
                    </strong>
                    . Turnstile:{' '}
                    <strong>
                      {data.config.turnstileEnabled
                        ? 'configured'
                        : 'not configured'}
                    </strong>
                    .
                  </p>
                </section>
              </>
            )}
            {section === 'operations' && (
              <>
                <section className="surface settings-card">
                  <h2>Storage and temporary data</h2>
                  <div className="stats-row">
                    <Metric
                      label="Database allocated"
                      value={
                        data.storage.databaseBytes == null
                          ? 'Unavailable'
                          : `${(data.storage.databaseBytes / 1048576).toFixed(2)} MB`
                      }
                    />
                    <Metric
                      label="Uploaded assets"
                      value={data.storage.assets ?? 0}
                      note={`${((data.storage.assetBytes ?? 0) / 1048576).toFixed(2)} MB stored`}
                    />
                    <Metric
                      label="Temporary entries"
                      value={
                        (data.storage.demoSessions ?? 0) +
                        (data.storage.adOffers ?? 0) +
                        (data.storage.rateLimitBuckets ?? 0)
                      }
                    />
                  </div>
                  <p>
                    Cleanup removes expired anonymous profiles, rate-limit
                    buckets, and old ad offers. Durable player progress stays
                    intact.
                  </p>
                  <ActionButton
                    secondary
                    busy={maintenance.isPending}
                    onClick={() => maintenance.mutate()}
                  >
                    Run expired-data cleanup
                  </ActionButton>
                  {maintenance.error && <ErrorBox error={maintenance.error} />}{' '}
                  {maintenance.data && (
                    <Notice tone="success">
                      Removed {maintenance.data.expiredDemoUsers} demo accounts,{' '}
                      {maintenance.data.expiredRateBuckets} rate buckets, and{' '}
                      {maintenance.data.expiredAdOffers} ad offers.
                    </Notice>
                  )}
                </section>
                <StudioClaim />
                <DiscoveryControls settings={data.config.discovery} />
                <section className="surface settings-card">
                  <h2>Discovery outcomes · last 30 days</h2>
                  <p>
                    Live sets only, grouped by the policy actually used. These
                    are observational groups with different players and periods,
                    not proof that one policy caused an improvement.
                  </p>
                  {!data.discovery.length ? (
                    <p>No live discovery cohorts yet.</p>
                  ) : (
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Policy</th>
                            <th>Sets</th>
                            <th>Started</th>
                            <th>Completed</th>
                            <th>Rated</th>
                            <th>Positive relevance</th>
                            <th>Mean similarity</th>
                            <th>Fallbacks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.discovery.map((row) => (
                            <tr key={row.policy}>
                              <td>
                                {row.policy === 'baseline'
                                  ? 'Personalized random'
                                  : row.policy === 'mmr'
                                    ? 'MMR'
                                    : 'Contextual exploration'}
                              </td>
                              <td>{row.sets.toLocaleString('en-US')}</td>
                              <td>{row.started.toLocaleString('en-US')}</td>
                              <td>{row.completed.toLocaleString('en-US')}</td>
                              <td>{row.rated.toLocaleString('en-US')}</td>
                              <td>
                                {row.rated
                                  ? `${Math.round((100 * row.positive) / row.rated)}%`
                                  : '—'}
                              </td>
                              <td>
                                {row.similarity === null
                                  ? '—'
                                  : row.similarity.toFixed(3)}
                              </td>
                              <td>{row.fallbacks.toLocaleString('en-US')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
                <section className="surface settings-card">
                  <h2>Fixed impression price</h2>
                  <form
                    className="input-with-action"
                    onSubmit={(e) => {
                      e.preventDefault();
                      updatePrice.mutate();
                    }}
                  >
                    <Field
                      id="impression-price"
                      label="US cents per viewable impression"
                    >
                      <TextInput
                        type="number"
                        min={1}
                        max={100}
                        required
                        id="impression-price"
                        value={
                          price ?? String(data.config.impressionPriceCents)
                        }
                        onChange={(e) => setPrice(e.target.value)}
                      />
                    </Field>
                    <ActionButton
                      secondary
                      busy={updatePrice.isPending}
                      type="submit"
                    >
                      Update price
                    </ActionButton>
                  </form>
                  {updatePrice.error && <ErrorBox error={updatePrice.error} />}{' '}
                  {updatePrice.isSuccess && (
                    <Notice tone="success">
                      New checkout price saved. Existing invoice amounts are
                      unchanged.
                    </Notice>
                  )}
                </section>
                <section className="surface settings-card">
                  <h2>Canonical Steam tag availability</h2>
                  <Field id="admin-tag-search" label="Search tags">
                    <TextInput
                      id="admin-tag-search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Find an active or inactive tag"
                    />
                  </Field>
                  {allTags.error && <ErrorBox error={allTags.error} />}{' '}
                  {tagUpdate.error && <ErrorBox error={tagUpdate.error} />}
                  <div className="admin-tag-list">
                    {allTags.data?.tags
                      .filter((t) =>
                        t.steam_name
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .slice(0, 30)
                      .map((t) => (
                        <label className="checkbox-row" key={t.id}>
                          <input
                            type="checkbox"
                            checked={t.is_active}
                            disabled={tagUpdate.isPending}
                            onChange={(e) =>
                              tagUpdate.mutate({
                                id: t.id,
                                active: e.target.checked,
                              })
                            }
                          />
                          <span>
                            {t.steam_name}
                            <small>
                              {' '}
                              · Steam #{t.id} · {t.category}
                            </small>
                          </span>
                        </label>
                      ))}
                  </div>
                  <p className="field-help">
                    Only availability changes. Canonical IDs and names are
                    preserved. At most 30 matching tags are shown.
                  </p>
                </section>
                <section className="surface settings-card">
                  <details>
                    <summary>
                      Recent administrator activity ({data.audit.length})
                    </summary>
                    <p className="field-help">
                      Latest 50 actions. The full audit trail remains in the
                      database. Times are UTC.
                    </p>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Time (UTC)</th>
                            <th>Target</th>
                            <th>Action</th>
                            <th>Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.audit.map((row) => (
                            <tr key={row.id}>
                              <td>
                                {new Date(row.created_at).toLocaleString(
                                  'en-US',
                                  { timeZone: 'UTC' },
                                )}
                              </td>
                              <td>
                                {row.target_type}
                                <small className="muted-copy">
                                  {' '}
                                  {row.target_id}
                                </small>
                              </td>
                              <td>{row.action}</td>
                              <td>{row.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!data.audit.length && <p>No administrator actions yet.</p>}
                  </details>
                </section>
                <section className="surface settings-card">
                  <h2>Unmatched verified purchases</h2>
                  <p>
                    Only reconcile a paid purchase after verifying the buyer and
                    campaign in the merchant account. Exact USD amount, an
                    unpaid campaign, and an audit reason are required.
                  </p>
                  {!data.unmatchedPayments.length ? (
                    <p className="muted-copy">No unmatched purchases.</p>
                  ) : (
                    <>
                      <div className="table-scroll">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Purchase reference</th>
                              <th>Amount</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.unmatchedPayments.map((p) => (
                              <tr key={p.id}>
                                <th>
                                  {p.external_payment_id}
                                  <small>{p.id}</small>
                                </th>
                                <td>
                                  {(p.amount_cents / 100).toFixed(2)}{' '}
                                  {p.currency}
                                </td>
                                <td>
                                  <StatusBadge status={p.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          reconcilePayment.mutate();
                        }}
                      >
                        <Field
                          id="reconcile-payment"
                          label="Verified paid purchase"
                        >
                          <select
                            id="reconcile-payment"
                            className="fng-input"
                            required
                            value={reconcile.paymentId}
                            onChange={(e) =>
                              setReconcile({
                                ...reconcile,
                                paymentId: e.target.value,
                              })
                            }
                          >
                            <option value="">Choose a paid purchase</option>
                            {data.unmatchedPayments
                              .filter((p) => p.status === 'paid')
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.external_payment_id}
                                </option>
                              ))}
                          </select>
                        </Field>
                        <Field
                          id="reconcile-campaign"
                          label="Matching unpaid campaign"
                        >
                          <select
                            id="reconcile-campaign"
                            className="fng-input"
                            required
                            value={reconcile.campaignId}
                            onChange={(e) =>
                              setReconcile({
                                ...reconcile,
                                campaignId: e.target.value,
                              })
                            }
                          >
                            <option value="">
                              Choose the verified buyer’s campaign
                            </option>
                            {data.campaigns
                              .filter(
                                (c) =>
                                  c.payment_status === 'unpaid' && !c.is_test,
                              )
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name} · {c.id}
                                </option>
                              ))}
                          </select>
                        </Field>
                        <Field
                          id="reconcile-reason"
                          label="Verification and audit reason"
                        >
                          <Textarea
                            id="reconcile-reason"
                            className="fng-textarea"
                            required
                            minLength={10}
                            maxLength={500}
                            value={reconcile.reason}
                            onChange={(e) =>
                              setReconcile({
                                ...reconcile,
                                reason: e.target.value,
                              })
                            }
                          />
                        </Field>
                        {reconcilePayment.error && (
                          <ErrorBox error={reconcilePayment.error} />
                        )}
                        <ActionButton
                          type="submit"
                          secondary
                          busy={reconcilePayment.isPending}
                        >
                          Reconcile verified purchase
                        </ActionButton>
                      </form>
                    </>
                  )}
                </section>
              </>
            )}
          </>
        )
      )}
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open) setReview(null);
        }}
      >
        <DialogContent className="fng-dialog">
          <DialogHeader>
            <DialogTitle>
              {review?.action === 'request_changes'
                ? 'Request changes'
                : review?.action === 'approve'
                  ? 'Approve'
                  : review?.action === 'resolve'
                    ? 'Resolve report'
                    : 'Reject'}
              : {review?.name}
            </DialogTitle>
            <DialogDescription>
              This action is recorded in the moderation audit. Explain the
              decision in English so the developer can act on it.
            </DialogDescription>
          </DialogHeader>
          <Field id="moderation-reason" label="Review reason">
            <Textarea
              id="moderation-reason"
              className="fng-textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              minLength={3}
              rows={4}
            />
          </Field>
          {moderate.error && <ErrorBox error={moderate.error} />}
          <ActionButton
            disabled={reason.trim().length < 3}
            busy={moderate.isPending}
            onClick={() => moderate.mutate()}
          >
            Confirm review
          </ActionButton>
        </DialogContent>
      </Dialog>
    </main>
  );
}
function ExperimentMaterials({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['admin-experiment', id],
    queryFn: () =>
      api<{ variants: { label: string; content: GameContent }[] }>(
        `admin/experiments/${id}`,
      ),
  });
  return query.error ? (
    <ErrorBox error={query.error} />
  ) : (
    <div className="account-grid">
      {query.data?.variants.map((v) => (
        <div key={v.label}>
          <h4>Variant {v.label}</h4>
          <img
            className="image-field-preview"
            src={assetUrl(v.content.capsule)}
            alt={`Variant ${v.label} artwork`}
            loading="lazy"
          />
          <p>{v.content.description}</p>
          <div className="review-images">
            {v.content.screenshots.map((src, i) => (
              <a
                href={assetUrl(src)}
                key={i}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src={assetUrl(src)}
                  alt={`Variant ${v.label} screenshot ${i + 1}`}
                  loading="lazy"
                />
              </a>
            ))}
          </div>
          {v.content.youtubeId && (
            <a
              className="text-link"
              href={`https://www.youtube.com/watch?v=${v.content.youtubeId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Review trailer <ExternalLink size={14} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
