import { readFile, mkdir, writeFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../app/globals.css', import.meta.url),
  'utf8',
);
function luminance(value) {
  const hex = value.slice(1),
    normalized = hex.length === 3 ? [...hex].map((x) => x + x).join('') : hex;
  if (!/^[a-f\d]{6}$/i.test(normalized))
    throw new Error(`Unsupported token: ${value}`);
  return [0, 2, 4]
    .map((i) => parseInt(normalized.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
const checks = [];
for (const theme of ['light', 'dark']) {
  const block = source.match(
    new RegExp(`html\\[data-theme='${theme}'\\]\\s*\\{([^}]+)\\}`),
  )?.[1];
  if (!block) throw new Error(`Theme not found: ${theme}`);
  const tokens = Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[a-f\d]+)\s*;/gi)].map((m) => [
      m[1],
      m[2],
    ]),
  );
  const check = (foreground, background, minimum) => {
    const a = luminance(tokens[foreground]),
      b = luminance(tokens[background]),
      ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    checks.push({
      theme,
      foreground,
      background,
      ratio: Number(ratio.toFixed(3)),
      minimum,
      passed: ratio >= minimum,
    });
  };
  for (const background of [
    'bg-page',
    'bg-page-alt',
    'surface-1',
    'surface-2',
    'surface-3',
  ]) {
    for (const foreground of [
      'text-primary',
      'text-secondary',
      'text-muted',
      'accent-primary',
    ])
      check(foreground, background, 4.5);
    check('control-border', background, 3);
  }
  for (const semantic of [
    'accent-primary',
    'accent-secondary',
    'success',
    'warning',
    'danger',
  ])
    check(semantic, `${semantic}-soft`, 4.5);
}
const report = {
  date: new Date().toISOString(),
  scope:
    'Static text and input-border token pairs. This is not a full WCAG conformance audit; photographs, gradients, device rendering, and interaction states also need visual review.',
  checks,
  passed: checks.every((check) => check.passed),
};
await mkdir(new URL('../../artifacts/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../../artifacts/contrast-audit.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      checks: checks.length,
      passed: report.passed,
      failures: checks.filter((check) => !check.passed),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
