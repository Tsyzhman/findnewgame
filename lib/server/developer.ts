import type { GameContent, PublicUser } from '@/lib/types';
import {
  activeTags,
  all,
  database,
  first,
  id,
  normalizeStudio,
  presentationFingerprint,
} from './database';
import {
  HttpError,
  assertUploadOwnership,
  parseSteamUrl,
  requireCondition,
  safeUrl,
  textField,
} from './security';
import { validateGame } from './validation';

export async function developerFor(user: PublicUser) {
  const db = await database();
  return first<{ id: string; name: string; studio_key: string }>(
    db,
    'SELECT id,name,studio_key FROM developers WHERE owner_user_id=?',
    user.id,
  );
}
export async function createDeveloper(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  const db = await database(),
    existing = await developerFor(user);
  if (existing) return existing;
  const name = textField(body.name, 'Studio name', 2, 100),
    key = normalizeStudio(name);
  requireCondition(key.length >= 2, 'Choose a valid studio name.');
  const taken = await first(
    db,
    'SELECT id FROM developers WHERE studio_key=?',
    key,
  );
  requireCondition(
    !taken,
    'This studio name is already registered. Contact an administrator to verify ownership.',
    409,
    'studio_exists',
  );
  const developerId = id('studio-'),
    now = Date.now();
  await db.batch([
    db
      .prepare(
        'INSERT INTO developers (id,owner_user_id,name,studio_key,created_at) VALUES (?,?,?,?,?)',
      )
      .bind(developerId, user.id, name, key, now),
    db
      .prepare(
        'INSERT INTO developer_members (developer_id,user_id) VALUES (?,?)',
      )
      .bind(developerId, user.id),
    db
      .prepare(
        "UPDATE users SET role=CASE WHEN role='admin' THEN 'admin' ELSE 'developer' END WHERE id=?",
      )
      .bind(user.id),
  ]);
  return { id: developerId, name, studio_key: key };
}
export async function ownedGame(user: PublicUser, gameId: string) {
  const db = await database();
  const row = await first<{
    id: string;
    developer_id: string;
    status: string;
    current_version_id: string;
    content_json: string;
    version: number;
    is_demo: number;
  }>(
    db,
    "SELECT g.*,v.content_json,v.version FROM games g JOIN developers d ON d.id=g.developer_id JOIN game_versions v ON v.id=g.current_version_id WHERE g.id=? AND (d.owner_user_id=? OR ?='admin')",
    gameId,
    user.id,
    user.role,
  );
  requireCondition(row, 'Game not found or access denied.', 404, 'not_found');
  return row;
}
export async function submitGame(
  user: PublicUser,
  body: Record<string, unknown>,
  gameId?: string,
) {
  const db = await database(),
    developer = await developerFor(user);
  requireCondition(
    developer,
    'Create your studio profile first.',
    409,
    'developer_required',
  );
  const content = validateGame(body, await activeTags(db));
  requireCondition(
    normalizeStudio(content.developer) === developer.studio_key,
    'The developer name must match your verified studio profile.',
  );
  requireCondition(
    body.rightsConfirmed === true,
    'Confirm that you have permission to submit these materials.',
  );
  requireCondition(
    body.noTitleConfirmed === true,
    'Confirm that the quiz artwork does not contain the game title.',
  );
  requireCondition(
    content.youtubeId,
    'Add a YouTube trailer or teaser so the final clue is available.',
  );
  await assertUploadOwnership(db, user.id, [
    content.capsule,
    ...content.screenshots,
  ]);
  const existingApp = await first<{ id: string; is_demo: number }>(
    db,
    'SELECT id,is_demo FROM games WHERE steam_app_id=?',
    content.steamAppId,
  );
  if (existingApp && existingApp.id !== gameId)
    throw new HttpError(
      409,
      existingApp.is_demo
        ? 'This game is in the sample catalog. An administrator must verify ownership before it can be claimed.'
        : 'This Steam game has already been submitted.',
      'duplicate_game',
    );
  const now = Date.now(),
    versionId = id('version-'),
    hash = await presentationFingerprint(content);
  if (gameId) {
    const previous = await ownedGame(user, gameId);
    requireCondition(
      previous.developer_id === developer.id,
      'Only the owner can submit a new version.',
      403,
    );
    const old: GameContent = JSON.parse(previous.content_json);
    requireCondition(
      content.steamAppId === old.steamAppId,
      'A new version must use the same Steam App ID.',
    );
    const version = previous.version + 1;
    await db.batch([
      db
        .prepare(
          'INSERT INTO game_versions (id,game_id,version,content_json,presentation_hash,created_at) VALUES (?,?,?,?,?,?)',
        )
        .bind(versionId, gameId, version, JSON.stringify(content), hash, now),
      db
        .prepare(
          "UPDATE games SET current_version_id=?,publisher_key=?,status='pending_review',is_demo=0,moderation_note=NULL WHERE id=?",
        )
        .bind(versionId, normalizeStudio(content.publisher), gameId),
      db
        .prepare(
          "UPDATE experiments SET status='completed',ended_at=? WHERE game_id=? AND status IN ('active','pending_review')",
        )
        .bind(now, gameId),
    ]);
    return { id: gameId, version, status: 'pending_review' };
  }
  const newId = id('game-');
  let family = String(content.steamAppId);
  if (body.parentSteamUrl)
    family = String(parseSteamUrl(body.parentSteamUrl).appId);
  await db.batch([
    db
      .prepare(
        "INSERT INTO games (id,developer_id,publisher_key,family_key,steam_app_id,status,current_version_id,is_demo,created_at) VALUES (?,?,?,?,?,'pending_review',?,0,?)",
      )
      .bind(
        newId,
        developer.id,
        normalizeStudio(content.publisher),
        family,
        content.steamAppId,
        versionId,
        now,
      ),
    db
      .prepare(
        'INSERT INTO game_versions (id,game_id,version,content_json,presentation_hash,created_at) VALUES (?,?,1,?,?,?)',
      )
      .bind(versionId, newId, JSON.stringify(content), hash, now),
  ]);
  return { id: newId, version: 1, status: 'pending_review' };
}
export async function developerDashboard(user: PublicUser) {
  const db = await database(),
    developer = await developerFor(user);
  if (!developer)
    return { developer: null, games: [], experiments: [], campaigns: [] };
  const now = Date.now();
  await db
    .prepare(
      'UPDATE developers SET last_dashboard_at=MAX(COALESCE(last_dashboard_at,0),?) WHERE id=?',
    )
    .bind(now, developer.id)
    .run();
  const games = await all<{
    id: string;
    status: string;
    moderation_note: string | null;
    content_json: string;
    version: number;
    sample_size: number;
  }>(
    db,
    'SELECT g.id,g.status,g.moderation_note,v.content_json,v.version,(SELECT COUNT(*) FROM quiz_final_results r WHERE r.game_id=g.id AND r.qualified=1 AND r.repeat_exposure=0) sample_size FROM games g JOIN game_versions v ON v.id=g.current_version_id WHERE g.developer_id=? ORDER BY g.created_at DESC',
    developer.id,
  );
  const experiments = await all(
    db,
    'SELECT e.* FROM experiments e JOIN games g ON g.id=e.game_id WHERE g.developer_id=? ORDER BY e.created_at DESC',
    developer.id,
  );
  const campaigns = await all(
    db,
    'SELECT c.*,(SELECT COUNT(*) FROM ad_clicks k JOIN ad_impressions i ON i.id=k.impression_id WHERE i.campaign_id=c.id) clicks FROM ad_campaigns c WHERE c.developer_id=? ORDER BY c.created_at DESC',
    developer.id,
  );
  return {
    developer,
    games: games.map(({ content_json, ...g }) => ({
      ...g,
      content: JSON.parse(content_json),
    })),
    experiments,
    campaigns,
  };
}
export async function steamLookup(steamUrl: unknown) {
  const { appId, url } = parseSteamUrl(steamUrl);
  let response: Response;
  try {
    response = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english&cc=us`,
      { signal: AbortSignal.timeout(8000), redirect: 'manual' },
    );
  } catch {
    throw new HttpError(
      502,
      'Steam did not respond. You can still enter your game details manually.',
      'steam_unavailable',
    );
  }
  requireCondition(
    response.ok,
    'Steam is temporarily unavailable. Use the manual form below.',
    502,
    'steam_unavailable',
  );
  const data = (await response.json()) as Record<
    string,
    { success: boolean; data: Record<string, unknown> }
  >;
  const result = data[appId];
  requireCondition(
    result?.success,
    'Steam could not find this game. Check the URL or use the manual form.',
    404,
  );
  const game = result.data;
  requireCondition(
    ['game', 'demo'].includes(String(game.type)),
    'Only games and demos can be submitted.',
  );
  const screenshots = Array.isArray(game.screenshots)
    ? (game.screenshots as { path_full: string }[])
    : [];
  let officialUrl: string | null = null;
  if (typeof game.website === 'string' && game.website.trim())
    try {
      officialUrl = safeUrl(
        game.website.trim().replace(/^http:\/\//i, 'https://'),
        'Official website',
      );
    } catch {
      officialUrl = null;
    }
  return {
    title: game.name,
    developer: (game.developers as string[] | undefined)?.[0] ?? '',
    publisher: (game.publishers as string[] | undefined)?.[0] ?? '',
    steamUrl: url,
    officialUrl,
    description: (typeof game.short_description === 'string'
      ? game.short_description
      : ''
    )
      .replace(/<[^>]*>/g, '')
      .slice(0, 600),
    releaseState: (game.release_date as { coming_soon?: boolean } | undefined)
      ?.coming_soon
      ? 'coming_soon'
      : 'released',
    capsule: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
    screenshots: screenshots.slice(0, 5).map((s) => s.path_full),
    parentSteamUrl: (game.fullgame as { appid?: string } | undefined)?.appid
      ? `https://store.steampowered.com/app/${(game.fullgame as { appid: string }).appid}/`
      : null,
    notice:
      'Verify every imported field. Steam hero artwork can contain titles; use a title-free image. Add your own verified YouTube trailer or teaser and intended Steam tags.',
  };
}

export async function studioTeam(user: PublicUser) {
  const db = await database(),
    studio = await developerFor(user);
  requireCondition(studio, 'Create a studio profile first.', 403);
  const members = await all<{ id: string; displayName: string }>(
    db,
    'SELECT u.id,u.display_name displayName FROM developer_members m JOIN users u ON u.id=m.user_id WHERE m.developer_id=? ORDER BY u.display_name LIMIT 50',
    studio.id,
  );
  return { members, ownerId: user.id };
}
export async function updateStudioTeam(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  const db = await database(),
    studio = await developerFor(user);
  requireCondition(studio, 'Create a studio profile first.', 403);
  if (body.action === 'remove') {
    const memberId = textField(body.userId, 'Team member', 1, 120);
    requireCondition(
      memberId !== user.id,
      'The studio owner is always excluded from its calibration data.',
    );
    await db
      .prepare(
        'DELETE FROM developer_members WHERE developer_id=? AND user_id=?',
      )
      .bind(studio.id, memberId)
      .run();
    return { ok: true };
  }
  requireCondition(body.action === 'add', 'Choose a team action.');
  const email = textField(body.email, 'Teammate email', 3, 254).toLowerCase();
  const member = await first<{ id: string }>(
    db,
    'SELECT id FROM users WHERE lower(email)=? AND is_demo=0',
    email,
  );
  requireCondition(
    member,
    'Ask this teammate to sign in to FindNewGame first. No invitation is sent.',
    404,
  );
  await db.batch([
    db
      .prepare(
        'INSERT OR IGNORE INTO developer_members (developer_id,user_id) SELECT ?,? WHERE (SELECT COUNT(*) FROM developer_members WHERE developer_id=?)<50',
      )
      .bind(studio.id, member.id, studio.id),
    db
      .prepare(
        'UPDATE quiz_final_results SET qualified=0 WHERE user_id=? AND game_id IN (SELECT id FROM games WHERE developer_id=?) AND EXISTS (SELECT 1 FROM developer_members WHERE developer_id=? AND user_id=?)',
      )
      .bind(member.id, studio.id, studio.id, member.id),
    db
      .prepare(
        'UPDATE quiz_stage_guesses SET qualified=0 WHERE assignment_id IN (SELECT id FROM daily_assignments WHERE user_id=? AND developer_id=?) AND EXISTS (SELECT 1 FROM developer_members WHERE developer_id=? AND user_id=?)',
      )
      .bind(member.id, studio.id, studio.id, member.id),
  ]);
  requireCondition(
    await first(
      db,
      'SELECT 1 FROM developer_members WHERE developer_id=? AND user_id=?',
      studio.id,
      member.id,
    ),
    'A studio can register up to 50 team testers.',
    409,
  );
  return { ok: true };
}
