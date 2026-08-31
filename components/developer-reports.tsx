'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FlaskConical, LockKeyhole } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, useTags } from '@/lib/api';
import {
  DeveloperShell,
  ImageField,
  useWorkspace,
} from './developer-workspace';
import {
  ActionButton,
  EmptyState,
  ErrorBox,
  Field,
  Loading,
  Metric,
  Notice,
  StatusBadge,
  TextInput,
} from './product-ui';
import { Textarea } from '@/components/ui/textarea';
type Funnel = {
  stage: number;
  name: string;
  sampleSize: number;
  accuracy: number | null;
  wouldClick: number | null;
  needClue: number | null;
  pairedInformationGain: number | null;
  pairedSampleSize: number;
};
type Calibration = {
  title: string;
  versions: { id: string; version: number }[];
  selectedVersion: string;
  sampleSize: number;
  minimumSample: number;
  usefulSample: number;
  privacySuppressed: boolean;
  funnel: Funnel[];
  misconceptions: { tagId: number; count: number; percentage: number }[];
  confusion: {
    expectedTag: number;
    guessedTag: number;
    count: number;
    percentage: number;
  }[];
  segments: { tagId: number; sampleSize: number; accuracy: number }[];
  wouldPlay: number | null;
  notice: string;
};
const percentage = (value: number | null | undefined) =>
  value == null ? '—' : `${value.toFixed(1)}%`;
export function CalibrationPage({ gameId }: { gameId: string }) {
  const workspace = useWorkspace(),
    tags = useTags(),
    [version, setVersion] = useState('');
  const report = useQuery({
    queryKey: ['analytics', gameId, version],
    queryFn: () =>
      api<Calibration>(
        `analytics/${gameId}${version ? `?version=${version}` : ''}`,
      ),
    enabled: !!workspace.data?.developer,
  });
  const data = report.data,
    tag = (id: number) =>
      tags.data?.tags.find((t) => t.id === id)?.steam_name ?? `Tag ${id}`;
  return (
    <DeveloperShell
      title={data?.title ?? 'Your calibration report'}
      description="Understand the gap between your intended presentation and players’ first impressions."
      action={
        <Link prefetch={false} className="text-link" href="/developer">
          <ArrowLeft size={16} />
          Your games
        </Link>
      }
    >
      {report.isPending ? (
        <Loading label="Preparing the calibration report…" />
      ) : report.error ? (
        <ErrorBox error={report.error} />
      ) : (
        data && (
          <>
            <div className="report-toolbar">
              <Field id="report-version" label="Material version">
                <select
                  id="report-version"
                  className="fng-input"
                  value={version || data.selectedVersion}
                  onChange={(e) => setVersion(e.target.value)}
                >
                  {data.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      Version {v.version}
                    </option>
                  ))}
                </select>
              </Field>
              <Link
                prefetch={false}
                className="button-secondary"
                href={`/developer/games/${gameId}/edit`}
              >
                Create a new revision <ArrowRight size={16} />
              </Link>
            </div>
            <div className="stats-row surface">
              <Metric
                label="Independent participants"
                value={data.sampleSize}
                note="First impressions only"
              />
              <Metric
                label="Reporting minimum"
                value={data.minimumSample}
                note="Per version and segment"
              />
              <Metric
                label="Would play after reveal"
                value={percentage(data.wouldPlay)}
                note="Requires 20 explicit responses"
              />
            </div>
            {data.privacySuppressed ? (
              <div className="surface privacy-empty">
                <LockKeyhole size={28} />
                <h2>Waiting for enough independent eyes.</h2>
                <p>
                  {data.sampleSize} of {data.minimumSample} participants before
                  aggregate answers become visible.
                </p>
                <progress
                  className="sample-progress"
                  max={data.minimumSample}
                  value={data.sampleSize}
                  aria-label="Participants required for reporting"
                />
                <p>
                  We do not fill empty charts with demo data. A sample of{' '}
                  {data.usefulSample} is a more useful starting point for
                  decisions.
                </p>
              </div>
            ) : (
              <>
                <section className="surface settings-card">
                  <h2>What each clue communicates</h2>
                  <p>
                    The people reaching later clues are a different subset. Use
                    paired gain to compare the same viewers.
                  </p>
                  <figure
                    className="calibration-chart"

                    aria-label="Average match by clue stage; values are also available in the table below."
                  >
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={data.funnel}>
                        <CartesianGrid
                          vertical={false}
                          stroke="var(--border)"
                        />
                        <XAxis
                          dataKey="stage"
                          tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                          tickFormatter={(s) => `Clue ${s}`}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          domain={[0, 100]}
                          tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                          unit="%"
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            background: 'var(--surface-1)',
                            border: '1px solid var(--border)',
                            borderRadius: 12,
                            color: 'var(--text-primary)',
                          }}
                        />
                        <Bar
                          dataKey="accuracy"
                          name="Weighted match (%)"
                          fill="var(--accent-primary)"
                          radius={[6, 6, 0, 0]}
                          isAnimationActive={false}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </figure>
                  <div className="table-scroll">
                    <table className="data-table">
                      <caption className="sr-only">
                        Comprehension and interest at each clue stage
                      </caption>
                      <thead>
                        <tr>
                          <th>Clue</th>
                          <th>Viewers</th>
                          <th>Match</th>
                          <th>Would click</th>
                          <th>More clues</th>
                          <th>Paired gain</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.funnel.map((stage) => (
                          <tr key={stage.stage}>
                            <th>{stage.name}</th>
                            <td>{stage.sampleSize}</td>
                            <td>{percentage(stage.accuracy)}</td>
                            <td>{percentage(stage.wouldClick)}</td>
                            <td>{percentage(stage.needClue)}</td>
                            <td>
                              {stage.pairedInformationGain == null
                                ? '—'
                                : `${stage.pairedInformationGain > 0 ? '+' : ''}${stage.pairedInformationGain.toFixed(1)} pp`}
                              <small>{stage.pairedSampleSize} pairs</small>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <div className="account-grid">
                  <section className="surface settings-card">
                    <h2>First-clue genre perceptions</h2>
                    <p>
                      Tags players chose from the artwork, including matches and
                      misconceptions.
                    </p>
                    <div className="bar-list">
                      {data.misconceptions.map((m) => (
                        <div key={m.tagId}>
                          <span>
                            {tag(m.tagId)} <b>{m.percentage.toFixed(1)}%</b>
                          </span>
                          <div className="bar-track">
                            <span style={{ width: `${m.percentage}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="surface settings-card">
                    <h2>Audience segments</h2>
                    <p>
                      Explicit taste groups with at least 20 independent
                      participants. People can belong to multiple groups.
                    </p>
                    {!data.segments.length ? (
                      <p className="muted-copy">
                        No segment has reached the reporting threshold yet.
                      </p>
                    ) : (
                      <div className="table-scroll">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Likes</th>
                              <th>Participants</th>
                              <th>Match</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.segments.map((s) => (
                              <tr key={s.tagId}>
                                <th>{tag(s.tagId)}</th>
                                <td>{s.sampleSize}</td>
                                <td>{percentage(s.accuracy)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
                <section className="surface settings-card">
                  <h2>Where expectations cross</h2>
                  <p>
                    Intended genres versus artwork-stage guesses. Multiple
                    choices mean rows are not mutually exclusive.
                  </p>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Intended genre</th>
                          <th>Perceived genre</th>
                          <th>Participants</th>
                          <th>Share of sample</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.confusion.map((cell, i) => (
                          <tr key={i}>
                            <th>{tag(cell.expectedTag)}</th>
                            <td>{tag(cell.guessedTag)}</td>
                            <td>{cell.count}</td>
                            <td>
                              <span
                                className={
                                  cell.expectedTag === cell.guessedTag
                                    ? 'success-text'
                                    : ''
                                }
                              >
                                {percentage(cell.percentage)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
            <Notice>{data.notice}</Notice>
          </>
        )
      )}
    </DeveloperShell>
  );
}
export function ExperimentsPage() {
  const workspace = useWorkspace(),
    client = useQueryClient(),
    [gameId, setGameId] = useState(''),
    [name, setName] = useState(''),
    [kind, setKind] = useState('capsule'),
    [value, setValue] = useState(''),
    [retest, setRetest] = useState(false);
  const available =
      workspace.data?.games.filter((g) => g.status === 'published') ?? [],
    game = available.find((g) => g.id === gameId);
  const create = useMutation({
    mutationFn: () =>
      api('experiments', {
        body: {
          gameId,
          name,
          kind,
          value:
            kind === 'screenshot_order'
              ? value.split(',').map((v) => Number(v.trim()) - 1)
              : value,
          isRetest: retest,
        },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['developer'] });
      setName('');
      setValue('');
    },
  });
  return (
    <DeveloperShell
      title="A better first impression starts with a question."
      description="Change one presentation element. Randomized groups keep the comparison understandable."
    >
      <section className="surface settings-card">
        <h2>Your experiments</h2>
        {!workspace.data?.experiments.length ? (
          <p className="muted-copy">
            No experiments yet. Publish a complete game first, then propose a
            variation below.
          </p>
        ) : (
          <div className="experiment-list">
            {workspace.data.experiments.map((e) => (
              <Link
                prefetch={false}
                className="experiment-row"
                key={e.id}
                href={`/developer/experiments/${e.id}`}
              >
                <FlaskConical size={20} />
                <div>
                  <strong>{e.name}</strong>
                  <small>
                    {
                      workspace.data?.games.find((g) => g.id === e.game_id)
                        ?.content.title
                    }{' '}
                    · {e.kind.replaceAll('_', ' ')}
                    {e.is_retest ? ' · retest' : ''}
                  </small>
                </div>
                <StatusBadge status={e.status} />
                <ArrowRight size={17} />
              </Link>
            ))}
          </div>
        )}
      </section>
      {!available.length ? (
        <EmptyState
          title="A published game is your starting point."
          description="Experiments need an approved control presentation. Submit a game and complete moderation first."
          action={
            <Link
              prefetch={false}
              className="button-secondary"
              href="/developer/games/new"
            >
              Submit a game
            </Link>
          }
        />
      ) : (
        <form
          className="surface settings-card"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <h2>Propose a new experiment</h2>
          <div className="form-grid">
            <Field id="experiment-game" label="Published game">
              <select
                id="experiment-game"
                className="fng-input"
                value={gameId}
                required
                onChange={(e) => {
                  setGameId(e.target.value);
                  setValue('');
                }}
              >
                <option value="">Choose a game</option>
                {available.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.content.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="experiment-name" label="Experiment name">
              <TextInput
                id="experiment-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={3}
                maxLength={120}
                placeholder="Clearer gameplay in the first screenshot"
              />
            </Field>
            <Field id="experiment-kind" label="Change one element">
              <select
                id="experiment-kind"
                className="fng-input"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setValue('');
                }}
              >
                <option value="capsule">Title-free artwork</option>
                <option value="screenshot">First screenshot</option>
                <option value="screenshot_order">Screenshot order</option>
                <option value="trailer">YouTube trailer</option>
                <option value="description">Short description</option>
              </select>
            </Field>
          </div>
          {['capsule', 'screenshot'].includes(kind) ? (
            <ImageField
              id="challenger-image"
              label="Variant B image"
              value={value}
              onChange={setValue}
            />
          ) : kind === 'description' ? (
            <Field
              id="challenger-description"
              label="Variant B short description"
            >
              <Textarea
                id="challenger-description"
                className="fng-textarea"
                required
                minLength={30}
                maxLength={600}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={4}
              />
            </Field>
          ) : (
            <Field
              id="challenger-value"
              label={
                kind === 'trailer'
                  ? 'Variant B YouTube URL or ID'
                  : 'Variant B screenshot order'
              }
              help={
                kind === 'screenshot_order'
                  ? `Enter every screenshot number once, separated by commas. This game has ${game?.content.screenshots.length ?? '3–5'} screenshots. Example: 2, 1, 3.`
                  : 'Choose a public, embeddable trailer with a useful opening.'
              }
            >
              <TextInput
                id="challenger-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </Field>
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={retest}
              onChange={(e) => setRetest(e.target.checked)}
            />
            <span>
              Allow an explicit retest after at least 14 days. Only changed
              materials may be shown again; repeat data stays separate.
            </span>
          </label>
          <Notice>
            Variant A is your current approved version. Target tags never change
            inside an experiment. A/B variants count as one game toward a
            player’s daily limit.
          </Notice>
          {create.error && <ErrorBox error={create.error} />}{' '}
          {create.isSuccess && (
            <Notice tone="success">
              Experiment submitted for moderation. It does not run until
              approved.
            </Notice>
          )}
          <ActionButton
            type="submit"
            busy={create.isPending}
            disabled={!gameId}
          >
            Submit experiment for review <ArrowRight size={17} />
          </ActionButton>
        </form>
      )}
    </DeveloperShell>
  );
}
type ExperimentData = {
  experiment: { name: string; status: string; is_retest: number };
  variants: {
    label: string;
    sampleSize: number;
    repeatSampleSize: number;
    accuracy: number | null;
    standardError: number | null;
  }[];
  comparison: null | {
    difference: number;
    lower: number;
    upper: number;
    enoughData: boolean;
  };
  privacyThreshold: number;
  notice: string;
};
export function ExperimentReport({ experimentId }: { experimentId: string }) {
  const workspace = useWorkspace(),
    client = useQueryClient();
  const query = useQuery({
    queryKey: ['experiment', experimentId],
    queryFn: () => api<ExperimentData>(`experiments/${experimentId}`),
    enabled: !!workspace.data?.developer,
  });
  const finish = useMutation({
    mutationFn: () =>
      api(`experiments/${experimentId}`, { method: 'PATCH', body: {} }),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ['experiment', experimentId],
      });
      await client.invalidateQueries({ queryKey: ['developer'] });
    },
  });
  return (
    <DeveloperShell
      title={query.data?.experiment.name ?? 'Experiment results'}
      description="Between-player comparison with fixed cohorts and immutable target tags."
      action={
        <Link
          prefetch={false}
          className="text-link"
          href="/developer/experiments"
        >
          <ArrowLeft size={16} />
          All experiments
        </Link>
      }
    >
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorBox error={query.error} />
      ) : (
        query.data && (
          <>
            <div className="form-actions">
              <StatusBadge status={query.data.experiment.status} />
              {query.data.experiment.is_retest ? (
                <span className="muted-copy">
                  Repeat exposures reported separately
                </span>
              ) : null}
            </div>
            <div className="account-grid">
              {query.data.variants.map((v) => (
                <section key={v.label} className="surface settings-card">
                  <p className="eyebrow">VARIANT {v.label}</p>
                  <h2>
                    {v.label === 'A' ? 'Current presentation' : 'Challenger'}
                  </h2>
                  <div className="stats-row">
                    <Metric
                      label="Average match"
                      value={percentage(v.accuracy)}
                      note={
                        v.accuracy === null
                          ? `Opens at ${query.data!.privacyThreshold} participants`
                          : 'Independent first impressions'
                      }
                    />
                    <Metric label="Participants" value={v.sampleSize} />
                    <Metric
                      label="Repeat exposures"
                      value={v.repeatSampleSize}
                      note="Excluded above"
                    />
                  </div>
                </section>
              ))}
            </div>
            <section className="surface settings-card">
              <h2>What the comparison can tell you</h2>
              {query.data.comparison ? (
                <>
                  <p className="comparison-number">
                    {query.data.comparison.difference > 0 ? '+' : ''}
                    {query.data.comparison.difference.toFixed(1)}
                    <span> percentage points · B minus A</span>
                  </p>
                  <p>
                    Approximate 95% interval:{' '}
                    {query.data.comparison.lower.toFixed(1)} to{' '}
                    {query.data.comparison.upper.toFixed(1)} points.
                  </p>
                  <Notice
                    tone={query.data.comparison.enoughData ? 'info' : 'warning'}
                  >
                    {query.data.comparison.enoughData
                      ? 'Both groups have reached 100 participants. Review the interval and practical effect before choosing a winner.'
                      : 'At least one group has fewer than 100 participants. Treat this as an early, exploratory result.'}{' '}
                    Repeatedly checking results increases the risk of a
                    misleading apparent winner.
                  </Notice>
                </>
              ) : (
                <p>
                  Both variants need at least {query.data.privacyThreshold}{' '}
                  independent participants before a comparison is shown.
                </p>
              )}
            </section>
            <Notice>{query.data.notice}</Notice>
            {finish.error && <ErrorBox error={finish.error} />}{' '}
            {query.data.experiment.status !== 'completed' && (
              <ActionButton
                secondary
                busy={finish.isPending}
                onClick={() => finish.mutate()}
              >
                End experiment
              </ActionButton>
            )}
          </>
        )
      )}
    </DeveloperShell>
  );
}
