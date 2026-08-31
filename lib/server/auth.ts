import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { database, first, id, sha256 } from './database';
import { HttpError, requireCondition } from './security';
import { CONFIG, EMPTY_TASTE } from '@/lib/config';
import type { PublicUser, TasteProfile } from '@/lib/types';
import { recordUserActivity } from './product-metrics';

type UserRow = {
  id: string;
  email: string | null;
  display_name: string;
  role: string;
  timezone: string;
  taste_json: string | null;
  onboarding_complete: number;
  is_demo: number;
};
function userView(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    timezone: row.timezone,
    onboarded: !!row.onboarding_complete,
    isDemo: !!row.is_demo,
    isLocal: import.meta.env.DEV,
    taste: row.taste_json ? JSON.parse(row.taste_json) : null,
  };
}
async function loadUser(
  db: D1Database,
  userId: string,
): Promise<PublicUser | null> {
  const row = await first<UserRow>(
    db,
    'SELECT u.*,p.timezone,p.taste_json,p.onboarding_complete FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE u.id=?',
    userId,
  );
  return row ? userView(row) : null;
}
export async function currentUser(
  request: Request,
  options: { demo?: boolean; required?: boolean } = {},
): Promise<PublicUser | null> {
  const db = await database();
  if (options.demo) {
    const token = request.headers
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('fng_demo='))
      ?.slice(9);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const session = await first<{ user_id: string }>(
        db,
        'SELECT user_id FROM demo_sessions WHERE token_hash=? AND expires_at>?',
        await sha256(token),
        Date.now(),
      );
      if (session) return loadUser(db, session.user_id);
    }
    if (options.required)
      throw new HttpError(401, 'Start a demo round first.', 'demo_required');
    return null;
  }
  const identity = await getChatGPTUser();
  if (!identity) {
    if (options.required)
      throw new HttpError(401, 'Sign in to continue.', 'sign_in_required');
    return null;
  }
  const userId = `user-${await sha256(identity.userId)}`;
  const existing = await loadUser(db, userId);
  const admins = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const localAdmin =
    import.meta.env.DEV && identity.email === 'seedy@sites.test';
  const role =
    localAdmin || admins.includes(identity.email.toLowerCase())
      ? 'admin'
      : 'player';
  const now = Date.now();
  if (existing) {
    let nextRole = role === 'admin' ? 'admin' : existing.role;
    if (existing.role === 'admin' && role !== 'admin') {
      const studio = await first(
        db,
        'SELECT id FROM developers WHERE owner_user_id=?',
        userId,
      );
      nextRole = studio ? 'developer' : 'player';
    }
    if (existing.role !== nextRole || existing.email !== identity.email)
      await db
        .prepare('UPDATE users SET role=?,email=? WHERE id=?')
        .bind(nextRole, identity.email, userId)
        .run();
    await recordUserActivity(db, userId, env.CATALOG_MODE === 'live', now);
    return { ...existing, role: nextRole, email: identity.email };
  }
  await db.batch([
    db
      .prepare(
        'INSERT OR IGNORE INTO users (id,email,display_name,role,is_demo,created_at,last_active_at,retention_started_at) VALUES (?,?,?,?,0,?,?,?)',
      )
      .bind(
        userId,
        identity.email,
        identity.fullName ?? identity.email.split('@')[0],
        role,
        now,
        now,
        env.CATALOG_MODE === 'live' ? now : null,
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO user_profiles (user_id,timezone,onboarding_complete,updated_at) VALUES (?,'UTC',0,?)",
      )
      .bind(userId, now),
  ]);
  return (await loadUser(db, userId))!;
}
export async function requireUser(
  request: Request,
  demo = false,
): Promise<PublicUser> {
  return (await currentUser(request, { demo, required: true }))!;
}
export async function requireAdmin(request: Request): Promise<PublicUser> {
  const user = await requireUser(request);
  requireCondition(
    user.role === 'admin',
    'Administrator access is required.',
    403,
    'forbidden',
  );
  return user;
}
export async function requireDeveloper(
  request: Request,
): Promise<{ user: PublicUser; developerId: string }> {
  const user = await requireUser(request);
  const db = await database();
  const developer = await first<{ id: string }>(
    db,
    'SELECT id FROM developers WHERE owner_user_id=?',
    user.id,
  );
  requireCondition(
    developer,
    'Create a developer profile first.',
    403,
    'developer_required',
  );
  return { user, developerId: developer.id };
}
export async function makeDemo(
  request: Request,
): Promise<{ user: PublicUser; cookie: string }> {
  const existing = await currentUser(request, { demo: true });
  if (existing) return { user: existing, cookie: '' };
  const db = await database(),
    now = Date.now(),
    userId = id('demo-');
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  const taste: TasteProfile = { ...EMPTY_TASTE, discoveryMode: 'curious' };
  await db.batch([
    db
      .prepare(
        "INSERT INTO users (id,display_name,role,is_demo,created_at,last_active_at) VALUES (?,'Curious guest','player',1,?,?)",
      )
      .bind(userId, now, now),
    db
      .prepare(
        "INSERT INTO user_profiles (user_id,timezone,taste_json,onboarding_complete,updated_at) VALUES (?,'UTC',?,1,?)",
      )
      .bind(userId, JSON.stringify(taste), now),
    db
      .prepare(
        'INSERT INTO demo_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',
      )
      .bind(await sha256(token), userId, now + CONFIG.demoLifetimeMs),
  ]);
  return {
    user: (await loadUser(db, userId))!,
    cookie: `fng_demo=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`,
  };
}
