'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { api, useMe, useTags } from '@/lib/api';
import { CONFIG } from '@/lib/config';
import type { GameContent, TargetTags } from '@/lib/types';
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
  Notice,
  TextInput,
} from './product-ui';
import { TagPicker } from './tag-picker';
import { SecurityCheck } from './turnstile';
import { Textarea } from '@/components/ui/textarea';

type Draft = Omit<GameContent, 'steamAppId'> & { parentSteamUrl: string };
const blank: Draft = {
  title: '',
  developer: '',
  publisher: '',
  steamUrl: '',
  officialUrl: null,
  releaseState: 'released',
  description: '',
  capsule: '',
  screenshots: ['', '', ''],
  youtubeId: '',
  tagIds: [],
  targets: { genre: [], core: [], mood: [] },
  parentSteamUrl: '',
};
export function GameEditor({ gameId }: { gameId?: string }) {
  const me = useMe(),
    workspace = useWorkspace(),
    tags = useTags(),
    router = useRouter(),
    client = useQueryClient(),
    [draft, setDraft] = useState<Draft>(blank),
    [rights, setRights] = useState(false),
    [titleFree, setTitleFree] = useState(false),
    [token, setToken] = useState<string | null>(null),
    [loaded, setLoaded] = useState<string | null>(null);
  const game = useQuery({
    queryKey: ['game', gameId],
    queryFn: () =>
      api<{ content: GameContent; version: number }>(`games/${gameId}`),
    enabled: !!gameId && !!workspace.data?.developer,
  });
  if (loaded !== gameId && game.data && gameId) {
    setDraft({
      ...game.data.content,
      officialUrl: game.data.content.officialUrl ?? null,
      parentSteamUrl: '',
    });
    setLoaded(gameId);
  } else if (!gameId && workspace.data?.developer && loaded !== 'new') {
    setDraft((prev) => ({
      ...prev,
      developer: workspace.data!.developer!.name,
      publisher: workspace.data!.developer!.name,
    }));
    setLoaded('new');
  }
  const lookup = useMutation({
    mutationFn: () =>
      api<Partial<Draft> & { notice: string }>('steam/lookup', {
        body: { steamUrl: draft.steamUrl },
      }),
    onSuccess: (data) =>
      setDraft((prev) => ({
        ...prev,
        ...data,
        developer:
          workspace.data?.developer?.name ??
          String(data.developer ?? prev.developer),
        screenshots: data.screenshots?.length ? data.screenshots : ['', '', ''],
        parentSteamUrl: data.parentSteamUrl ?? '',
      })),
  });
  const submit = useMutation({
    mutationFn: () =>
      api(`games${gameId ? `/${gameId}` : ''}`, {
        body: {
          ...draft,
          rightsConfirmed: rights,
          noTitleConfirmed: titleFree,
          turnstileToken: token,
        },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['developer'] });
      await client.invalidateQueries({ queryKey: ['game', gameId] });
      router.push('/developer');
    },
    onError: () => setToken(null),
  });
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }
  function reorder(index: number, move: number) {
    const items = [...draft.tagIds];
    [items[index], items[index + move]] = [items[index + move], items[index]];
    update('tagIds', items);
  }
  const rankedTags = (tags.data?.tags ?? []).filter((t) =>
    draft.tagIds.includes(t.id),
  );
  return (
    <DeveloperShell
      title={
        gameId
          ? 'A new version, a clear comparison.'
          : 'Let players see your game with fresh eyes.'
      }
      description={
        gameId
          ? 'Your previous materials and answers stay intact. This revision returns to moderation and starts its own report.'
          : 'Prepare one complete presentation. Nothing enters the live Daily until it has been reviewed.'
      }
      action={
        <Link prefetch={false} className="text-link" href="/developer">
          <ArrowLeft size={16} />
          Your games
        </Link>
      }
    >
      {gameId && game.isPending ? (
        <Loading />
      ) : game.error ? (
        <ErrorBox error={game.error} />
      ) : (
        <form
          className="editor-layout"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <div className="editor-main">
            <section className="surface settings-card">
              <div className="section-title">
                <span className="step-label">01</span>
                <div>
                  <h2>The basics</h2>
                  <p>Start with Steam, then check every imported field.</p>
                </div>
              </div>
              <Field id="steam-url" label="Steam store URL">
                <div className="input-with-action">
                  <TextInput
                    id="steam-url"
                    type="url"
                    required
                    value={draft.steamUrl}
                    onChange={(e) => update('steamUrl', e.target.value)}
                    placeholder="https://store.steampowered.com/app/…"
                  />
                  <ActionButton
                    type="button"
                    secondary
                    busy={lookup.isPending}
                    disabled={!!gameId}
                    onClick={() => lookup.mutate()}
                  >
                    Import details
                  </ActionButton>
                </div>
              </Field>
              <Field
                id="official-url"
                label="Official website (optional)"
                help="Shown only after the game is revealed. Use the game or studio’s official HTTPS page."
              >
                <TextInput
                  id="official-url"
                  type="url"
                  value={draft.officialUrl ?? ''}
                  onChange={(e) => update('officialUrl', e.target.value)}
                  placeholder="https://yourgame.com/"
                />
              </Field>
              {lookup.error && <ErrorBox error={lookup.error} />}{' '}
              {lookup.data && <Notice>{lookup.data.notice}</Notice>}
              <div className="form-grid">
                <Field id="game-title" label="Game title">
                  <TextInput
                    id="game-title"
                    value={draft.title}
                    onChange={(e) => update('title', e.target.value)}
                    required
                    minLength={2}
                    maxLength={120}
                  />
                </Field>
                <Field id="game-developer" label="Developer">
                  <TextInput
                    id="game-developer"
                    value={draft.developer}
                    readOnly
                  />
                </Field>
                <Field id="game-publisher" label="Publisher">
                  <TextInput
                    id="game-publisher"
                    value={draft.publisher}
                    onChange={(e) => update('publisher', e.target.value)}
                    required
                    minLength={2}
                    maxLength={100}
                  />
                </Field>
                <Field id="release-state" label="Release state">
                  <select
                    className="fng-input"
                    id="release-state"
                    value={draft.releaseState}
                    onChange={(e) =>
                      update(
                        'releaseState',
                        e.target.value as Draft['releaseState'],
                      )
                    }
                  >
                    <option value="released">Released</option>
                    <option value="early_access">Early access</option>
                    <option value="coming_soon">Coming soon</option>
                  </select>
                </Field>
              </div>
              {!gameId && (
                <Field
                  id="parent-game"
                  label="Main game Steam URL (optional)"
                  help="For a demo or prologue, link the main game so players do not receive both as separate discoveries."
                >
                  <TextInput
                    id="parent-game"
                    type="url"
                    value={draft.parentSteamUrl}
                    onChange={(e) => update('parentSteamUrl', e.target.value)}
                  />
                </Field>
              )}
              <Field
                id="game-description"
                label="Store description"
                help={`${draft.description.length} / 600 characters. Shown only after the answer is revealed; 30 characters minimum.`}
              >
                <Textarea
                  className="fng-textarea"
                  id="game-description"
                  value={draft.description}
                  onChange={(e) => update('description', e.target.value)}
                  required
                  minLength={30}
                  maxLength={600}
                  rows={4}
                />
              </Field>
            </section>
            <section className="surface settings-card">
              <div className="section-title">
                <span className="step-label">02</span>
                <div>
                  <h2>The clues</h2>
                  <p>
                    Title-free artwork, 3–5 screenshots, and one YouTube trailer
                    or teaser.
                  </p>
                </div>
              </div>
              <ImageField
                id="quiz-artwork"
                label="Title-free quiz artwork"
                value={draft.capsule}
                onChange={(value) => update('capsule', value)}
                help="No game title, developer logo, tag list, or text that gives away the answer."
              />
              <div className="screenshot-fields">
                {draft.screenshots.map((image, index) => (
                  <div className="screenshot-field" key={index}>
                    <ImageField
                      id={`screenshot-${index}`}
                      label={`Screenshot ${index + 1}${index === 0 ? ' · shown alone, excluded from Gallery' : ' · Gallery'}`}
                      value={image}
                      onChange={(value) =>
                        update(
                          'screenshots',
                          draft.screenshots.map((old, i) =>
                            i === index ? value : old,
                          ),
                        )
                      }
                    />
                    {draft.screenshots.length > 3 && (
                      <ActionButton
                        secondary
                        type="button"
                        onClick={() =>
                          update(
                            'screenshots',
                            draft.screenshots.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 size={15} />
                        Remove screenshot {index + 1}
                      </ActionButton>
                    )}
                  </div>
                ))}
              </div>
              {draft.screenshots.length < 5 && (
                <ActionButton
                  type="button"
                  secondary
                  onClick={() =>
                    update('screenshots', [...draft.screenshots, ''])
                  }
                >
                  <Plus size={16} />
                  Add screenshot
                </ActionButton>
              )}
              <Field
                id="youtube-trailer"
                label="YouTube trailer or teaser URL / video ID"
                help="Use a public, embeddable video. Players choose when to load it and control full playback; video is never uploaded or stored here."
              >
                <TextInput
                  id="youtube-trailer"
                  value={draft.youtubeId ?? ''}
                  onChange={(e) => update('youtubeId', e.target.value)}
                  required
                  placeholder="https://www.youtube.com/watch?v=…"
                />
              </Field>
            </section>
            <section className="surface settings-card">
              <div className="section-title">
                <span className="step-label">03</span>
                <div>
                  <h2>Your intended perception</h2>
                  <p>
                    Choose Steam tags, then put the most defining ones first.
                  </p>
                </div>
              </div>
              {tags.isPending ? (
                <Loading label="Loading the Steam tag library…" />
              ) : tags.error ? (
                <ErrorBox error={tags.error} />
              ) : (
                <>
                  <TagPicker
                    tags={tags.data!.tags}
                    value={draft.tagIds}
                    max={20}
                    onChange={(value) => {
                      setDraft((prev) => ({
                        ...prev,
                        tagIds: value,
                        targets: Object.fromEntries(
                          Object.entries(prev.targets).map(([key, ids]) => [
                            key,
                            ids.filter((id: number) => value.includes(id)),
                          ]),
                        ) as unknown as TargetTags,
                      }));
                    }}
                    label="Ranked Steam tags (3–20)"
                  />
                  {!!draft.tagIds.length && (
                    <ol className="ranked-tags">
                      {draft.tagIds.map((id, index) => (
                        <li key={id}>
                          <span className="rank-number">{index + 1}</span>
                          <span>
                            {
                              tags.data!.tags.find((t) => t.id === id)
                                ?.steam_name
                            }
                            {index < 5 && <small> Primary</small>}
                          </span>
                          <ActionButton
                            type="button"
                            secondary
                            disabled={index === 0}
                            aria-label={`Move ${tags.data!.tags.find((t) => t.id === id)?.steam_name} up`}
                            onClick={() => reorder(index, -1)}
                          >
                            <ArrowUp size={14} />
                          </ActionButton>
                          <ActionButton
                            type="button"
                            secondary
                            disabled={index === draft.tagIds.length - 1}
                            aria-label={`Move ${tags.data!.tags.find((t) => t.id === id)?.steam_name} down`}
                            onClick={() => reorder(index, 1)}
                          >
                            <ArrowDown size={14} />
                          </ActionButton>
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="target-fields">
                    {(['genre', 'core', 'mood'] as const).map((group) => (
                      <TagPicker
                        key={group}
                        tags={rankedTags}
                        value={draft.targets[group]}
                        onChange={(value) =>
                          update('targets', {
                            ...draft.targets,
                            [group]: value,
                          })
                        }
                        group={group}
                        max={CONFIG.maxGuessTagsPerGroup}
                        label={
                          group === 'genre'
                            ? 'Target genre · choose 1–3'
                            : group === 'core'
                              ? 'Target gameplay · choose 1–3'
                              : 'Target mood · optional, up to 3'
                        }
                        compact
                      />
                    ))}
                  </div>
                  <p className="field-help">
                    Target choices must come from your ranked tags. Prefer
                    specific subgenres and mechanics. Targets are the score
                    reference, not public player answers.
                  </p>
                </>
              )}
            </section>
          </div>
          <aside className="editor-aside">
            <section className="surface settings-card sticky-panel">
              <p className="eyebrow">BEFORE YOU SUBMIT</p>
              <h2>Ready for fresh eyes?</h2>
              <ul className="check-list">
                <li>English store information</li>
                <li>Artwork without title or logo</li>
                <li>Three to five different screenshots</li>
                <li>A playable YouTube trailer or teaser</li>
                <li>Specific, honest target tags</li>
              </ul>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={rights}
                  onChange={(e) => setRights(e.target.checked)}
                  required
                />
                <span>
                  I own these materials or have permission to submit them.
                </span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={titleFree}
                  onChange={(e) => setTitleFree(e.target.checked)}
                  required
                />
                <span>The first clue does not reveal the game’s name.</span>
              </label>
              <SecurityCheck
                siteKey={me.data?.site.turnstileSiteKey ?? null}
                onToken={setToken}
              />
              {submit.error && <ErrorBox error={submit.error} />}
              <ActionButton
                type="submit"
                busy={submit.isPending}
                disabled={
                  !rights ||
                  !titleFree ||
                  (!!me.data?.site.turnstileSiteKey && !token)
                }
              >
                {gameId ? 'Submit new revision' : 'Submit for review'}
              </ActionButton>
              <p className="field-help">
                Free submission. No paid boost to organic discovery.{' '}
                {gameId
                  ? 'Creating this revision ends active experiments on the previous version.'
                  : ''}
              </p>
            </section>
          </aside>
        </form>
      )}
    </DeveloperShell>
  );
}
