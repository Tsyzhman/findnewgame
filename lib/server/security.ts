import { env } from 'cloudflare:workers';
import { database, first, sha256 } from './database';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'request_failed',
    public details?: unknown,
  ) {
    super(message);
  }
}
export function requireCondition(
  condition: unknown,
  message: string,
  status = 400,
  code = 'invalid_request',
): asserts condition {
  if (!condition) throw new HttpError(status, message, code);
}
export async function jsonBody(
  request: Request,
  maxBytes = 32_768,
): Promise<Record<string, unknown>> {
  requireCondition(
    Number(request.headers.get('content-length') ?? 0) <= maxBytes,
    'Request body is too large.',
    413,
  );
  requireCondition(
    (request.headers.get('content-type') ?? '').includes('application/json'),
    'Content-Type must be application/json.',
    415,
  );
  const reader = request.body?.getReader();
  requireCondition(reader, 'A JSON body is required.');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'Request body is too large.');
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
  requireCondition(
    value && typeof value === 'object' && !Array.isArray(value),
    'A JSON object is required.',
  );
  return value;
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const url = new URL(request.url);
  requireCondition(
    !origin || origin === url.origin,
    'This action must originate from this site.',
    403,
    'origin_mismatch',
  );
  const site = request.headers.get('sec-fetch-site');
  requireCondition(
    !site || ['same-origin', 'none'].includes(site),
    'Cross-site requests are not allowed.',
    403,
    'origin_mismatch',
  );
  requireCondition(
    request.headers.get('x-fng-request') === '1',
    'Missing request protection header.',
    403,
    'request_header_required',
  );
}
export async function rateLimit(key: string, limit: number, windowMs: number) {
  const db = await database(),
    now = Date.now(),
    window = Math.floor(now / windowMs),
    hash = await sha256(`${key}:${window}`),
    expires = (window + 1) * windowMs;
  const row = await db
    .prepare(
      'INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
    )
    .bind(hash, expires)
    .first<{ count: number }>();
  requireCondition(
    row && row.count <= limit,
    'Too many requests. Please try again shortly.',
    429,
    'rate_limited',
  );
}
export function requestIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'local';
}
export async function verifyTurnstile(token: unknown, request: Request) {
  if (!env.TURNSTILE_SECRET_KEY) return;
  requireCondition(
    typeof token === 'string' && token.length <= 2048,
    'Please complete the security check.',
    400,
    'turnstile_required',
  );
  let response: Response;
  try {
    response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: token,
          remoteip: requestIp(request),
        }),
        signal: AbortSignal.timeout(7000),
      },
    );
  } catch {
    throw new HttpError(
      503,
      'Security check is temporarily unavailable. Please try again.',
    );
  }
  const result = (await response.json()) as {
    success: boolean;
    hostname?: string;
  };
  const expected = env.SITE_URL
    ? new URL(env.SITE_URL).hostname
    : new URL(request.url).hostname;
  requireCondition(
    response.ok && result.success && result.hostname === expected,
    'Security check failed. Please try again.',
    403,
    'turnstile_failed',
  );
}
export function textField(
  value: unknown,
  label: string,
  min: number,
  max: number,
): string {
  requireCondition(typeof value === 'string', `${label} is required.`);
  const text = value.trim();
  requireCondition(
    text.length >= min && text.length <= max,
    `${label} must be ${min}–${max} characters.`,
  );
  return text;
}
export function safeUrl(
  value: unknown,
  label = 'URL',
  hosts?: string[],
): string {
  const raw = textField(value, label, 8, 2048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, `${label} must be a valid URL.`);
  }
  requireCondition(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443'),
    `${label} must use HTTPS without credentials.`,
  );
  if (hosts)
    requireCondition(
      hosts.includes(url.hostname),
      `${label} must use an approved host.`,
    );
  return url.toString();
}
export const STEAM_IMAGE_HOSTS = [
  'shared.fastly.steamstatic.com',
  'shared.akamai.steamstatic.com',
  'cdn.akamai.steamstatic.com',
  'cdn.cloudflare.steamstatic.com',
  'cdn.fastly.steamstatic.com',
  'steamcdn-a.akamaihd.net',
];
export function imageReference(value: unknown): string {
  if (
    typeof value === 'string' &&
    /^r2:images\/[a-zA-Z0-9_/-]+\.(webp|png|jpg)$/.test(value)
  )
    return value;
  return safeUrl(value, 'Image URL', STEAM_IMAGE_HOSTS);
}
export function parseSteamUrl(value: unknown): { url: string; appId: number } {
  const url = safeUrl(value, 'Steam store URL', ['store.steampowered.com']);
  const match = new URL(url).pathname.match(/^\/app\/(\d+)(?:\/|$)/);
  requireCondition(
    match,
    'Use a Steam game URL such as https://store.steampowered.com/app/123456/.',
  );
  const appId = Number(match[1]);
  requireCondition(
    Number.isSafeInteger(appId) && appId > 0 && appId <= 2147483647,
    'Invalid Steam App ID.',
  );
  return { url: `https://store.steampowered.com/app/${appId}/`, appId };
}
export function youtubeId(value: unknown): string | null {
  if (value === null || value === '') return null;
  const raw = textField(value, 'YouTube trailer', 1, 2048);
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  const url = new URL(
    safeUrl(raw, 'YouTube trailer', [
      'www.youtube.com',
      'youtube.com',
      'youtu.be',
    ]),
  );
  const id =
    url.hostname === 'youtu.be'
      ? url.pathname.slice(1)
      : (url.searchParams.get('v') ??
        url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1]);
  requireCondition(
    id && /^[a-zA-Z0-9_-]{11}$/.test(id),
    'Use a valid YouTube video URL.',
  );
  return id;
}
export async function constantTimeEqual(
  left: string,
  right: string,
): Promise<boolean> {
  const a = await sha256(left),
    b = await sha256(right);
  let different = a.length ^ b.length;
  for (let i = 0; i < a.length; i++)
    different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
export async function assertUploadOwnership(
  db: D1Database,
  ownerId: string,
  refs: string[],
) {
  for (const ref of refs.filter((r) => r.startsWith('r2:'))) {
    const upload = await first<{ owner_user_id: string | null }>(
      db,
      'SELECT owner_user_id FROM uploads WHERE object_key=?',
      ref.slice(3),
    );
    requireCondition(
      upload?.owner_user_id === ownerId,
      'You can only use images you uploaded.',
      403,
    );
  }
}
