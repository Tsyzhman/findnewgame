/* oxlint-disable next/no-img-element -- Artwork uses the size-bounded authenticated asset endpoint or an approved Steam CDN; a generic image optimizer would lose the session and clue access checks. Dimensions and loading behavior are controlled by the presentation. */
'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Bookmark,
  Download,
  ExternalLink,
  Heart,
  History,
  Settings,
  Shield,
  Trash2,
} from 'lucide-react';
import { api, assetUrl, useMe, useTags } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import { countNoun, formatCount } from '@/lib/format';
import type { GameContent } from '@/lib/types';
import {
  ActionButton,
  AuthGate,
  EmptyState,
  ErrorBox,
  Field,
  Loading,
  Metric,
  Notice,
  PageHeading,
  TextInput,
} from './product-ui';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';

const dateLabel = (value: string | number) =>
  new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    ...(typeof value === 'string' ? { timeZone: 'UTC' } : {}),
  }).format(new Date(typeof value === 'string' ? `${value}T12:00:00Z` : value));
export function AccountPage() {
  const me = useMe(),
    client = useQueryClient(),
    [confirmation, setConfirmation] = useState('');
  const exportData = useMutation({
    mutationFn: async () => {
      const data = await api<unknown>('account/export');
      await downloadBlob(
        new Blob([JSON.stringify(data, null, 2) + '\n'], {
          type: 'application/json',
        }),
        'findnewgame-data.json',
      );
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      api<{ ok: boolean }>('account', {
        method: 'DELETE',
        body: { confirmation },
      }),
    onSuccess: () => {
      client.clear();
      window.location.assign('/signout-with-chatgpt');
    },
  });
  if (me.isPending) return <Loading />;
  if (me.error) return <ErrorBox error={me.error} />;
  const user = me.data?.user;
  if (!user) return <AuthGate returnTo="/account" />;
  return (
    <main className="container app-main">
      <PageHeading
        eyebrow="YOUR SPACE"
        title={`Hello, ${user.displayName}.`}
        description="Your taste, your discoveries, and your data."
        action={
          <Link
            prefetch={false}
            className="button-secondary"
            href="/signout-with-chatgpt"
            target="_top"
          >
            Sign out
          </Link>
        }
      />
      <div className="account-grid">
        <section className="surface settings-card">
          <h2>Your discovery profile</h2>
          <dl className="detail-list">
            <div>
              <dt>Email</dt>
              <dd>{user.email ?? 'Not provided'}</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>{user.timezone}</dd>
            </div>
            <div>
              <dt>Discovery mode</dt>
              <dd className="capitalize">
                {user.taste?.discoveryMode ?? 'Not calibrated yet'}
              </dd>
            </div>
          </dl>
          <Link
            prefetch={false}
            className="button-primary"
            href={user.onboarded ? '/settings' : '/onboarding'}
          >
            <Settings size={17} />
            {user.onboarded ? 'Edit your taste' : 'Calibrate your taste'}
          </Link>
        </section>
        <section className="surface settings-card">
          <h2>Make yourself at home</h2>
          <div className="link-list">
            <Link prefetch={false} href="/today">
              <ArrowRight />
              Today’s three games
              <ArrowRight />
            </Link>
            <Link prefetch={false} href="/collection">
              <Bookmark />
              Saved & followed games
              <ArrowRight />
            </Link>
            <Link prefetch={false} href="/history">
              <History />
              Your discovery history
              <ArrowRight />
            </Link>
            <Link prefetch={false} href="/developer">
              <Heart />
              Developer workspace
              <ArrowRight />
            </Link>
            {user.role === 'admin' && (
              <Link prefetch={false} href="/admin">
                <Shield />
                Moderation workspace
                <ArrowRight />
              </Link>
            )}
          </div>
        </section>
      </div>
      <section className="surface settings-card data-controls">
        <div>
          <h2>Your data stays yours.</h2>
          <p>
            Developers only see aggregate results from eligible groups. They
            never receive your email or individual answers.
          </p>
        </div>
        <div className="form-actions">
          <ActionButton
            secondary
            busy={exportData.isPending}
            onClick={() => exportData.mutate()}
          >
            <Download size={17} />
            Export my data
          </ActionButton>
          <Dialog>
            <DialogTrigger render={<ActionButton secondary />}>
              <Trash2 size={16} />
              Delete account
            </DialogTrigger>
            <DialogContent className="fng-dialog">
              <DialogHeader>
                <DialogTitle>Delete your FindNewGame account?</DialogTitle>
                <DialogDescription>
                  This permanently removes your profile, preferences, guesses,
                  and history. Studio games are withdrawn and campaigns paused.
                  Required payment records remain without a user link. This does
                  not delete your ChatGPT account.
                </DialogDescription>
              </DialogHeader>
              <Field id="delete-confirmation" label="Type DELETE to confirm">
                <TextInput
                  id="delete-confirmation"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              {remove.error && <ErrorBox error={remove.error} />}
              <ActionButton
                disabled={confirmation !== 'DELETE'}
                busy={remove.isPending}
                onClick={() => remove.mutate()}
                className="danger-button"
              >
                Permanently delete account
              </ActionButton>
            </DialogContent>
          </Dialog>
        </div>
      </section>
      {exportData.error && <ErrorBox error={exportData.error} />}
    </main>
  );
}
type CollectionGame = {
  id: string;
  roundId: string;
  content: GameContent;
  saved: boolean;
  followed: boolean;
  date: number;
};
export function CollectionPage() {
  const me = useMe(),
    client = useQueryClient(),
    [filter, setFilter] = useState<'all' | 'saved' | 'followed'>('all');
  const query = useQuery({
    queryKey: ['collection'],
    queryFn: () => api<{ games: CollectionGame[] }>('collection'),
    enabled: !!me.data?.user,
  });
  const change = useMutation({
    mutationFn: (body: { roundId: string; kind: string; active: boolean }) =>
      api('interaction', { body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['collection'] }),
  });
  if (me.isPending) return <Loading />;
  if (me.error) return <ErrorBox error={me.error} />;
  if (!me.data?.user) return <AuthGate returnTo="/collection" />;
  const games = (query.data?.games ?? []).filter(
    (g) => filter === 'all' || (filter === 'saved' ? g.saved : g.followed),
  );
  return (
    <main className="container app-main">
      <PageHeading
        eyebrow="MY DISCOVERIES"
        title="Worth coming back to."
        description="Keep the games that caught your eye. Follow upcoming releases without affecting your quiz score."
        action={
          <Link prefetch={false} className="button-secondary" href="/history">
            View history <ArrowRight size={17} />
          </Link>
        }
      />
      <fieldset className="filter-bar" aria-label="Filter discoveries">
        {(['all', 'saved', 'followed'] as const).map((f) => (
          <ActionButton
            secondary
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === 'all'
              ? 'All discoveries'
              : f === 'saved'
                ? 'Saved games'
                : 'Following'}
          </ActionButton>
        ))}
      </fieldset>
      {change.error && <ErrorBox error={change.error} />}{' '}
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorBox error={query.error} />
      ) : !games.length ? (
        <EmptyState
          title="Your next favorite is still out there."
          description="Save a game or follow it after the reveal. It will be waiting for you here."
          action={
            <Link prefetch={false} className="button-primary" href="/today">
              Play today’s games <ArrowRight size={17} />
            </Link>
          }
        />
      ) : (
        <div className="collection-grid">
          {games.map((g) => (
            <article key={g.id} className="surface collection-card">
              <Link
                prefetch={false}
                href={`/play?round=${g.roundId}`}
                aria-label={`Revisit ${g.content.title}`}
              >
                <img
                  src={assetUrl(g.content.header ?? g.content.capsule)}
                  alt={g.content.title}
                  loading="lazy"
                />
              </Link>
              <div className="collection-body">
                <span className="eyebrow">DISCOVERED {dateLabel(g.date)}</span>
                <h2>{g.content.title}</h2>
                <p>{g.content.description}</p>
                <div className="form-actions">
                  <ActionButton
                    secondary
                    busy={change.isPending}
                    aria-pressed={g.saved}
                    onClick={() =>
                      change.mutate({
                        roundId: g.roundId,
                        kind: 'save',
                        active: !g.saved,
                      })
                    }
                  >
                    <Bookmark size={16} />
                    {g.saved ? 'Saved' : 'Save'}
                  </ActionButton>
                  <ActionButton
                    secondary
                    busy={change.isPending}
                    aria-pressed={g.followed}
                    onClick={() =>
                      change.mutate({
                        roundId: g.roundId,
                        kind: 'follow',
                        active: !g.followed,
                      })
                    }
                  >
                    <Heart size={16} />
                    {g.followed ? 'Following' : 'Follow'}
                  </ActionButton>
                  <a
                    className="text-link"
                    href={g.content.steamUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      void api('interaction', {
                        body: { roundId: g.roundId, kind: 'steam_click' },
                      }).catch(() => {})
                    }
                  >
                    Steam <ExternalLink size={14} />
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
type HistoryData = {
  sets: {
    id: string;
    local_date: string;
    completed_at: number | null;
    catalog_mode: string;
    totalScore: number;
    rounds: {
      assignment_id: string;
      title: string;
      score: number;
      accuracy: number;
      stage: number;
    }[];
  }[];
  nextCursor: string | null;
  specializations: { tagId: number; n: number; accuracy: number }[];
  notice: string;
};
export function HistoryPage() {
  const me = useMe(),
    tags = useTags(),
    [cursor, setCursor] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['history', cursor],
    queryFn: () =>
      api<HistoryData>(`history${cursor ? `?before=${cursor}` : ''}`),
    enabled: !!me.data?.user,
  });
  if (me.isPending) return <Loading />;
  if (me.error) return <ErrorBox error={me.error} />;
  if (!me.data?.user) return <AuthGate returnTo="/history" />;
  return (
    <main className="container app-main">
      <PageHeading
        eyebrow="YOUR DAILY RITUAL"
        title="A little more game curious."
        description="Revisit your reveals and see how your eye for games develops."
        action={
          <Link prefetch={false} className="button-primary" href="/today">
            Today’s games <ArrowRight size={17} />
          </Link>
        }
      />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorBox error={query.error} />
      ) : (
        <>
          {!!query.data?.specializations.length && (
            <section className="surface settings-card">
              <h2>Your strongest instincts</h2>
              <p>
                Based on your own completed rounds, with at least three games
                per genre.
              </p>
              <div className="stats-row">
                {query.data.specializations.map((s) => (
                  <Metric
                    key={s.tagId}
                    label={
                      tags.data?.tags.find((t) => t.id === s.tagId)
                        ?.steam_name ?? 'Genre'
                    }
                    value={`${Math.round(s.accuracy)}%`}
                    note={formatCount(s.n, 'game')}
                  />
                ))}
              </div>
            </section>
          )}
          {!query.data?.sets.length ? (
            <EmptyState
              title="The first chapter is yours to play."
              description="Your completed rounds will appear here, including sample rounds clearly marked as demo."
            />
          ) : (
            <div className="history-list">
              {query.data.sets.map((day) => (
                <section className="surface history-day" key={day.id}>
                  <header>
                    <div>
                      <h2>{dateLabel(day.local_date)}</h2>
                      <span className="muted-copy">
                        {day.catalog_mode === 'demo' ? 'Sample catalog · ' : ''}
                        {day.completed_at
                          ? 'Daily complete'
                          : `${day.rounds.length} / 3 completed`}
                      </span>
                    </div>
                    <strong>
                      {day.totalScore.toLocaleString('en-US')}
                      <small> {countNoun(day.totalScore, 'point')}</small>
                    </strong>
                  </header>
                  {day.rounds.length ? (
                    day.rounds.map((r) => (
                      <Link
                        prefetch={false}
                        key={r.assignment_id}
                        href={`/play?round=${r.assignment_id}`}
                        className="history-round"
                      >
                        <span>{r.title}</span>
                        <span>
                          {Math.round(r.accuracy)}% match{' '}
                          <b>
                            {r.score.toLocaleString('en-US')}{' '}
                            {countNoun(r.score, 'pt')}
                          </b>
                          <ArrowRight size={16} />
                        </span>
                      </Link>
                    ))
                  ) : (
                    <p>No finished rounds that day.</p>
                  )}
                </section>
              ))}
            </div>
          )}
          <div className="form-actions">
            {cursor && (
              <ActionButton secondary onClick={() => setCursor(null)}>
                Back to latest
              </ActionButton>
            )}
            {query.data?.nextCursor && (
              <ActionButton
                secondary
                onClick={() => setCursor(query.data!.nextCursor)}
              >
                Older discoveries <ArrowRight size={16} />
              </ActionButton>
            )}
          </div>
        </>
      )}
    </main>
  );
}
type BillingInfo = {
  enabled: boolean;
  lavaConfigured: boolean;
  tributeConfigured: boolean;
  tributeDonationUrl: string | null;
  impressionPriceCents: number;
  currency: string;
};
export function SupportPage() {
  const query = useQuery({
    queryKey: ['billing-info'],
    queryFn: () => api<BillingInfo>('billing/info'),
  });
  const donate = useMutation({
    mutationFn: (provider: string) =>
      api<{ url: string }>('support', { body: { provider } }),
    onSuccess: (data) => window.location.assign(data.url),
  });
  return (
    <main className="container app-main">
      <PageHeading
        eyebrow="KEEP THE DISCOVERIES COMING"
        title="A small project, a shared curiosity."
        description="FindNewGame is free to play and free for developers to submit their games."
      />
      <div className="account-grid">
        <section className="surface settings-card">
          <Heart size={30} className="accent-icon" />
          <h2>Support the project</h2>
          <p>
            Optional contributions help cover hosting, storage, and the work
            behind the daily ritual.
          </p>
          <p>
            Donating never buys a higher score, extra daily games, better
            recommendations, or more organic exposure.
          </p>
          {query.isPending ? (
            <Loading label="Checking support options…" />
          ) : query.error ? (
            <ErrorBox error={query.error} />
          ) : !query.data?.enabled ? (
            <Notice>
              Donations are not enabled in this beta. No payment will be taken.
            </Notice>
          ) : (
            <div className="form-actions">
              <ActionButton
                disabled={!query.data.lavaConfigured}
                busy={donate.isPending}
                onClick={() => donate.mutate('lava')}
              >
                Support with Lava <ExternalLink size={16} />
              </ActionButton>
              <ActionButton
                secondary
                disabled={!query.data.tributeDonationUrl}
                busy={donate.isPending}
                onClick={() => donate.mutate('tribute')}
              >
                Support with Tribute <ExternalLink size={16} />
              </ActionButton>
            </div>
          )}
          {donate.error && <ErrorBox error={donate.error} />}
        </section>
        <section className="surface settings-card">
          <h2>Other ways to help</h2>
          <div className="prose">
            <p>
              Share your spoiler-free daily result. Invite someone with a
              different taste in games. Report a broken clue from inside the
              quiz.
            </p>
            <p>
              If you make games, submit a complete, title-free presentation and
              help us build a catalog worth exploring.
            </p>
          </div>
          <Link prefetch={false} className="button-secondary" href="/developer">
            Meet your next players <ArrowRight size={17} />
          </Link>
        </section>
      </div>
    </main>
  );
}
