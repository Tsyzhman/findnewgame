'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarDays,
  Check,
  Compass,
  Flame,
  LockKeyhole,
  Settings2,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { api, useMe } from '@/lib/api';
import type { DailyView } from '@/lib/types';
import {
  AuthGate,
  EmptyState,
  ErrorBox,
  Loading,
  Metric,
  Notice,
  PageHeading,
} from './product-ui';

export function ResetCountdown({ at }: { at: number }) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    const update = () => {
      const ms = Math.max(0, at - Date.now()),
        h = Math.floor(ms / 3600000),
        m = Math.floor(ms / 60000) % 60;
      setRemaining(ms ? `${h}h ${m}m` : 'Ready now');
    };
    update();
    const timer = setInterval(update, 30000);
    return () => clearInterval(timer);
  }, [at]);
  return <span>{remaining || 'at your local midnight'}</span>;
}
export function DailyHub() {
  const me = useMe();
  const day = useQuery({
    queryKey: ['daily', 'player'],
    queryFn: ({ signal }) => api<DailyView>('daily', { body: {}, signal }),
    enabled: !!me.data?.user?.onboarded,
    retry: false,
  });
  if (me.isPending) return <Loading />;
  if (me.error) return <ErrorBox error={me.error} retry={() => me.refetch()} />;
  if (!me.data?.user) return <AuthGate />;
  if (!me.data.user.onboarded)
    return (
      <EmptyState
        title="A few favorites make all the difference."
        description="Tell us what you enjoy before we pick your first three. It takes a minute or two."
        action={
          <Link prefetch={false} href="/onboarding" className="button-primary">
            Calibrate my taste <ArrowRight size={17} />
          </Link>
        }
      />
    );
  if (day.isPending)
    return (
      <Loading label="Picking three games from your corner of the indie world…" />
    );
  if (day.error)
    return <ErrorBox error={day.error} retry={() => day.refetch()} />;
  const daily = day.data!,
    completed = daily.slots.filter((s) => s.status === 'complete').length;
  return (
    <>
      <PageHeading
        eyebrow="YOUR DAILY THREE"
        title={
          daily.complete
            ? 'Three discoveries. A day well played.'
            : `Hello, ${me.data.user.displayName}. Stay curious.`
        }
        description={
          daily.complete
            ? 'Your discoveries are waiting in your collection. Come back tomorrow for a new set.'
            : 'Three games chosen by your taste, with a little room for chance.'
        }
        action={
          <Link prefetch={false} className="button-secondary" href="/settings">
            <Settings2 size={17} /> Tune my taste
          </Link>
        }
      />
      {daily.catalogMode === 'demo' && (
        <Notice>
          This private beta uses a sample catalog. Scores are real; sample
          rounds never enter live developer analytics.
        </Notice>
      )}
      <section className="daily-board surface">
        <div className="daily-board-header">
          <div>
            <CalendarDays size={18} />
            <span>
              {new Date(`${daily.date}T12:00:00Z`).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
          <span>
            {completed} / {daily.slots.length} discovered
          </span>
        </div>
        <div className="daily-cards">
          {daily.slots.map((slot, i) => (
            <Link
              prefetch={false}
              key={slot.id}
              href={`/play?round=${slot.id}`}
              className={`daily-card ${slot.status === 'complete' ? 'complete' : ''}`}
            >
              <div className="mystery-window">
                <span className="mystery-number">0{i + 1}</span>
                <span className="mystery-icon">
                  {slot.status === 'complete' ? (
                    <Check size={34} />
                  ) : (
                    <Compass size={38} strokeWidth={1.2} />
                  )}
                </span>
                <span className="mystery-kind">
                  {slot.status === 'complete'
                    ? 'DISCOVERED'
                    : slot.status === 'playing'
                      ? 'IN PROGRESS'
                      : 'A NEW POSSIBILITY'}
                </span>
              </div>
              <div className="daily-card-copy">
                <h2>{slot.title ?? `Mystery game ${i + 1}`}</h2>
                <p>
                  {slot.status === 'complete'
                    ? `${slot.score?.toLocaleString('en-US')} points · ${slot.accuracy}% accuracy`
                    : 'An unknown game. Your fresh perspective.'}
                </p>
                <span className="text-link">
                  {slot.status === 'complete'
                    ? 'See your discovery'
                    : slot.status === 'playing'
                      ? 'Continue the clues'
                      : 'Take a closer look'}{' '}
                  <ArrowRight size={16} />
                </span>
              </div>
            </Link>
          ))}
        </div>
        {!daily.slots.length && (
          <EmptyState
            title="You’ve explored this corner of the catalog."
            description="There are no unseen games that meet your hard-no rules. We won’t repeat a game or weaken those rules to fill a slot."
            action={
              <Link
                prefetch={false}
                href="/settings"
                className="button-secondary"
              >
                Review my preferences
              </Link>
            }
          />
        )}
        {daily.shortage && daily.slots.length > 0 && (
          <Notice tone="warning">
            Only {daily.slots.length} eligible{' '}
            {daily.slots.length === 1 ? 'game is' : 'games are'} left today. We
            never fill empty slots with repeats. A streak day requires all three
            games.
          </Notice>
        )}
        <div className="daily-board-footer">
          <span>
            <LockKeyhole size={15} /> This set is yours for the whole day.
          </span>
          <span>
            Next discovery in <ResetCountdown at={daily.resetAt} />
          </span>
        </div>
      </section>
      <div className="metrics-row">
        <Metric
          label="Current streak"
          value={
            <>
              <Flame size={24} />
              {daily.currentStreak} days
            </>
          }
          note="Every completed three counts"
        />
        <Metric
          label="Today’s score"
          value={
            <>
              <Trophy size={23} />
              {daily.totalScore.toLocaleString('en-US')}
            </>
          }
          note="Up to 3,000 points"
        />
        <Metric
          label="Personal best streak"
          value={`${daily.bestStreak} days`}
          note="No perfect guesses required"
        />
      </div>
      {daily.complete && (
        <Link prefetch={false} href="/play" className="button-primary">
          Share today’s result <Sparkles size={17} />
        </Link>
      )}
      <div className="hub-note">
        <Compass size={19} />
        <p>
          Your taste chooses the pool. Chance chooses the games.{' '}
          <Link prefetch={false} href="/about">
            Here’s how it works.
          </Link>
        </p>
        <Link prefetch={false} href="/history" className="text-link">
          Your past discoveries <ArrowRight size={16} />
        </Link>
      </div>
    </>
  );
}
export function HomeSwitch({ children }: { children: React.ReactNode }) {
  const me = useMe();
  return me.data?.user?.onboarded ? (
    <main className="container product-page">
      <DailyHub />
    </main>
  ) : (
    <>{children}</>
  );
}
