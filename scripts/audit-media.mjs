import { readFile, writeFile, mkdir } from 'node:fs/promises';
const games = JSON.parse(
  await readFile(new URL('../data/demo_games.json', import.meta.url), 'utf8'),
);
const queue = games.flatMap((game) => [
  { game: game.title, kind: 'artwork', url: game.capsule },
  ...game.screenshots.map((url, i) => ({
    game: game.title,
    kind: `screenshot ${i + 1}`,
    url,
  })),
]);
const results = [];
async function worker() {
  while (queue.length) {
    const item = queue.shift();
    try {
      const response = await fetch(item.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(15000),
      });
      results.push({
        ...item,
        status: response.status,
        type: response.headers.get('content-type'),
        bytes: Number(response.headers.get('content-length')),
      });
    } catch (error) {
      results.push({ ...item, status: 0, error: error.message });
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
await mkdir(new URL('../../artifacts/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../../artifacts/media-audit.json', import.meta.url),
  JSON.stringify({ date: new Date().toISOString(), results }, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    checked: results.length,
    ok: results.filter((r) => r.status === 200).length,
    failures: results.filter((r) => r.status !== 200),
  }),
);
