'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Rocket,
  Shield,
  Sparkles,
} from 'lucide-react';
import { api, useMe, useTags } from '@/lib/api';
import { EMPTY_TASTE } from '@/lib/config';
import type { TasteProfile } from '@/lib/types';
import { TagPicker, TagChips } from './tag-picker';
import {
  ActionButton,
  AuthGate,
  ErrorBox,
  Field,
  Loading,
  Notice,
  PageHeading,
  TextInput,
} from './product-ui';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';

const steps = [
  {
    title: 'What do you actually enjoy playing?',
    description:
      'Pick at least three genres or subgenres. Be as specific as you like.',
    name: 'Genres',
  },
  {
    title: 'What keeps you playing?',
    description:
      'Building a world? Solving a mystery? Pick the things you love doing.',
    name: 'Gameplay',
  },
  {
    title: 'What kind of world draws you in?',
    description:
      'Choose a few themes and moods, or skip this step. These are lighter signals.',
    name: 'Mood',
  },
  {
    title: 'Anything you really don’t want to see?',
    description:
      'We exclude hard-no genres and strongly downweight unwanted themes. You can change this anytime.',
    name: 'Hard no',
  },
  {
    title: 'How far should we wander?',
    description:
      'Your taste sets the possibilities. A little chance makes each day different.',
    name: 'Discovery',
  },
];
export function TasteCalibration({ settings = false }: { settings?: boolean }) {
  const me = useMe(),
    tagQuery = useTags(),
    client = useQueryClient();
  const [taste, setTaste] = useState<TasteProfile>({ ...EMPTY_TASTE }),
    [step, setStep] = useState(0),
    [name, setName] = useState(''),
    [timezone, setTimezone] = useState('UTC'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [saved, setSaved] = useState(false),
    [initialized, setInitialized] = useState(false);
  if (me.data?.user && !initialized) {
    setTaste(me.data.user.taste ?? { ...EMPTY_TASTE });
    setName(me.data.user.displayName);
    setTimezone(
      me.data.user.onboarded
        ? me.data.user.timezone
        : new Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    setInitialized(true);
  }
  if (me.isPending || tagQuery.isPending)
    return <Loading label="Preparing your taste calibration…" />;
  if (me.error || tagQuery.error)
    return (
      <ErrorBox
        error={me.error ?? tagQuery.error}
        retry={() => {
          void me.refetch();
          void tagQuery.refetch();
        }}
      />
    );
  if (!me.data?.user)
    return <AuthGate returnTo={settings ? '/settings' : '/onboarding'} />;
  const tags = tagQuery.data!.tags,
    selected = steps[step];
  const update = (
    key: keyof Pick<TasteProfile, 'genres' | 'mechanics' | 'moods' | 'hardNo'>,
    value: number[],
  ) => {
    setTaste((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setError(null);
  };
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('profile', { body: { ...taste, displayName: name, timezone } });
      await client.invalidateQueries({ queryKey: ['me'] });
      await client.invalidateQueries({ queryKey: ['daily'] });
      setSaved(true);
      if (!settings) window.location.assign('/today');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow={settings ? 'YOUR SPACE' : 'TASTE CALIBRATION'}
        title={
          settings
            ? 'Make discovery feel like you.'
            : 'A little about your kind of game.'
        }
        description="No Steam account required. Just your tastes."
      />
      <div className="onboarding-layout">
        <aside className="onboarding-sidebar">
          <div className="calibration-icon">
            <Compass size={30} />
          </div>
          <h2>
            Five small steps.
            <br />
            Better discoveries.
          </h2>
          <ol className="onboarding-steps">
            {steps.map((s, i) => (
              <li key={s.name}>
                <Button
                  variant="ghost"
                  className={`onboarding-step ${i === step ? 'active' : ''}`}
                  onClick={() => {
                    if (taste.genres.length >= 3 || i === 0) setStep(i);
                  }}
                  aria-current={step === i ? 'step' : undefined}
                >
                  <span>{step > i ? <Check size={15} /> : i + 1}</span>
                  {s.name}
                </Button>
              </li>
            ))}
          </ol>
          <div className="sidebar-note">
            <Shield size={17} />
            <p>
              We use gaming interests only. Developers see aggregates, never
              your personal answers.
            </p>
          </div>
        </aside>
        <section
          className="calibration-panel surface"
          aria-labelledby="calibration-title"
        >
          <div className="calibration-progress">
            <span>STEP {step + 1} OF 5</span>
            <span>{Math.round((step + 1) * 20)}%</span>
          </div>
          <Progress
            value={(step + 1) * 20}
            aria-label="Taste calibration progress"
          />
          <h2 id="calibration-title">{selected.title}</h2>
          <p className="section-description">{selected.description}</p>
          {step === 0 && (
            <TagPicker
              tags={tags}
              value={taste.genres}
              onChange={(v) => update('genres', v)}
              group="genre"
              label="Favorite genres"
              max={15}
              exclude={taste.hardNo}
            />
          )}
          {step === 1 && (
            <TagPicker
              tags={tags}
              value={taste.mechanics}
              onChange={(v) => update('mechanics', v)}
              group="core"
              label="Favorite gameplay"
              max={15}
              exclude={taste.hardNo}
            />
          )}
          {step === 2 && (
            <TagPicker
              tags={tags}
              value={taste.moods}
              onChange={(v) => update('moods', v)}
              group="mood"
              label="Favorite moods"
              max={15}
              exclude={taste.hardNo}
            />
          )}
          {step === 3 && (
            <TagPicker
              tags={tags}
              value={taste.hardNo}
              onChange={(v) => update('hardNo', v)}
              label="Hard-no tags"
              max={20}
              exclude={[...taste.genres, ...taste.mechanics, ...taste.moods]}
            />
          )}
          {step === 4 && (
            <>
              <div
                className="discovery-modes"
                role="radiogroup"
                aria-label="Discovery mode"
              >
                {[
                  {
                    id: 'safe',
                    title: 'Stay close',
                    description: 'More of what you already love.',
                    icon: Shield,
                  },
                  {
                    id: 'balanced',
                    title: 'A little adventure',
                    description: 'Your favorites, with a few new paths.',
                    icon: Compass,
                  },
                  {
                    id: 'curious',
                    title: 'Surprise me',
                    description: 'Wander further. Stay connected.',
                    icon: Rocket,
                  },
                ].map((mode) => (
                  <label
                    key={mode.id}
                    className={`mode-card ${taste.discoveryMode === mode.id ? 'selected' : ''}`}
                  >
                    <input
                      className="sr-only"
                      type="radio"
                      name="discovery-mode"
                      value={mode.id}
                      checked={taste.discoveryMode === mode.id}
                      onChange={() =>
                        setTaste({
                          ...taste,
                          discoveryMode:
                            mode.id as TasteProfile['discoveryMode'],
                        })
                      }
                    />
                    <mode.icon size={23} />
                    <strong>{mode.title}</strong>
                    <span>{mode.description}</span>
                    {mode.id === 'balanced' && <small>Recommended</small>}
                  </label>
                ))}
              </div>
              <div className="form-grid">
                <Field label="What should we call you?" id="display-name">
                  <TextInput
                    id="display-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                  />
                </Field>
                <Field
                  label="Your time zone"
                  id="timezone"
                  help="Your Daily resets at midnight here. Changes apply after the current set expires."
                >
                  <TextInput
                    id="timezone"
                    list="timezones"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  />
                  <datalist id="timezones">
                    {Intl.supportedValuesOf('timeZone').map((zone) => (
                      <option value={zone} key={zone}>
                        {zone}
                      </option>
                    ))}
                  </datalist>
                </Field>
              </div>
              <div className="taste-summary">
                <p className="eyebrow">YOUR STARTING POINT</p>
                <TagChips ids={taste.genres} tags={tags} />
              </div>
            </>
          )}
          {error ? <ErrorBox error={error} /> : null}
          {saved && (
            <Notice tone="success">
              Your taste profile is saved. Today’s games stay the same; your
              next set will use these preferences.
            </Notice>
          )}
          <div className="form-actions">
            <Button
              variant="ghost"
              className="back-button"
              disabled={step === 0 || busy}
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft size={16} /> Back
            </Button>
            <span className="field-help">
              {step === 0
                ? `${taste.genres.length} selected · choose at least 3`
                : step < 4
                  ? 'This step is optional'
                  : ''}
            </span>
            {step < 4 ? (
              <ActionButton
                onClick={() => {
                  setStep(step + 1);
                  setError(null);
                }}
                disabled={step === 0 && taste.genres.length < 3}
              >
                Continue <ArrowRight size={16} />
              </ActionButton>
            ) : (
              <ActionButton onClick={save} busy={busy}>
                {settings ? 'Save preferences' : 'Find my first three'}{' '}
                <Sparkles size={17} />
              </ActionButton>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
