import { env } from 'cloudflare:workers';
import { CONFIG } from '@/lib/config';
import type { PublicUser } from '@/lib/types';
import { database, first, id, sha256 } from './database';
import {
  HttpError,
  requireCondition,
  STEAM_IMAGE_HOSTS,
  safeUrl,
} from './security';
import { contentOf, ownedRound } from './quiz';

export function sniffImage(
  bytes: Uint8Array,
): { type: string; extension: string } | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { type: 'image/jpeg', extension: 'jpg' };
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return { type: 'image/png', extension: 'png' };
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  )
    return { type: 'image/webp', extension: 'webp' };
  return null;
}
export async function uploadImage(user: PublicUser, request: Request) {
  requireCondition(!user.isDemo, 'Sign in before uploading artwork.', 401);
  requireCondition(
    Number(request.headers.get('content-length') ?? 0) <=
      CONFIG.maxUploadBytes + 4096,
    'Choose an image smaller than 3 MB.',
    413,
  );
  const reader = request.body?.getReader();
  requireCondition(reader, 'Image data is required.');
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > CONFIG.maxUploadBytes) {
      await reader.cancel();
      throw new HttpError(413, 'Choose an image smaller than 3 MB.');
    }
    parts.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  const image = sniffImage(bytes);
  requireCondition(
    image,
    'Only JPEG, PNG, and WebP images are accepted. SVG, GIF, and video uploads are not allowed.',
    415,
  );
  const db = await database(),
    hash = await sha256(bytes.buffer),
    existing = await first<{
      id: string;
      object_key: string;
      created_at: number;
    }>(
      db,
      'SELECT id,object_key,created_at FROM uploads WHERE owner_user_id=? AND sha256=?',
      user.id,
      hash,
    );
  requireCondition(env.FILES, 'Image storage is not configured.', 503);
  if (existing) {
    if (await env.FILES.head(existing.object_key))
      return {
        reference: `r2:${existing.object_key}`,
        url: `/api/assets/${encodeURIComponent(existing.object_key)}`,
        deduplicated: true,
      };
    requireCondition(
      existing.created_at < Date.now() - 15 * 60000,
      'This identical image is still being uploaded. Please retry in a moment.',
      409,
      'upload_pending',
    );
    // Recover a crashed reservation only after confirming its object is absent.
    // The same content hash ensures concurrent retries cannot change the bytes.
    await db
      .prepare('DELETE FROM uploads WHERE id=? AND created_at=?')
      .bind(existing.id, existing.created_at)
      .run();
  }
  const namespace = (await sha256(user.id)).slice(0, 16),
    key = `images/${namespace}/${hash}.${image.extension}`,
    assetId = id('asset-');
  const reserved = await db
    .prepare(
      'INSERT OR IGNORE INTO uploads (id,owner_user_id,object_key,sha256,content_type,size,created_at) SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT SUM(size) FROM uploads WHERE owner_user_id=?),0)+?<=?',
    )
    .bind(
      assetId,
      user.id,
      key,
      hash,
      image.type,
      size,
      Date.now(),
      user.id,
      size,
      CONFIG.maxUserAssetBytes,
    )
    .run();
  if (!reserved.meta.changes) {
    const concurrent = await first<{ object_key: string }>(
      db,
      'SELECT object_key FROM uploads WHERE owner_user_id=? AND sha256=?',
      user.id,
      hash,
    );
    if (concurrent) {
      requireCondition(
        await env.FILES.head(concurrent.object_key),
        'This identical image is still being uploaded. Please retry in a moment.',
        409,
        'upload_pending',
      );
      return {
        reference: `r2:${concurrent.object_key}`,
        url: `/api/assets/${encodeURIComponent(concurrent.object_key)}`,
        deduplicated: true,
      };
    }
    throw new HttpError(
      413,
      'This account has reached its 100 MB image storage limit. Contact the operator before uploading more materials.',
      'storage_limit',
    );
  }
  try {
    await env.FILES.put(key, bytes, {
      httpMetadata: {
        contentType: image.type,
        cacheControl: 'private, max-age=86400',
      },
      customMetadata: { sha256: hash },
    });
  } catch {
    await db.prepare('DELETE FROM uploads WHERE id=?').bind(assetId).run();
    throw new HttpError(
      503,
      'The image could not be stored. Please retry.',
      'storage_unavailable',
    );
  }
  return {
    reference: `r2:${key}`,
    url: `/api/assets/${encodeURIComponent(key)}`,
    deduplicated: false,
  };
}
export async function imageResponse(reference: string): Promise<Response> {
  const headers = new Headers({
    'Cache-Control': 'private, max-age=3600',
    Vary: 'Cookie, oai-authenticated-user-id',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  if (reference.startsWith('r2:')) {
    const object = await env.FILES.get(reference.slice(3));
    requireCondition(object, 'Image not found.', 404);
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'private, max-age=3600');
    headers.set('ETag', object.httpEtag);
    return new Response(object.body, { headers });
  }
  const url = safeUrl(reference, 'Image URL', STEAM_IMAGE_HOSTS);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(9000),
      redirect: 'manual',
    });
  } catch (error) {
    console.error(
      'Artwork upstream request failed:',
      error instanceof Error ? error.message : 'Unknown network error',
    );
    throw new HttpError(
      502,
      'The artwork could not be loaded. Please retry.',
      'asset_unavailable',
    );
  }
  requireCondition(
    response.ok,
    'The artwork is unavailable. Ask the developer to replace it.',
    502,
    'asset_unavailable',
  );
  const type = response.headers.get('content-type')?.split(';')[0] ?? '';
  requireCondition(
    ['image/jpeg', 'image/png', 'image/webp'].includes(type),
    'The upstream resource is not a supported image.',
    415,
  );
  requireCondition(
    Number(response.headers.get('content-length') ?? 0) <= 6 * 1024 * 1024,
    'Upstream image is too large.',
    413,
  );
  headers.set('Content-Type', type);
  requireCondition(response.body, 'The upstream image is empty.', 502);
  let bytesRead = 0;
  const bounded = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesRead += chunk.byteLength;
        if (bytesRead > 6 * 1024 * 1024) {
          controller.error(
            new Error('Upstream image exceeded the 6 MB streaming limit.'),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(bounded, { headers });
}
export async function roundAsset(
  user: PublicUser,
  roundId: string,
  index: number,
) {
  const db = await database(),
    round = await ownedRound(db, user, roundId),
    content = contentOf(round);
  requireCondition(
    Number.isInteger(index) && index >= 0 && index <= 5,
    'Image not found.',
    404,
  );
  const unlocked = round.status === 'complete' ? 6 : round.stage;
  requireCondition(
    index === 0 ||
      (index === 1 && unlocked >= 2) ||
      (index >= 2 && unlocked >= 3),
    'This clue is still locked.',
    403,
    'clue_locked',
  );
  const reference =
    index === 0 ? content.capsule : content.screenshots[index - 1];
  requireCondition(reference, 'Image not found.', 404);
  return imageResponse(reference);
}
export async function uploadedAsset(user: PublicUser | null, key: string) {
  requireCondition(
    /^images\/[a-f0-9]{16}\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(key),
    'Image not found.',
    404,
  );
  const db = await database();
  const upload = await first<{ owner_user_id: string | null }>(
    db,
    'SELECT owner_user_id FROM uploads WHERE object_key=?',
    key,
  );
  requireCondition(upload, 'Image not found.', 404);
  if (user?.id !== upload.owner_user_id && user?.role !== 'admin') {
    // Only approved published store assets / ad creatives are publicly readable.
    const publicUse = await first(
      db,
      "SELECT 1 FROM games g JOIN game_versions v ON v.id=g.current_version_id WHERE g.status='published' AND instr(v.content_json,?)>0 UNION ALL SELECT 1 FROM ad_campaigns WHERE moderation_status='approved' AND instr(creative_json,?)>0 LIMIT 1",
      `r2:${key}`,
      `r2:${key}`,
    );
    requireCondition(publicUse, 'Image not found.', 404);
  }
  return imageResponse(`r2:${key}`);
}
