/* oxlint-disable next/no-img-element -- Artwork uses the size-bounded authenticated asset endpoint or an approved Steam CDN; a generic image optimizer would lose the session and clue access checks. Dimensions and loading behavior are controlled by the presentation. */
'use client';
import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  FlaskConical,
  Gamepad2,
  Megaphone,
  Plus,
  Upload,
} from 'lucide-react';
import { api, assetUrl, errorMessage, useMe } from '@/lib/api';
import { formatCount } from '@/lib/format';
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
  StatusBadge,
  TextInput,
} from './product-ui';
export type StudioGame = {
  id: string;
  status: string;
  moderation_note: string | null;
  content: GameContent;
  version: number;
  sample_size: number;
};
export type StudioExperiment = {
  id: string;
  game_id: string;
  name: string;
  kind: string;
  status: string;
  is_retest: number;
};
export type StudioCampaign = {
  id: string;
  name: string;
  game_id: string | null;
  status: string;
  moderation_status: string;
  moderation_note: string | null;
  payment_status: string;
  requested_impressions: number;
  paid_impressions: number;
  delivered: number;
  clicks: number;
  is_test: number;
  creative_json: string;
  start_at: number;
  end_at: number;
};
export type Workspace = {
  developer: null | { id: string; name: string; studio_key: string };
  games: StudioGame[];
  experiments: StudioExperiment[];
  campaigns: StudioCampaign[];
};
export function useWorkspace() {
  const me = useMe();
  return useQuery({
    queryKey: ['developer'],
    queryFn: () => api<Workspace>('developer'),
    enabled: !!me.data?.user,
  });
}
export function DeveloperShell({
  children,
  title,
  description,
  action,
}: {
  children: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  const me = useMe(),
    workspace = useWorkspace(),
    pathname = usePathname();
  if (me.isPending) return <Loading />;
  if (me.error) return <ErrorBox error={me.error} />;
  if (!me.data?.user) return <AuthGate returnTo={pathname} developer />;
  if (workspace.isPending) return <Loading label="Opening your studio…" />;
  if (workspace.error) return <ErrorBox error={workspace.error} />;
  if (!workspace.data?.developer) return <CreateStudio />;
  return (
    <main className="container app-main">
      <nav className="workspace-nav" aria-label="Developer workspace">
        {[
          { href: '/developer', label: 'Your games', icon: Gamepad2 },
          {
            href: '/developer/experiments',
            label: 'Experiments',
            icon: FlaskConical,
          },
          {
            href: '/developer/ads',
            label: 'Campaigns & billing',
            icon: Megaphone,
          },
        ].map(({ href, label, icon: Icon }) => (
          <Link
            prefetch={false}
            key={href}
            href={href}
            aria-current={
              (
                href === '/developer'
                  ? pathname === href || pathname.startsWith('/developer/games')
                  : pathname.startsWith(href)
              )
                ? 'page'
                : undefined
            }
          >
            <Icon size={17} />
            {label}
          </Link>
        ))}
      </nav>
      <PageHeading
        eyebrow={workspace.data.developer.name.toUpperCase()}
        title={title}
        description={description}
        action={action}
      />
      {children}
    </main>
  );
}
function CreateStudio() {
  const [name, setName] = useState(''),
    client = useQueryClient();
  const create = useMutation({
    mutationFn: () => api('developer', { body: { name } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['developer'] });
      await client.invalidateQueries({ queryKey: ['me'] });
    },
  });
  return (
    <main className="container app-main">
      <PageHeading
        eyebrow="FOR THE PEOPLE MAKING GAMES"
        title="What does your game say at first glance?"
        description="Find out what players see in your artwork, screenshots, and trailer. Submitting a game is free."
      />
      <div className="account-grid">
        <form
          className="surface settings-card"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <h2>Start with your studio</h2>
          <p>
            Use the developer name listed on Steam. The same studio cannot
            register twice under slightly different spelling.
          </p>
          <Field id="studio-name" label="Studio or developer name">
            <TextInput
              id="studio-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={100}
              placeholder="Your studio name"
              autoComplete="organization"
            />
          </Field>
          {create.error && <ErrorBox error={create.error} />}
          <ActionButton type="submit" busy={create.isPending}>
            Create studio profile <ArrowRight size={17} />
          </ActionButton>
        </form>
        <section className="surface settings-card prose">
          <h2>Fresh eyes. Useful signals.</h2>
          <p>
            See how players describe your genre, gameplay, and mood. Find the
            clues that improve understanding. Test a changed asset with a
            separate, randomized group.
          </p>
          <p>
            Reports open at 20 independent participants. A sample of 100 is a
            better starting point for decisions. Your own and your team’s
            sessions never improve those numbers.
          </p>
          <Notice>
            Free submission does not guarantee a number of plays. Organic
            discovery is driven by player relevance, diversity, and exposure
            balance.
          </Notice>
        </section>
      </div>
    </main>
  );
}
export function DeveloperDashboard() {
  const workspace = useWorkspace(),
    data = workspace.data;
  return (
    <DeveloperShell
      title="Give your game a fresh pair of eyes."
      description="Your materials, your intended perception, and what players actually understand."
      action={
        <Link
          prefetch={false}
          className="button-primary"
          href="/developer/games/new"
        >
          <Plus size={17} />
          Submit a game
        </Link>
      }
    >
      <div className="stats-row surface">
        <Metric label="Your games" value={data?.games.length ?? 0} />
        <Metric
          label="Published"
          value={
            data?.games.filter((g) => g.status === 'published').length ?? 0
          }
        />
        <Metric
          label="Independent first impressions"
          value={data?.games.reduce((sum, g) => sum + g.sample_size, 0) ?? 0}
        />
      </div>
      {!data?.games.length ? (
        <EmptyState
          title="Your first game starts here."
          description="Bring a Steam URL, title-free artwork, 3–5 screenshots, a YouTube trailer, and the tags that describe your game."
          action={
            <Link
              prefetch={false}
              className="button-primary"
              href="/developer/games/new"
            >
              Prepare a submission <ArrowRight size={17} />
            </Link>
          }
        />
      ) : (
        <div className="studio-games">
          {data.games.map((game) => (
            <article key={game.id} className="surface studio-game">
              <img
                src={assetUrl(game.content.capsule)}
                alt={game.content.title}
                loading="lazy"
              />
              <div>
                <div className="inline-labels">
                  <StatusBadge status={game.status} />
                  <span className="muted-copy">Version {game.version}</span>
                </div>
                <h2>{game.content.title}</h2>
                <p>
                  {formatCount(
                    game.sample_size,
                    'independent first impression',
                  )}{' '}
                  · targets frozen per version
                </p>
                {game.moderation_note && (
                  <p className="moderation-note">
                    Review: {game.moderation_note}
                  </p>
                )}
                <div className="form-actions">
                  <Link
                    prefetch={false}
                    className="button-secondary"
                    href={`/developer/games/${game.id}`}
                  >
                    <BarChart3 size={16} />
                    Calibration report
                  </Link>
                  <Link
                    prefetch={false}
                    className="text-link"
                    href={`/developer/games/${game.id}/edit`}
                  >
                    Create a new revision <ArrowRight size={15} />
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <Notice>
        Small samples stay private. Demo sessions, your own studio, and repeat
        exposures are excluded from first-impression reports.
      </Notice>
      {data?.developer && <TeamTesters />}
    </DeveloperShell>
  );
}
function TeamTesters() {
  const [email, setEmail] = useState(''),
    client = useQueryClient();
  const query = useQuery({
    queryKey: ['studio-team'],
    queryFn: () =>
      api<{ members: { id: string; displayName: string }[]; ownerId: string }>(
        'developer/team',
      ),
  });
  const change = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('developer/team', { body }),
    onSuccess: async () => {
      setEmail('');
      await client.invalidateQueries({ queryKey: ['studio-team'] });
      await client.invalidateQueries({ queryKey: ['developer'] });
      await client.invalidateQueries({ queryKey: ['calibration'] });
    },
  });
  return (
    <section className="surface settings-card">
      <h2>Exclude your team’s test sessions</h2>
      <p>
        Add teammates who have already signed in. Their answers are excluded
        from your calibration results. This does not grant dashboard access or
        send an invitation. Removing a teammate does not restore previously
        excluded answers.
      </p>
      <form
        className="form-actions"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate({ action: 'add', email });
        }}
      >
        <Field id="team-email" label="Teammate’s account email">
          <TextInput
            id="team-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            maxLength={254}
          />
        </Field>
        <ActionButton type="submit" busy={change.isPending}>
          Add team tester
        </ActionButton>
      </form>
      {query.error || change.error ? (
        <ErrorBox error={query.error ?? change.error} />
      ) : null}
      <ul className="team-list">
        {query.data?.members.map((member) => (
          <li key={member.id}>
            <span>
              {member.displayName}
              {member.id === query.data.ownerId ? ' · Studio owner' : ''}
            </span>
            {member.id !== query.data.ownerId && (
              <ActionButton
                secondary
                disabled={change.isPending}
                onClick={() =>
                  change.mutate({ action: 'remove', userId: member.id })
                }
              >
                Remove
              </ActionButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
export function ImageField({
  label,
  value,
  onChange,
  id,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id: string;
  help?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function upload(file: File) {
    setBusy(true);
    setError(null);
    let bitmap: ImageBitmap | undefined;
    try {
      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 10 * 1024 * 1024
      )
        throw new Error(
          'Choose a JPEG, PNG, or WebP image smaller than 10 MB.',
        );
      bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 36_000_000)
        throw new Error(
          'This image is too large to process. Export it below 36 megapixels.',
        );
      const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height)),
        canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context)
        throw new Error('Image processing is unavailable in this browser.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(new Error('Could not compress this image.')),
          'image/webp',
          0.84,
        ),
      );
      canvas.width = canvas.height = 0;
      if (blob.size > 3 * 1024 * 1024)
        throw new Error(
          'The compressed image is still larger than 3 MB. Choose a smaller image.',
        );
      const response = await fetch('/api/assets/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-fng-request': '1', 'Content-Type': blob.type },
        body: blob,
      });
      const result = (await response.json()) as {
        reference?: string;
        error?: string;
      };
      if (!response.ok || !result.reference)
        throw new Error(result.error ?? 'Upload could not be completed.');
      onChange(result.reference);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      bitmap?.close();
      setBusy(false);
    }
  }
  return (
    <div className="image-field">
      <Field
        id={id}
        label={label}
        help={
          help ??
          'Use a public Steam image URL or upload an image. Uploads are compressed to WebP and deduplicated.'
        }
      >
        <TextInput
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…steamstatic.com/… or upload below"
          maxLength={2048}
          disabled={busy}
        />
      </Field>
      <label
        className={`button-secondary upload-control ${busy ? 'disabled' : ''}`}
      >
        <Upload size={16} />
        {busy ? 'Compressing & uploading…' : 'Upload image'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
      </label>
      {value && (
        <img
          className="image-field-preview"
          src={assetUrl(value)}
          alt={`${label} preview`}
          loading="lazy"
        />
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
