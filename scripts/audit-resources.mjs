import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
const storage = [];
for (const [path, kind] of [
  ['node_modules', 'installed dependencies'],
  ['node_modules/.vite', 'rebuildable development cache'],
  ['.vinext', 'build/font cache'],
  ['.next', 'generated compatibility files'],
  ['dist', 'production build output'],
  ['.wrangler', 'local runtime state; preserve the database'],
  ['tests/.runtime', 'temporary test harness'],
]) {
  const files = await filesIn(join(root, path));
  let bytes = 0;
  for (const file of files) bytes += (await stat(file)).size;
  storage.push({ path, kind, files: files.length, bytes });
}
const lock = JSON.parse(
  await readFile(join(root, 'package-lock.json'), 'utf8'),
);
const reactPackages = Object.entries(lock.packages)
  .filter(([path]) =>
    /node_modules\/(react|react-dom|react-server-dom-webpack)$/.test(path),
  )
  .map(([path, data]) => ({ path, version: data.version }));
const hashes = new Map();
let sourceFiles = 0;
for (const directory of [
  'app',
  'components',
  'lib',
  'scripts',
  'data',
  'public',
]) {
  for (const file of await filesIn(join(root, directory))) {
    const bytes = await readFile(file);
    if (!bytes.length) continue;
    sourceFiles++;
    const hash = createHash('sha256').update(bytes).digest('hex');
    const group = hashes.get(hash) ?? [];
    group.push(relative(root, file).replaceAll('\\', '/'));
    hashes.set(hash, group);
  }
}
const report = {
  date: new Date().toISOString(),
  storage,
  reactPackages,
  sourceFiles,
  identicalSourceFiles: [...hashes.values()].filter(
    (group) => group.length > 1,
  ),
  note: 'Read-only audit. Installed-dependency and nested-cache sizes overlap; do not sum them. Runtime state can contain durable local data. No global npm cache or other project data was removed.',
};
await mkdir(new URL('../../artifacts/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../../artifacts/resource-audit.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
