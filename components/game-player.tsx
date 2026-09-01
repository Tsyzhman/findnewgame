/* oxlint-disable next/no-img-element -- Artwork uses the size-bounded authenticated asset endpoint or an approved Steam CDN; a generic image optimizer would lose the session and clue access checks. Dimensions and loading behavior are controlled by the presentation. */
'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  CircleHelp,
  Eye,
  ExternalLink,
  Flag,
  ImageIcon,
  Layers3,
  LockKeyhole,
  Play,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, useMe, useTags, signInPath } from '@/lib/api';
import { CONFIG, EMPTY_GUESS } from '@/lib/config';
import { countNoun, formatCount } from '@/lib/format';
import type {
  DailyView,
  GameContent,
  GuessSnapshot,
  RoundView,
  SteamTag,
} from '@/lib/types';
import {
  ActionButton,
  AuthGate,
  EmptyState,
  ErrorBox,
  Field,
  Loading,
  Notice,
} from './product-ui';
import { TagPicker, TagChips } from './tag-picker';
import { SecurityCheck } from './turnstile';
import { ShareResult } from './share-result';
import { AdSlot } from './ad-slot';
import { ResetCountdown } from './daily-hub';
import { TrailerClip } from './trailer-clip';

const CLUE_TIMELINE_LABELS = [
  { full: 'Artwork', compact: 'Artwork' },
  { full: 'Screenshot', compact: 'Screen' },
  { full: 'Gallery', compact: 'Gallery' },
  { full: 'Trailer / teaser', compact: 'Trailer' },
] as const;

export function GamePlayer() {
  const params = useSearchParams(),
    demo = params.get('demo') === '1',
    me = useMe(),
    tagQuery = useTags(),
    client = useQueryClient();
  const [token, setToken] = useState(''),
    [demoApproved, setDemoApproved] = useState(false),
    [activeId, setActiveId] = useState(params.get('round') ?? ''),
    [showSummary, setShowSummary] = useState(false),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [guess, setGuess] = useState<GuessSnapshot>({ ...EMPTY_GUESS }),
    [group, setGroup] = useState('genre'),
    [viewedStage, setViewedStage] = useState(1),
    [guessRoundKey, setGuessRoundKey] = useState('');
  const siteKey = me.data?.site.turnstileSiteKey ?? null;
  const demoSession = useQuery({
    queryKey: ['demo-session'],
    queryFn: () => api('demo', { body: { turnstileToken: token } }),
    enabled: demo && !!me.data && (!siteKey || demoApproved),
    staleTime: Infinity,
    retry: false,
  });
  const day = useQuery({
    queryKey: ['daily', demo ? 'demo' : 'player'],
    queryFn: ({ signal }) =>
      api<DailyView>(`daily${demo ? '?demo=1' : ''}`, { body: {}, signal }),
    enabled: demo ? demoSession.isSuccess : !!me.data?.user?.onboarded,
    retry: false,
  });
  const selectedId =
    activeId || day.data?.slots.find((s) => s.status !== 'complete')?.id || '';
  const roundQuery = useQuery({
    queryKey: ['round', selectedId, demo],
    queryFn: ({ signal }) =>
      api<RoundView>(`round/${selectedId}/start${demo ? '?demo=1' : ''}`, {
        body: {},
        signal,
      }),
    enabled: !!selectedId && !showSummary,
    retry: false,
  });
  const round = roundQuery.data;
  const currentRoundKey = round
    ? `${round.id}:${round.stage}:${round.status}`
    : '';
  if (round && currentRoundKey !== guessRoundKey) {
    setGuessRoundKey(currentRoundKey);
    setGuess(structuredClone(round.guesses));
    setError(null);
    setGroup('genre');
    setViewedStage(round.stage);
  }
  if (me.isPending || tagQuery.isPending) return <Loading />;
  if (me.error || tagQuery.error)
    return <ErrorBox error={me.error ?? tagQuery.error} />;
  if (!demo && !me.data?.user) return <AuthGate returnTo="/onboarding" />;
  if (!demo && !me.data?.user?.onboarded)
    return (
      <EmptyState
        title="Let’s find your corner of the indie world."
        description="Your three games start with your taste. Pick a few favorite tags first."
        action={
          <Link prefetch={false} href="/onboarding" className="button-primary">
            Calibrate my taste <ArrowRight size={17} />
          </Link>
        }
      />
    );
  if (demo && siteKey && !demoApproved)
    return (
      <div className="auth-card surface">
        <h1>A quick check, then let’s play.</h1>
        <p>This keeps the sample catalog free from bots.</p>
        <SecurityCheck siteKey={siteKey} onToken={setToken} />
        <ActionButton disabled={!token} onClick={() => setDemoApproved(true)}>
          Start my demo <Play size={17} />
        </ActionButton>
      </div>
    );
  if (demoSession.error || day.error)
    return (
      <ErrorBox
        error={demoSession.error ?? day.error}
        retry={() => {
          void demoSession.refetch();
          void day.refetch();
        }}
      />
    );
  if (!day.data) return <Loading label="Preparing your three mysteries…" />;
  const daily = day.data,
    tags = tagQuery.data!.tags;
  if (
    showSummary ||
    (daily.slots.length > 0 &&
      daily.slots.every((s) => s.status === 'complete') &&
      !selectedId)
  )
    return <DailySummary daily={daily} demo={demo} />;
  if (!daily.slots.length)
    return (
      <EmptyState
        title="No unseen matches today."
        description="Your hard-no rules and no-repeat promise stay intact. Try a wider discovery mode, or come back as more games join."
        action={
          <Link prefetch={false} href="/settings" className="button-secondary">
            Review my taste
          </Link>
        }
      />
    );
  if (roundQuery.error)
    return (
      <ErrorBox error={roundQuery.error} retry={() => roundQuery.refetch()} />
    );
  if (!round) return <Loading label="Opening your first clue…" />;
  async function submit(action: 'clue' | 'lock') {
    if (!round) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<RoundView>(
        `round/${round.id}/guess${demo ? '?demo=1' : ''}`,
        { body: { ...guess, action, stage: round.stage } },
      );
      client.setQueryData(['round', round.id, demo], updated);
      if (updated.status === 'complete') {
        setActiveId(round.id);
        await client.invalidateQueries({ queryKey: ['daily'] });
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function next() {
    const nextSlot = daily.slots.find(
      (s) => s.id !== round!.id && s.status !== 'complete',
    );
    if (nextSlot) {
      setActiveId(nextSlot.id);
      setError(null);
    } else setShowSummary(true);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  return (
    <>
      <div className="game-topline">
        <Link prefetch={false} href="/today" className="text-link">
          <ArrowLeft size={15} />{' '}
          {demo ? 'Your daily discovery' : 'Your Daily Three'}
        </Link>
        <div className="round-progress" aria-label="Daily progress">
          {daily.slots.map((slot) => (
            <span
              key={slot.id}
              className={
                slot.id === round.id
                  ? 'current'
                  : slot.status === 'complete'
                    ? 'done'
                    : ''
              }
            >
              {slot.status === 'complete' ? (
                <Check size={13} />
              ) : (
                String(slot.slot).padStart(2, '0')
              )}
            </span>
          ))}
          <small>{demo ? 'Demo round' : 'Your personal set'}</small>
        </div>
      </div>
      {round.status === 'complete' ? (
        <RoundResult
          round={round}
          tags={tags}
          demo={demo}
          onNext={next}
          hasNext={daily.slots.some(
            (s) => s.id !== round.id && s.status !== 'complete',
          )}
        />
      ) : (
        <>
          <div className="game-title-row">
            <div>
              <p className="eyebrow">A FRESH PERSPECTIVE</p>
              <h1>Some games just need a closer look.</h1>
            </div>
            <span className="points-available">
              <Sparkles size={17} />
              {formatCount(round.maxScore, 'point')} available
            </span>
          </div>
          <div className="quiz-layout">
            <section className="clue-panel surface" aria-label="Game clues">
              <div className="clue-heading">
                <span>
                  <Eye size={17} /> Mystery game{' '}
                  {String(round.slot).padStart(2, '0')}
                </span>
                <span>
                  VIEWING CLUE {round.availableStages.indexOf(viewedStage) + 1}{' '}
                  OF {round.availableStages.length}
                </span>
              </div>
              <ClueView
                key={`${round.id}:${viewedStage}:${round.stage}`}
                round={round}
                stage={viewedStage}
              />
              <ol className="clue-timeline" aria-label="Clue progression">
                {CONFIG.stageNames.map((name, index) => {
                  const number = index + 1,
                    available = round.availableStages.includes(number),
                    unlocked = available && number <= round.stage,
                    Icon = [ImageIcon, ImageIcon, Layers3, Video][index];
                  return (
                    <li
                      key={name}
                      className={`${number === viewedStage ? 'active' : unlocked ? 'unlocked' : ''} ${!available ? 'unavailable' : ''}`}
                    >
                      <button
                        type="button"
                        disabled={!unlocked}
                        onClick={() => setViewedStage(number)}
                        aria-current={
                          number === viewedStage ? 'step' : undefined
                        }
                        aria-label={`${name} clue${number === round.stage ? ', latest unlocked clue' : ''}`}
                      >
                        <span>
                          {number < round.stage && available ? (
                            <Check size={14} />
                          ) : (
                            <Icon size={15} />
                          )}
                        </span>
                        <small>
                          <span className="clue-label-full">
                            {CLUE_TIMELINE_LABELS[index].full}
                          </span>
                          <span
                            className="clue-label-compact"
                            aria-hidden="true"
                          >
                            {CLUE_TIMELINE_LABELS[index].compact}
                          </span>
                        </small>
                      </button>
                      {!available && (
                        <span className="sr-only">
                          not available for this sample
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
              <div className="clue-explainer">
                <LockKeyhole size={14} />
                <p>
                  Revisit any unlocked clue. Points stay tied to the latest clue
                  you requested.
                </p>
              </div>
              {!round.availableStages.includes(4) && (
                <p className="asset-notice">
                  This sample has no verified YouTube trailer. Missing video
                  clues are skipped; scores still use the original clue values.
                </p>
              )}
            </section>
            <section
              className="guess-panel surface"
              aria-labelledby="guess-heading"
            >
              <div className="guess-panel-header">
                <div>
                  <p className="eyebrow">TRUST YOUR FIRST IMPRESSION</p>
                  <h2 id="guess-heading">What kind of game is this?</h2>
                </div>
              </div>
              <Tabs
                value={group}
                onValueChange={(value) => setGroup(String(value))}
              >
                <TabsList className="guess-tabs">
                  <TabsTrigger value="genre">
                    Genre <span>{guess.genre.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="core">
                    Gameplay <span>{guess.core.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="mood">
                    Mood <span>{guess.mood.length}</span>
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="genre">
                  <p className="picker-instruction">
                    Choose 1–3 genres or subgenres.
                  </p>
                  <TagPicker
                    compact
                    tags={tags}
                    group="genre"
                    label="Genre tags"
                    max={CONFIG.maxGuessTagsPerGroup}
                    value={guess.genre}
                    onChange={(v) => setGuess({ ...guess, genre: v })}
                    disabled={busy}
                  />
                  {guess.genre.length > 0 && !guess.core.length && (
                    <Button
                      variant="ghost"
                      className="text-link"
                      onClick={() => setGroup('core')}
                    >
                      Next: what would you do? <ArrowRight size={14} />
                    </Button>
                  )}
                </TabsContent>
                <TabsContent value="core">
                  <p className="picker-instruction">
                    Choose 1–3 things you think you’d do.
                  </p>
                  <TagPicker
                    compact
                    tags={tags}
                    group="core"
                    label="Gameplay tags"
                    max={CONFIG.maxGuessTagsPerGroup}
                    value={guess.core}
                    onChange={(v) => setGuess({ ...guess, core: v })}
                    disabled={busy}
                  />
                </TabsContent>
                <TabsContent value="mood">
                  <p className="picker-instruction">
                    Choose up to 3 themes or moods. Optional.
                  </p>
                  <TagPicker
                    compact
                    tags={tags}
                    group="mood"
                    label="Mood tags"
                    max={CONFIG.maxGuessTagsPerGroup}
                    value={guess.mood}
                    onChange={(v) => setGuess({ ...guess, mood: v })}
                    disabled={busy}
                  />
                </TabsContent>
              </Tabs>
              <div className="would-click">
                <span>Would you click this in Steam?</span>
                <div role="radiogroup" aria-label="Would you click this game?">
                  {(['yes', 'maybe', 'no'] as const).map((choice) => (
                    <label
                      key={choice}
                      className={`intent-button ${guess.wouldClick === choice ? 'selected' : ''}`}
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name="quiz-intent"
                        value={choice}
                        checked={guess.wouldClick === choice}
                        disabled={busy}
                        onChange={() =>
                          setGuess({ ...guess, wouldClick: choice })
                        }
                      />
                      {choice === 'yes' ? (
                        <ThumbsUp size={14} />
                      ) : choice === 'no' ? (
                        <ThumbsDown size={14} />
                      ) : (
                        <CircleHelp size={14} />
                      )}{' '}
                      {choice[0].toUpperCase() + choice.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
              {error ? <ErrorBox error={error} /> : null}
              <div className="guess-actions">
                <ActionButton
                  busy={busy}
                  disabled={
                    !guess.genre.length ||
                    !guess.core.length ||
                    !guess.wouldClick
                  }
                  onClick={() => submit('lock')}
                >
                  <LockKeyhole size={16} /> Lock in my guess
                </ActionButton>
                <ActionButton
                  secondary
                  disabled={busy}
                  onClick={() => submit('clue')}
                >
                  {round.stage ===
                  round.availableStages[round.availableStages.length - 1]
                    ? 'Reveal the game'
                    : 'I need another clue'}{' '}
                  <ArrowRight size={16} />
                </ActionButton>
              </div>
              <p className="field-help">
                Not sure yet? Asking for another clue is part of the game.
              </p>
            </section>
          </div>
          <div className="quiz-bottom-note">
            <span>
              <CompassIcon /> A new game, not another recommendation feed.
            </span>
            <ReportButton roundId={round.id} demo={demo} />
          </div>
        </>
      )}
      <AdSlot roundId={round.id} enabled={!demo} />
    </>
  );
}
function CompassIcon() {
  return <Sparkles size={15} />;
}
function ClueView({ round, stage }: { round: RoundView; stage: number }) {
  const [activeImage, setActiveImage] = useState(0),
    [videoLoaded, setVideoLoaded] = useState(false),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const gallery = round.screenshots.slice(1),
    image =
      stage === 1
        ? round.capsule
        : stage === 2
          ? (round.screenshots[0] ?? round.capsule)
          : (gallery[activeImage] ?? round.capsule);
  return (
    <>
      <div className={`quiz-media ${stage === 4 ? 'trailer-media' : ''}`}>
        {stage === 4 && round.youtubeId ? (
          videoLoaded ? (
            <TrailerClip
              key={`${stage}-${retry}`}
              youtubeId={round.youtubeId}
            />
          ) : (
            <div className="video-consent">
              <Video size={34} />
              <h3>Trailer or teaser. Your call.</h3>
              <p>
                This clue loads YouTube. No video is loaded before you choose to
                play. The full player has its own controls and may show the
                video’s title or branding.
              </p>
              <ActionButton onClick={() => setVideoLoaded(true)}>
                <Play size={17} /> Load trailer / teaser
              </ActionButton>
            </div>
          )
        ) : failed ? (
          <div className="media-error">
            <ImageIcon size={32} />
            <p>This image couldn’t load.</p>
            <ActionButton
              secondary
              onClick={() => {
                setRetry(retry + 1);
                setFailed(false);
              }}
            >
              <RefreshCw size={15} /> Retry artwork
            </ActionButton>
          </div>
        ) : (
          <img
            key={image + retry}
            src={`${image}${image.includes('?') ? '&' : '?'}v=${retry}`}
            alt={
              stage === 1
                ? 'Title-free mystery game artwork'
                : stage === 2
                  ? 'First mystery gameplay screenshot'
                  : `Mystery gallery screenshot ${activeImage + 2}`
            }
            onError={() => setFailed(true)}
          />
        )}
        {stage === 1 && !failed && (
          <span className="media-corner-label">THE FIRST IMPRESSION</span>
        )}
      </div>
      {stage === 3 && gallery.length >= 2 && (
        <div className="screenshot-strip">
          {gallery.map((src, i) => (
            <button
              key={src}
              className={activeImage === i ? 'active' : ''}
              aria-label={`View gallery screenshot ${i + 2}`}
              aria-pressed={activeImage === i}
              onClick={() => {
                setActiveImage(i);
                setFailed(false);
              }}
            >
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {stage === 4 && videoLoaded && (
        <Button
          variant="ghost"
          className="text-link"
          onClick={() => setRetry(retry + 1)}
        >
          <RefreshCw size={14} /> Reload trailer / teaser
        </Button>
      )}
    </>
  );
}
function gameDestinations(game: GameContent) {
  const links = [
    game.officialUrl
      ? {
          label: 'Official website',
          detail: new URL(game.officialUrl).hostname.replace(/^www\./, ''),
          href: game.officialUrl,
          tracksSteam: false,
        }
      : null,
    {
      label: 'Steam Store',
      detail: 'Store page',
      href: game.steamUrl,
      tracksSteam: true,
    },
    {
      label: 'Community Hub',
      detail: 'Steam discussions and updates',
      href: `https://steamcommunity.com/app/${game.steamAppId}`,
      tracksSteam: false,
    },
    game.youtubeId
      ? {
          label: 'Trailer / teaser',
          detail: 'Watch on YouTube',
          href: `https://www.youtube.com/watch?v=${game.youtubeId}`,
          tracksSteam: false,
        }
      : null,
  ].filter((link): link is NonNullable<typeof link> => link !== null);
  return links.filter(
    (link, index) =>
      links.findIndex((item) => item.href === link.href) === index,
  );
}
function RoundResult({
  round,
  tags,
  demo,
  onNext,
  hasNext,
}: {
  round: RoundView;
  tags: SteamTag[];
  demo: boolean;
  onNext: () => void;
  hasNext: boolean;
}) {
  const result = round.result!,
    destinations = gameDestinations(result.game),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [saved, setSaved] = useState(result.saved),
    [followed, setFollowed] = useState(result.followed),
    [feedback, setFeedback] = useState(''),
    client = useQueryClient();
  async function interaction(kind: string, active = true) {
    setBusy(true);
    setError(null);
    try {
      await api('interaction' + (demo ? '?demo=1' : ''), {
        body: { roundId: round.id, kind, active },
      });
      if (kind === 'save') setSaved(active);
      if (kind === 'follow') setFollowed(active);
      if (kind === 'would_play' || kind === 'not_for_me') setFeedback(kind);
      await client.invalidateQueries({ queryKey: ['collection'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="round-result">
      <div className="reveal-heading">
        <span className="reveal-icon">
          <Sparkles size={29} />
        </span>
        <p className="eyebrow">MYSTERY, MEET DISCOVERY</p>
        <h1>
          {result.accuracy >= 70
            ? 'You saw the game behind the artwork.'
            : 'There’s more than meets the eye.'}
        </h1>
        <p>
          {result.accuracy >= 70
            ? `You understood it in ${formatCount(
                round.availableStages.filter((s) => s <= result.stage).length,
                'clue',
              )}.`
            : 'Every first impression tells the developer something useful.'}
        </p>
      </div>
      <div className="reveal-layout">
        <div className="reveal-game surface">
          <img
            className="reveal-hero"
            src={round.capsule}
            alt={`${result.game.title} artwork`}
          />
          <div className="reveal-content">
            <span className="eyebrow">YOUR NEW DISCOVERY</span>
            <h2>{result.game.title}</h2>
            <p className="byline">by {result.game.developer}</p>
            <p className="game-description">{result.game.description}</p>
            <TagChips ids={result.game.tagIds.slice(0, 8)} tags={tags} />
            <div className="game-destinations">
              <p className="eyebrow">CONTINUE WITH THE GAME</p>
              <div>
                {destinations.map((destination) => (
                  <a
                    key={destination.href}
                    href={destination.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (destination.tracksSteam)
                        void interaction('steam_click');
                    }}
                  >
                    <span>
                      <strong>{destination.label}</strong>
                      <small>{destination.detail}</small>
                    </span>
                    <ExternalLink size={16} aria-hidden="true" />
                  </a>
                ))}
              </div>
            </div>
            <div className="inline-actions">
              {demo ? (
                <a
                  className="button-secondary"
                  href={signInPath()}
                  target="_top"
                >
                  <Bookmark size={16} /> Sign in to save
                </a>
              ) : (
                <ActionButton
                  secondary
                  busy={busy}
                  onClick={() => interaction('save', !saved)}
                >
                  <Bookmark size={16} fill={saved ? 'currentColor' : 'none'} />
                  {saved ? 'Saved to discoveries' : 'Save discovery'}
                </ActionButton>
              )}
            </div>
            {!demo && (
              <Button
                variant="ghost"
                className="text-link"
                disabled={busy}
                onClick={() => interaction('follow', !followed)}
              >
                {followed ? <Check size={15} /> : <PlusMark />}
                {followed ? 'Following this game' : 'Follow this game'}
              </Button>
            )}
          </div>
        </div>
        <div className="reveal-score surface">
          <span className="eyebrow">YOUR FIRST IMPRESSION, SCORED</span>
          <div className="score-number">
            {result.score.toLocaleString('en-US')}
            <span>{countNoun(result.score, 'point')}</span>
          </div>
          <div className="score-stats">
            <span>
              <strong>{result.accuracy}%</strong> weighted match
            </span>
            <span>
              <strong>{CONFIG.stageNames[result.stage - 1]}</strong> final clue
            </span>
          </div>
          <div className="match-group">
            <h3>
              <Check size={16} /> You picked up on
            </h3>
            {result.correct.length ? (
              <TagChips ids={result.correct} tags={tags} />
            ) : (
              <p className="field-help">
                No exact tag matches this time. Discovery still counts.
              </p>
            )}
          </div>
          <div className="match-group">
            <h3>
              <Eye size={16} /> The hidden pieces
            </h3>
            {result.missed.length ? (
              <TagChips ids={result.missed} tags={tags} />
            ) : (
              <p className="field-help">You found every intended tag.</p>
            )}
          </div>
          {result.wrong.length > 0 && (
            <div className="match-group">
              <h3>
                <CircleHelp size={16} /> A different impression
              </h3>
              <TagChips ids={result.wrong} tags={tags} />
            </div>
          )}
          {result.percentile !== null ? (
            <Notice>
              You understood the game earlier than {result.percentile}% of the
              qualified first-impression sample.
            </Notice>
          ) : (
            <p className="field-help">
              Community comparison appears after 20 independent participants.
            </p>
          )}
          {result.isIllustrative && (
            <Notice>
              Sample target tags are illustrative, not confirmed by the
              developer. This round is excluded from live calibration data.
            </Notice>
          )}
        </div>
      </div>
      {!demo && (
        <div className="post-round-feedback surface">
          <div>
            <h3>Now that you’ve met it, is this your kind of game?</h3>
            <p>
              This shapes your future discoveries. Your quiz score never changes
              your taste.
            </p>
          </div>
          <div className="inline-actions">
            <ActionButton
              secondary
              busy={busy}
              onClick={() => interaction('would_play')}
            >
              <ThumbsUp size={16} />
              {feedback === 'would_play' ? 'Good to know!' : 'I’d play this'}
            </ActionButton>
            <ActionButton
              secondary
              busy={busy}
              onClick={() => interaction('not_for_me')}
            >
              <ThumbsDown size={16} />
              {feedback === 'not_for_me' ? 'Noted' : 'Not for me'}
            </ActionButton>
          </div>
        </div>
      )}
      {error ? <ErrorBox error={error} /> : null}
      <div className="reveal-next">
        <ReportButton roundId={round.id} demo={demo} />
        <ActionButton onClick={onNext}>
          {hasNext ? 'On to the next mystery' : 'See my daily result'}{' '}
          <ArrowRight size={18} />
        </ActionButton>
      </div>
    </section>
  );
}
function PlusMark() {
  return <span aria-hidden="true">＋</span>;
}
function DailySummary({ daily, demo }: { daily: DailyView; demo: boolean }) {
  const client = useQueryClient(),
    [pendingRating, setPendingRating] = useState<string | null>(null),
    [error, setError] = useState<unknown>(null);
  const rated = daily.relevance !== null;
  return (
    <>
      <div className="summary-heading">
        <span className="reveal-icon">
          <Trophy size={32} />
        </span>
        <p className="eyebrow">CURIOSITY, REWARDED</p>
        <h1>
          {daily.shortage
            ? 'Every available mystery, discovered.'
            : 'Your daily three. Discovered.'}
        </h1>
        <p>
          {daily.shortage
            ? 'The catalog had fewer than three unseen matches. A full Daily streak was not awarded.'
            : 'A few minutes. A few fresh perspectives. Maybe a new favorite.'}
        </p>
      </div>
      <section className="summary-card surface">
        <div className="summary-total">
          <span>TODAY’S SCORE</span>
          <strong>{daily.totalScore.toLocaleString('en-US')}</strong>
          <small>
            {countNoun(daily.totalScore, 'point')} from{' '}
            {formatCount(daily.slots.length, 'discovery', 'discoveries')}
          </small>
        </div>
        <div className="summary-games">
          {daily.slots.map((slot) => (
            <div key={slot.id}>
              <span className="summary-index">0{slot.slot}</span>
              <div>
                <strong>{slot.title}</strong>
                <small>
                  {slot.accuracy}% match · {CONFIG.stageNames[slot.stage - 1]}
                </small>
              </div>
              <b>{slot.score?.toLocaleString('en-US')}</b>
            </div>
          ))}
        </div>
        <ShareResult daily={daily} />
      </section>
      {!demo && !daily.shortage && (
        <div className="relevance-check">
          <p>
            {rated
              ? 'Thanks. This helps us evaluate recommendation quality.'
              : 'Did today’s discoveries feel relevant to you?'}
          </p>
          {!rated && (
            <div className="inline-actions">
              {(['yes', 'mixed', 'no'] as const).map((rating) => (
                <ActionButton
                  key={rating}
                  secondary
                  busy={pendingRating === rating}
                  disabled={pendingRating !== null}
                  onClick={async () => {
                    setPendingRating(rating);
                    setError(null);
                    try {
                      const updated = await api<{
                        relevance: DailyView['relevance'];
                      }>('daily/relevance', {
                        body: { setId: daily.id, rating },
                      });
                      client.setQueryData<DailyView>(
                        ['daily', 'player'],
                        (current) =>
                          current?.id === daily.id
                            ? { ...current, relevance: updated.relevance }
                            : current,
                      );
                    } catch (e) {
                      setError(e);
                    } finally {
                      setPendingRating(null);
                    }
                  }}
                >
                  {rating === 'yes'
                    ? 'Yes, my kind of games'
                    : rating === 'mixed'
                      ? 'A little of both'
                      : 'Not really'}
                </ActionButton>
              ))}
            </div>
          )}
          {error ? <ErrorBox error={error} /> : null}
        </div>
      )}
      <div className="summary-footer">
        {demo ? (
          <>
            <p>Want three games picked just for you tomorrow?</p>
            <a className="button-primary" href={signInPath()} target="_top">
              Make discovery a daily thing <ArrowRight size={17} />
            </a>
          </>
        ) : (
          <>
            <p>
              Your next three arrive in <ResetCountdown at={daily.resetAt} />.
            </p>
            <Link
              prefetch={false}
              href="/collection"
              className="button-secondary"
            >
              <Bookmark size={16} /> Visit my discoveries
            </Link>
          </>
        )}
      </div>
    </>
  );
}
function ReportButton({ roundId, demo }: { roundId: string; demo: boolean }) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState('Artwork or clue is broken'),
    [details, setDetails] = useState(''),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  return (
    <>
      <Button
        variant="ghost"
        className="report-button"
        onClick={() => setOpen(true)}
      >
        <Flag size={14} /> Report an issue
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="fng-dialog">
          <DialogHeader>
            <DialogTitle>Help us improve this round</DialogTitle>
            <DialogDescription>
              Your report goes to the moderation queue, not to the developer.
            </DialogDescription>
          </DialogHeader>
          {sent ? (
            <Notice tone="success">
              Thanks. Your report has been saved for review.
            </Notice>
          ) : (
            <>
              <Field label="What went wrong?" id="report-reason">
                <select
                  id="report-reason"
                  className="fng-input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  {[
                    'Artwork or clue is broken',
                    'The game title is visible too early',
                    'Inappropriate content',
                    'Tags seem misleading',
                    'Something else',
                  ].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <Field label="Details (optional)" id="report-details">
                <textarea
                  id="report-details"
                  className="fng-input"
                  rows={4}
                  maxLength={1000}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                />
              </Field>
              {error ? <ErrorBox error={error} /> : null}
              <ActionButton
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api('report' + (demo ? '?demo=1' : ''), {
                      body: {
                        roundId,
                        reason,
                        details: details || 'No additional details.',
                      },
                    });
                    setSent(true);
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Send report <ArrowRight size={16} />
              </ActionButton>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
