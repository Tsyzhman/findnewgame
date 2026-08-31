'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CreditCard,
  ExternalLink,
  Pause,
  Play,
  Plus,
} from 'lucide-react';
import { api, useMe, useTags } from '@/lib/api';
import type { AudienceTarget } from '@/lib/advertising';
import {
  DeveloperShell,
  ImageField,
  useWorkspace,
} from './developer-workspace';
import {
  ActionButton,
  ErrorBox,
  Field,
  Loading,
  Metric,
  Notice,
  StatusBadge,
  TextInput,
} from './product-ui';
import { TagPicker } from './tag-picker';
import { Textarea } from '@/components/ui/textarea';
type Billing = {
  enabled: boolean;
  lavaConfigured: boolean;
  tributeConfigured: boolean;
  impressionPriceCents: number;
  currency: string;
};
type Payment = {
  id: string;
  provider: string;
  purpose: string;
  amount_cents: number;
  currency: string;
  status: string;
  created_at: number;
  checkout_url: string | null;
};
const money = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
    cents / 100,
  );
const localInputDate = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
export function CampaignsPage() {
  const me = useMe(),
    workspace = useWorkspace(),
    tags = useTags(),
    client = useQueryClient(),
    [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    title: '',
    description: '',
    image: '',
    destination: '',
    gameId: '',
    impressions: 1000,
    startAt: '',
    endAt: '',
    isTest: false,
  });
  const [target, setTarget] = useState<AudienceTarget>({
    include: [],
    exclude: [],
    mode: 'any',
    minimum: 1,
  });
  const billing = useQuery({
    queryKey: ['billing-info'],
    queryFn: () => api<Billing>('billing/info'),
  });
  const history = useQuery({
    queryKey: ['billing-history'],
    queryFn: () => api<{ payments: Payment[] }>('billing/history'),
    enabled: !!workspace.data?.developer,
  });
  const estimate = useMutation({
    mutationFn: () =>
      api<{ range: string; dailyRange: string; privacySuppressed: boolean }>(
        'campaigns/audience',
        { body: target },
      ),
  });
  const create = useMutation({
    mutationFn: () =>
      api('campaigns', {
        body: {
          ...draft,
          startAt: new Date(draft.startAt).toISOString(),
          endAt: new Date(draft.endAt).toISOString(),
          targeting: target,
        },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['developer'] });
      setShowForm(false);
    },
  });
  const state = useMutation({
    mutationFn: (body: { id: string; status: string }) =>
      api(`campaigns/${body.id}`, {
        method: 'PATCH',
        body: { status: body.status },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['developer'] }),
  });
  const pay = useMutation({
    mutationFn: (campaignId: string) =>
      api<{ url: string }>('billing/checkout', {
        body: { campaignId, provider: 'lava' },
      }),
    onSuccess: (data) => window.location.assign(data.url),
    onSettled: () =>
      client.invalidateQueries({ queryKey: ['billing-history'] }),
  });
  function updateTarget(value: AudienceTarget) {
    setTarget(value);
    estimate.reset();
  }
  return (
    <DeveloperShell
      title="Reach the right kind of curious."
      description="Clearly labeled placements, Steam-tag audiences, and a fixed impression budget. Organic discovery stays independent."
      action={
        <ActionButton
          onClick={() => {
            setShowForm(!showForm);
            if (!draft.startAt)
              setDraft({
                ...draft,
                startAt: localInputDate(new Date()),
                endAt: localInputDate(new Date(Date.now() + 7 * 86400000)),
              });
          }}
          secondary={showForm}
        >
          <Plus size={17} />
          {showForm ? 'Close campaign form' : 'Create a campaign'}
        </ActionButton>
      }
    >
      {!billing.data?.enabled && (
        <Notice>
          Paid delivery is disabled in this beta. You can prepare a campaign,
          but checkout stays unavailable until the merchant account is
          configured.
        </Notice>
      )}
      <div className="stats-row surface">
        <Metric
          label="Campaigns"
          value={workspace.data?.campaigns.length ?? 0}
        />
        <Metric
          label="Viewable impressions"
          value={
            workspace.data?.campaigns.reduce((n, c) => n + c.delivered, 0) ?? 0
          }
          note="50% visible for one continuous second"
        />
        <Metric
          label="Current price"
          value={
            billing.data
              ? `${money(billing.data.impressionPriceCents * 1000)} / 1,000`
              : '—'
          }
          note="Fixed price, no bidding"
        />
      </div>
      {showForm && (
        <form
          className="editor-layout"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="editor-main">
            <section className="surface settings-card">
              <h2>1. The sponsored card</h2>
              <div className="form-grid">
                <Field id="campaign-name" label="Internal campaign name">
                  <TextInput
                    id="campaign-name"
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                    required
                    minLength={3}
                    maxLength={100}
                  />
                </Field>
                <Field id="campaign-game" label="Your game (optional)">
                  <select
                    className="fng-input"
                    id="campaign-game"
                    value={draft.gameId}
                    onChange={(e) =>
                      setDraft({ ...draft, gameId: e.target.value })
                    }
                  >
                    <option value="">Studio campaign</option>
                    {workspace.data?.games.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.content.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="ad-title" label="Public ad title">
                  <TextInput
                    id="ad-title"
                    value={draft.title}
                    onChange={(e) =>
                      setDraft({ ...draft, title: e.target.value })
                    }
                    required
                    minLength={3}
                    maxLength={80}
                  />
                </Field>
                <Field id="ad-destination" label="Destination URL">
                  <TextInput
                    id="ad-destination"
                    type="url"
                    value={draft.destination}
                    onChange={(e) =>
                      setDraft({ ...draft, destination: e.target.value })
                    }
                    required
                    placeholder="https://store.steampowered.com/app/…"
                  />
                </Field>
              </div>
              <Field id="ad-description" label="Public ad description">
                <Textarea
                  id="ad-description"
                  className="fng-textarea"
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  required
                  minLength={10}
                  maxLength={180}
                  rows={3}
                />
              </Field>
              <ImageField
                id="ad-image"
                label="Ad image"
                value={draft.image}
                onChange={(value) => setDraft({ ...draft, image: value })}
              />
            </section>
            <section className="surface settings-card">
              <h2>2. The audience</h2>
              <p>Match explicit Steam-tag interests. Exclusions always win.</p>
              {tags.data && (
                <>
                  <TagPicker
                    tags={tags.data.tags}
                    value={target.include}
                    onChange={(value) =>
                      updateTarget({
                        ...target,
                        include: value,
                        minimum: Math.min(
                          target.minimum,
                          Math.max(1, value.length),
                        ),
                      })
                    }
                    exclude={target.exclude}
                    max={15}
                    label="Include these interests"
                  />
                  <div className="form-grid">
                    <Field id="target-mode" label="Match rule">
                      <select
                        className="fng-input"
                        id="target-mode"
                        value={target.mode}
                        onChange={(e) =>
                          updateTarget({
                            ...target,
                            mode: e.target.value as AudienceTarget['mode'],
                          })
                        }
                      >
                        <option value="any">Any selected interest</option>
                        <option value="at_least_n">
                          At least N selected interests
                        </option>
                      </select>
                    </Field>
                    {target.mode === 'at_least_n' && (
                      <Field id="target-minimum" label="Minimum matching tags">
                        <TextInput
                          id="target-minimum"
                          type="number"
                          min={1}
                          max={target.include.length || 1}
                          value={target.minimum}
                          onChange={(e) =>
                            updateTarget({
                              ...target,
                              minimum: Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                    )}
                  </div>
                  <TagPicker
                    tags={tags.data.tags}
                    value={target.exclude}
                    onChange={(value) =>
                      updateTarget({ ...target, exclude: value })
                    }
                    exclude={target.include}
                    max={15}
                    label="Exclude these interests"
                    compact
                  />
                </>
              )}
              <ActionButton
                type="button"
                secondary
                busy={estimate.isPending}
                disabled={!target.include.length}
                onClick={() => estimate.mutate()}
              >
                Estimate audience
              </ActionButton>
              {estimate.error && <ErrorBox error={estimate.error} />}{' '}
              {estimate.data && (
                <Notice>
                  Active audience: {estimate.data.range}. Daily delivery range:{' '}
                  {estimate.data.dailyRange}. This is an estimate, not
                  guaranteed inventory.
                </Notice>
              )}
            </section>
            <section className="surface settings-card">
              <h2>3. Budget and schedule</h2>
              <div className="form-grid">
                <Field
                  id="ad-budget"
                  label="Requested impressions (100–1,000,000)"
                >
                  <TextInput
                    id="ad-budget"
                    type="number"
                    min={100}
                    max={1000000}
                    step={1}
                    required
                    value={draft.impressions}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        impressions: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field id="ad-start" label="Starts (your device time)">
                  <TextInput
                    id="ad-start"
                    type="datetime-local"
                    required
                    value={draft.startAt}
                    onChange={(e) =>
                      setDraft({ ...draft, startAt: e.target.value })
                    }
                  />
                </Field>
                <Field id="ad-end" label="Ends (up to 90 days)">
                  <TextInput
                    id="ad-end"
                    type="datetime-local"
                    required
                    value={draft.endAt}
                    onChange={(e) =>
                      setDraft({ ...draft, endAt: e.target.value })
                    }
                  />
                </Field>
              </div>
              {me.data?.user?.isLocal && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={draft.isTest}
                    onChange={(e) =>
                      setDraft({ ...draft, isTest: e.target.checked })
                    }
                  />
                  <span>
                    Local test campaign — simulated funding only, never live
                    billing.
                  </span>
                </label>
              )}
            </section>
          </div>
          <aside>
            <section className="surface settings-card sticky-panel">
              <p className="eyebrow">CAMPAIGN ESTIMATE</p>
              <p className="estimate-price">
                {billing.data
                  ? money(draft.impressions * billing.data.impressionPriceCents)
                  : '—'}
              </p>
              <p>
                {draft.impressions.toLocaleString('en-US')} viewable impressions
              </p>
              <ul className="check-list">
                <li>Moderation before delivery</li>
                <li>Payment before activation</li>
                <li>One impression per person per day</li>
                <li>Paced over your campaign window</li>
                <li>No placement in your own game</li>
              </ul>
              {create.error && <ErrorBox error={create.error} />}
              <ActionButton
                type="submit"
                busy={create.isPending}
                disabled={!target.include.length || !draft.image}
              >
                Submit for review <ArrowRight size={16} />
              </ActionButton>
              <p className="field-help">
                No charge is made by this action. Final pricing is shown before
                checkout. Delivery stops at the purchased limit.
              </p>
            </section>
          </aside>
        </form>
      )}
      {create.isSuccess && !showForm && (
        <Notice tone="success">Campaign saved and queued for review.</Notice>
      )}
      {state.error && <ErrorBox error={state.error} />}{' '}
      {pay.error && <ErrorBox error={pay.error} />}
      <section className="surface settings-card">
        <h2>Your campaigns</h2>
        {!workspace.data?.campaigns.length ? (
          <p className="muted-copy">
            No campaigns yet. Your games can receive organic discovery without
            buying ads.
          </p>
        ) : (
          <div className="campaign-list">
            {workspace.data.campaigns.map((c) => (
              <article key={c.id} className="campaign-row">
                <div>
                  <h3>
                    {c.name}
                    {c.is_test ? ' · local test' : ''}
                  </h3>
                  <div className="inline-labels">
                    <StatusBadge status={c.moderation_status} />
                    <StatusBadge status={c.payment_status} />
                    <StatusBadge status={c.status} />
                  </div>
                  <p>
                    {c.delivered.toLocaleString('en-US')} /{' '}
                    {c.paid_impressions.toLocaleString('en-US')} paid
                    impressions · {c.clicks} clicks ·{' '}
                    {c.delivered
                      ? ((100 * c.clicks) / c.delivered).toFixed(1)
                      : '0.0'}
                    % CTR
                  </p>
                  <p className="field-help">
                    Window: {new Date(c.start_at).toLocaleDateString('en-US')} –{' '}
                    {new Date(c.end_at).toLocaleDateString('en-US')}
                  </p>
                  {c.moderation_note && (
                    <p className="moderation-note">
                      Review: {c.moderation_note}
                    </p>
                  )}
                </div>
                <div className="form-actions">
                  {c.payment_status === 'paid' &&
                  c.moderation_status === 'approved' ? (
                    <ActionButton
                      secondary
                      busy={state.isPending}
                      onClick={() =>
                        state.mutate({
                          id: c.id,
                          status: c.status === 'active' ? 'paused' : 'active',
                        })
                      }
                    >
                      {c.status === 'active' ? (
                        <Pause size={16} />
                      ) : (
                        <Play size={16} />
                      )}{' '}
                      {c.status === 'active' ? 'Pause' : 'Resume'}
                    </ActionButton>
                  ) : (
                    !c.is_test &&
                    c.payment_status !== 'paid' && (
                      <ActionButton
                        secondary
                        disabled={
                          !billing.data?.enabled ||
                          !billing.data.lavaConfigured ||
                          c.moderation_status !== 'approved'
                        }
                        busy={pay.isPending}
                        onClick={() => pay.mutate(c.id)}
                      >
                        <CreditCard size={16} />
                        Fund{' '}
                        {billing.data
                          ? money(
                              c.requested_impressions *
                                billing.data.impressionPriceCents,
                            )
                          : ''}
                      </ActionButton>
                    )
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="surface settings-card">
        <h2>Billing history</h2>
        <p>
          Provider callbacks, not the return URL, confirm payment. An uncertain
          invoice needs reconciliation before another attempt.
        </p>
        {history.isPending ? (
          <Loading label="Loading billing history…" />
        ) : history.error ? (
          <ErrorBox error={history.error} />
        ) : !history.data?.payments.length ? (
          <p className="muted-copy">
            No payment records. Nothing has been charged.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Provider</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {history.data.payments.map((p) => (
                  <tr key={p.id}>
                    <th>
                      {new Date(p.created_at).toLocaleDateString('en-US')}
                    </th>
                    <td className="capitalize">{p.provider}</td>
                    <td>{money(p.amount_cents, p.currency)}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td>
                      {p.checkout_url && p.status === 'pending' ? (
                        <a
                          className="text-link"
                          href={p.checkout_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open invoice <ExternalLink size={14} />
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Notice>
          Automatic campaign invoicing uses Lava. Tribute creator payments
          require signed purchase reconciliation; they are never automatically
          mapped to an unrelated campaign.
        </Notice>
      </section>
    </DeveloperShell>
  );
}
