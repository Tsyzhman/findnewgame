import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { refineTagCategories } from './tag-categories.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const groups = {
  subgenre: [
    'Action Roguelike',
    'Roguelike',
    'Roguelite',
    'FPS',
    'Third-Person Shooter',
    'Metroidvania',
    'Souls-like',
    'Immersive Sim',
    'Colony Sim',
    'City Builder',
    'Automation',
    'Grand Strategy',
    'Tactical RPG',
    'Action RPG',
    'JRPG',
    'CRPG',
    'Party-Based RPG',
    'Turn-Based Tactics',
    'Turn-Based Strategy',
    'Deckbuilding',
    'Roguelike Deckbuilder',
    'Extraction Shooter',
    'Looter Shooter',
    'Bullet Hell',
    'Precision Platformer',
    'Puzzle Platformer',
    'Farming Sim',
    'Walking Simulator',
    'Life Sim',
    'Visual Novel',
    'Dating Sim',
    'Auto Battler',
    'Battle Royale',
    '4X',
    'RTS',
    'Tower Defense',
    'Survival Horror',
    'Psychological Horror',
    'Dungeon Crawler',
    'Hack and Slash',
    '2D Platformer',
    '3D Platformer',
    'Open World Survival Craft',
    'Collectathon',
  ],
  genre: [
    'Action',
    'Adventure',
    'Casual',
    'Experimental',
    'Puzzle',
    'Racing',
    'RPG',
    'Simulation',
    'Sports',
    'Strategy',
    'Tabletop',
    'Shooter',
    'Platformer',
    'Management',
    'Survival',
    'Card Game',
    'Fighting',
    'Exploration',
    'Point & Click',
    'Strategy RPG',
    'Action-Adventure',
    'Sandbox',
    'Arcade',
    'Hidden Object',
    'Idler',
    'Interactive Fiction',
    'Board Game',
  ],
  mechanic: [
    'Resource Management',
    'Crafting',
    'Building',
    'Base Building',
    'Trading',
    'Mining',
    'Hacking',
    'Procedural Generation',
    'Choices Matter',
    'Character Customization',
    'Physics',
    'Investigation',
    'Fishing',
    'Inventory Management',
    'Turn-Based Combat',
    'Tactical',
    'Stealth',
    'Combat',
    'Loot',
    'Looting',
    'Deckbuilder',
    'Deckbuilding',
    'Card Battler',
    'Story Rich',
    'Open World',
    'Multiple Endings',
    'Branching Narrative',
    'Time Management',
    'Time Manipulation',
    'Time Attack',
    'Colony Sim',
    'Cooking',
    'Farming',
    'Parkour',
    'Survival',
    'Puzzle',
    'Exploration',
    'Level Editor',
    'Grid-Based Movement',
    'Automation',
    'Education',
    'Programming',
    'Logic',
    'Mystery Dungeon',
    'Rhythm',
    'Puzzle-Platformer',
    'Nonlinear',
    'Transportation',
    'Naval Combat',
  ],
  mood: [
    'Atmospheric',
    'Relaxing',
    'Funny',
    'Horror',
    'Dark',
    'Cute',
    'Cozy',
    'Mystery',
    'Sci-fi',
    'Sci-Fi',
    'Fantasy',
    'Medieval',
    'Emotional',
    'Dark Fantasy',
    'Lovecraftian',
    'Nature',
    'Colorful',
    'Surreal',
    'Comedy',
    'Wholesome',
    'Space',
    'Cyberpunk',
    'Post-apocalyptic',
    'Dystopian',
    'Historical',
    'Psychological',
    'Supernatural',
    'Magic',
    'Aliens',
    'Zombies',
    'Robots',
    'Vampire',
    'Dragons',
    'Dinosaurs',
    'Ninja',
    'Pirates',
    'Western',
    'Military',
    'War',
    'Demons',
    'Noir',
    'Detective',
    'Underwater',
    'Ocean',
    'Sailing',
    'Flight',
    'Trains',
    'Cats',
    'Dog',
    'Birds',
    'Horses',
    'Gothic',
    'Difficult',
    'Beautiful',
    'Gore',
    'Violent',
    'Blood',
    'Nudity',
    'Sexual Content',
    'Mature',
    'NSFW',
  ],
  visual: [
    'First-Person',
    'Third Person',
    'Third-Person',
    'Top-Down',
    'Isometric',
    'Side Scroller',
    '2D',
    '3D',
    'Pixel Graphics',
    'Realistic',
    'Anime',
    'Stylized',
    'Hand-drawn',
    'Minimalist',
    'Voxel',
    '2.5D',
    'Retro',
    'Cartoony',
    'Cinematic',
    'FMV',
    'Text-Based',
    'Abstract',
    'Comic Book',
    'VR',
    '360 Video',
  ],
  player: [
    'Singleplayer',
    'Multiplayer',
    'Co-op',
    'PvP',
    'PvE',
    'PvPvE',
    'Online Co-Op',
    'Online Co-op',
    'Local Co-Op',
    'Local Co-op',
    'Local Multiplayer',
    'Massively Multiplayer',
    'Split Screen',
    'Asynchronous Multiplayer',
    'Co-op Campaign',
  ],
};
const primaryBroad = new Set([
  'Action',
  'Adventure',
  'Casual',
  'Puzzle',
  'Racing',
  'RPG',
  'Simulation',
  'Sports',
  'Strategy',
  'Tabletop',
]);
/** @type {Array<[number, string[], string[], string[]]>} */
const blueprints = [
  [
    1562430,
    ['Adventure', 'Fishing'],
    ['Fishing', 'Exploration'],
    ['Atmospheric', 'Lovecraftian'],
  ],
  [
    1497440,
    ['Puzzle', 'Adventure'],
    ['Exploration', 'Logic'],
    ['Atmospheric', 'Surreal'],
  ],
  [
    1455840,
    ['City Builder', 'Puzzle'],
    ['Building', 'Strategy'],
    ['Relaxing', 'Nature'],
  ],
  [
    1574580,
    ['Puzzle', 'Simulation'],
    ['Investigation'],
    ['Mystery', 'Atmospheric'],
  ],
  [
    1336490,
    ['City Builder', 'Roguelite'],
    ['Resource Management', 'Base Building'],
    ['Fantasy', 'Dark Fantasy'],
  ],
  [
    2179850,
    ['Roguelike Deckbuilder', 'Strategy'],
    ['Deckbuilding', 'Turn-Based Combat'],
    ['Sci-fi', 'Cute'],
  ],
  [
    1931770,
    ['Puzzle', 'Adventure'],
    ['Exploration', 'Investigation'],
    ['Atmospheric', 'Mystery'],
  ],
  [2198150, ['Sandbox', 'Casual'], ['Building'], ['Relaxing', 'Nature']],
  [
    1593030,
    ['City Builder', 'Strategy'],
    ['Resource Management', 'Building'],
    ['Relaxing', 'Nature'],
  ],
  [
    2187290,
    ['Roguelite', 'Action'],
    ['Mining', 'Resource Management'],
    ['Sci-fi', 'Atmospheric'],
  ],
  [
    1677770,
    ['Puzzle', 'Adventure'],
    ['Investigation'],
    ['Mystery', 'Detective'],
  ],
  [
    553420,
    ['Action-Adventure', 'Souls-like'],
    ['Exploration', 'Combat'],
    ['Cute', 'Fantasy'],
  ],
  [
    1092790,
    ['Roguelike Deckbuilder', 'Card Game'],
    ['Deckbuilding', 'Card Battler'],
    ['Horror', 'Mystery'],
  ],
  [
    1970580,
    ['Roguelike', 'Dungeon Crawler'],
    ['Inventory Management', 'Turn-Based Combat'],
    ['Fantasy', 'Cute'],
  ],
  [
    1948280,
    ['Card Game', 'Colony Sim'],
    ['Resource Management', 'Building'],
    ['Relaxing', 'Cute'],
  ],
  [
    1637320,
    ['Roguelike', 'Tower Defense'],
    ['Mining', 'Resource Management'],
    ['Sci-fi', 'Atmospheric'],
  ],
  [
    1210320,
    ['Simulation', 'Crafting'],
    ['Crafting', 'Trading'],
    ['Medieval', 'Relaxing'],
  ],
  [
    646570,
    ['Roguelike Deckbuilder', 'Strategy'],
    ['Deckbuilding', 'Turn-Based Combat'],
    ['Fantasy'],
  ],
  [
    287980,
    ['Puzzle', 'Simulation'],
    ['Transportation', 'Resource Management'],
    ['Relaxing'],
  ],
  [
    1055540,
    ['Adventure', 'Exploration'],
    ['Exploration', 'Fishing'],
    ['Relaxing', 'Nature'],
  ],
];
const timestamp = new Date().toISOString();
await mkdir(`${root}data`, { recursive: true });
async function request(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'FindNewGame development data importer (one-time reference snapshot)',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) return response.json();
    if (response.status !== 429 && response.status < 500)
      throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error('Steam temporarily unavailable; existing snapshot preserved');
}
let tags;
if (process.argv.includes('--games-only'))
  tags = JSON.parse(await readFile(`${root}data/steam_tags.json`, 'utf8'));
else {
  const remote = await request(
    'https://store.steampowered.com/tagdata/populartags/english',
  );
  if (!Array.isArray(remote) || remote.length < 100)
    throw new Error('Unexpected official Steam tag response');
  tags = remote
    .map((t) => {
      const name = t.name;
      const category =
        Object.entries(groups).find(([, names]) => names.includes(name))?.[0] ??
        'metadata';
      return {
        id: Number(t.tagid),
        steam_name: name,
        slug: name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        category,
        subcategory: primaryBroad.has(name) ? 'broad' : category,
        importance_class: category === 'subgenre' ? 'specific' : category,
        is_onboarding_primary: ['subgenre', 'genre'].includes(category),
        is_quiz_primary:
          category !== 'metadata' &&
          category !== 'player' &&
          category !== 'visual',
        is_active: true,
        localizations_json: {},
        updated_at: timestamp,
      };
    })
    .sort((a, b) => a.steam_name.localeCompare(b.steam_name));
  if (new Set(tags.map((t) => t.id)).size !== tags.length)
    throw new Error('Duplicate Steam tag ids');
  refineTagCategories(tags);
  await writeFile(
    `${root}data/steam_tags.json`,
    JSON.stringify(tags, null, 2) + '\n',
  );
  console.log(
    `Saved ${tags.length} canonical Steam tags; ${tags.filter((t) => t.is_quiz_primary).length} curated quiz tags.`,
  );
}
if (process.argv.includes('--tags-only')) process.exit(0);
const byName = new Map(tags.map((t) => [t.steam_name, t.id]));
const games = [];
for (const [appId, genres, core, moods] of blueprints) {
  try {
    const data = (
      await request(
        `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english&cc=us`,
      )
    )[appId];
    if (!data?.success) throw new Error('App unavailable');
    const game = data.data;
    const names = [...new Set([...genres, ...core, ...moods])];
    const absent = names.filter((name) => !byName.has(name));
    if (absent.length)
      throw new Error(`Unknown canonical tag(s): ${absent.join(', ')}`);
    games.push({
      id: `sample-${appId}`,
      steamAppId: appId,
      title: game.name,
      developer: game.developers?.[0] ?? 'Independent studio',
      publisher:
        game.publishers?.[0] ?? game.developers?.[0] ?? 'Independent studio',
      steamUrl: `https://store.steampowered.com/app/${appId}/`,
      releaseState: game.release_date?.coming_soon ? 'coming_soon' : 'released',
      description: game.short_description
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"),
      capsule: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
      header: game.header_image,
      screenshots: (game.screenshots ?? []).slice(0, 5).map((s) => s.path_full),
      youtubeId: null,
      tagIds: names.map((n) => byName.get(n)),
      targets: {
        genre: genres.map((n) => byName.get(n)),
        core: core.map((n) => byName.get(n)),
        mood: moods.map((n) => byName.get(n)),
      },
      isDemo: true,
      source:
        'Steam public store metadata; illustrative target tags, not developer-confirmed ground truth',
      fetchedAt: timestamp,
    });
    console.log(`Imported ${games.length}/${blueprints.length}: ${game.name}`);
  } catch (error) {
    console.error(`App ${appId}: ${error.message}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
if (games.length < 15)
  throw new Error('Insufficient seed corpus; existing game snapshot preserved');
await writeFile(
  `${root}data/demo_games.json`,
  JSON.stringify(games, null, 2) + '\n',
);
console.log(
  `Saved ${games.length} demonstration games. Trailers must be separately verified; absent stages are visibly skipped.`,
);

await import('./prepare-demo.mjs');
