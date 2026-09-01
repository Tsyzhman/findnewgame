import type {
  GameContent,
  GuessSnapshot,
  QuizGroup,
  SteamTag,
  TasteProfile,
} from '@/lib/types';
import { CONFIG } from '@/lib/config';
import { belongsToGroup } from '@/lib/tag-groups';
import {
  requireCondition,
  textField,
  imageReference,
  parseSteamUrl,
  safeUrl,
  youtubeId,
} from './security';
export function tagIds(
  value: unknown,
  tags: readonly SteamTag[],
  min: number,
  max: number,
  label: string,
  group?: QuizGroup,
): number[] {
  requireCondition(
    Array.isArray(value),
    `${label} must be a list of Steam tags.`,
  );
  requireCondition(
    value.length >= min && value.length <= max,
    `Choose ${min}–${max} ${label.toLowerCase()}.`,
  );
  requireCondition(
    value.every((v) => Number.isSafeInteger(v)),
    `${label} contains an invalid tag.`,
  );
  requireCondition(
    new Set(value).size === value.length,
    `${label} contains duplicate tags.`,
  );
  const available = new Map(
    tags.filter((t) => t.is_active).map((t) => [t.id, t]),
  );
  requireCondition(
    value.every(
      (v) =>
        available.has(v) &&
        (!group || belongsToGroup(available.get(v)!, group)),
    ),
    `${label} contains an unavailable or incompatible Steam tag.`,
  );
  return value as number[];
}
export function validateTaste(
  body: Record<string, unknown>,
  tags: SteamTag[],
): TasteProfile {
  const genres = tagIds(body.genres, tags, 3, 15, 'Genre tags', 'genre');
  const mechanics = tagIds(
    body.mechanics,
    tags,
    0,
    15,
    'Gameplay tags',
    'core',
  );
  const moods = tagIds(body.moods, tags, 0, 15, 'Mood tags', 'mood');
  const hardNo = tagIds(body.hardNo, tags, 0, 20, 'Hard-no tags');
  requireCondition(
    ['safe', 'balanced', 'curious'].includes(String(body.discoveryMode)),
    'Choose a discovery mode.',
  );
  const favorites = new Set([...genres, ...mechanics, ...moods]);
  requireCondition(
    !hardNo.some((id) => favorites.has(id)),
    'A tag cannot be a favorite and a hard no at the same time.',
  );
  return {
    genres,
    mechanics,
    moods,
    hardNo,
    discoveryMode: body.discoveryMode as TasteProfile['discoveryMode'],
  };
}
export function validateGuess(
  body: Record<string, unknown>,
  tags: SteamTag[],
  lock: boolean,
): GuessSnapshot {
  const guess = {
    genre: tagIds(
      body.genre,
      tags,
      lock ? 1 : 0,
      CONFIG.maxGuessTagsPerGroup,
      'Genre tags',
      'genre',
    ),
    core: tagIds(
      body.core,
      tags,
      lock ? 1 : 0,
      CONFIG.maxGuessTagsPerGroup,
      'Gameplay tags',
      'core',
    ),
    mood: tagIds(
      body.mood,
      tags,
      0,
      CONFIG.maxGuessTagsPerGroup,
      'Mood tags',
      'mood',
    ),
    wouldClick: body.wouldClick as GuessSnapshot['wouldClick'],
  };
  requireCondition(
    ['yes', 'maybe', 'no', null].includes(guess.wouldClick),
    'Choose Yes, Maybe, or No.',
  );
  if (lock)
    requireCondition(
      guess.wouldClick,
      'Tell us whether you would click this game.',
    );
  return guess;
}
export function validateGame(
  body: Record<string, unknown>,
  tags: SteamTag[],
): GameContent {
  const steam = parseSteamUrl(body.steamUrl),
    title = textField(body.title, 'Game title', 2, 120),
    developer = textField(body.developer, 'Developer name', 2, 100),
    publisher = textField(body.publisher, 'Publisher name', 2, 100);
  const ids = tagIds(body.tagIds, tags, 3, 20, 'Ranked Steam tags');
  requireCondition(
    body.targets && typeof body.targets === 'object',
    'Target perception is required.',
  );
  const raw = body.targets as Record<string, unknown>;
  const targets = {
    genre: tagIds(
      raw.genre,
      tags,
      1,
      CONFIG.maxGuessTagsPerGroup,
      'Target genres',
      'genre',
    ),
    core: tagIds(
      raw.core,
      tags,
      1,
      CONFIG.maxGuessTagsPerGroup,
      'Target gameplay',
      'core',
    ),
    mood: tagIds(
      raw.mood,
      tags,
      0,
      CONFIG.maxGuessTagsPerGroup,
      'Target moods',
      'mood',
    ),
  };
  requireCondition(
    [...targets.genre, ...targets.core, ...targets.mood].every((id) =>
      ids.includes(id),
    ),
    'All target tags must also be in your ranked Steam tags.',
  );
  requireCondition(
    Array.isArray(body.screenshots) &&
      body.screenshots.length >= 3 &&
      body.screenshots.length <= 5,
    'Add 3–5 screenshots.',
  );
  requireCondition(
    new Set(body.screenshots.map(imageReference)).size ===
      body.screenshots.length,
    'Use different screenshots for each clue.',
  );
  requireCondition(
    ['released', 'coming_soon', 'early_access'].includes(
      String(body.releaseState),
    ),
    'Choose the release state.',
  );
  return {
    title,
    developer,
    publisher,
    steamUrl: steam.url,
    steamAppId: steam.appId,
    officialUrl:
      body.officialUrl === null || body.officialUrl === ''
        ? null
        : safeUrl(body.officialUrl, 'Official website'),
    releaseState: body.releaseState as GameContent['releaseState'],
    description: textField(body.description, 'Short description', 30, 600),
    capsule: imageReference(body.capsule),
    screenshots: body.screenshots.map(imageReference),
    youtubeId: youtubeId(body.youtubeId ?? body.youtubeUrl ?? null),
    tagIds: ids,
    targets,
  };
}
