import { readFile, writeFile } from 'node:fs/promises';
import { belongsToGroup } from '../lib/tag-groups.ts';
import { refineTagCategories } from './tag-categories.mjs';
const data = new URL('../data/', import.meta.url);
const tags = JSON.parse(
  await readFile(new URL('steam_tags.json', data), 'utf8'),
);
const games = JSON.parse(
  await readFile(new URL('demo_games.json', data), 'utf8'),
);
const trailers = JSON.parse(
  await readFile(new URL('demo_trailers.json', data), 'utf8'),
);
const refinedCategories = refineTagCategories(tags);
const byId = new Map(tags.map((t) => [t.id, t]));
for (const tag of tags) tag.localizations_json = {};
for (const game of games) {
  for (const group of ['genre', 'core', 'mood'])
    game.targets[group] = [...new Set(game.targets[group])].filter(
      (id) => byId.has(id) && belongsToGroup(byId.get(id), group),
    );
  if (!game.targets.genre.length || !game.targets.core.length)
    throw new Error(`Incomplete sample targets: ${game.title}`);
  game.youtubeId = trailers[game.steamAppId]?.id ?? null;
}
await writeFile(
  new URL('steam_tags.json', data),
  JSON.stringify(tags, null, 2) + '\n',
);
await writeFile(
  new URL('demo_games.json', data),
  JSON.stringify(games, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    games: games.length,
    withTrailers: games.filter((g) => g.youtubeId).length,
    tags: tags.length,
    refinedCategories,
    language: 'English',
  }),
);
