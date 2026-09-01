import { env } from 'cloudflare:workers';
import { activeTags, database } from '@/lib/server/database';
import {
  currentUser,
  makeDemo,
  requireAdmin,
  requireUser,
} from '@/lib/server/auth';
import {
  HttpError,
  assertSameOrigin,
  jsonBody,
  rateLimit,
  requireCondition,
  requestIp,
  verifyTurnstile,
  constantTimeEqual,
} from '@/lib/server/security';
import { dailyFor, rateDaily } from '@/lib/server/daily';
import {
  interact,
  roundView,
  startRound,
  submitGuess,
} from '@/lib/server/quiz';
import {
  collection,
  deleteAccount,
  exportAccount,
  history,
  reportGame,
  saveProfile,
} from '@/lib/server/profile';
import {
  createDeveloper,
  developerDashboard,
  ownedGame,
  steamLookup,
  submitGame,
  studioTeam,
  updateStudioTeam,
} from '@/lib/server/developer';
import { calibrationReport } from '@/lib/server/analytics';
import {
  createExperiment,
  experimentReport,
  finishExperiment,
} from '@/lib/server/experiments';
import {
  audienceEstimate,
  createCampaign,
  nextAd,
  recordAdClick,
  recordImpression,
  updateCampaignState,
  validateTarget,
} from '@/lib/server/ads';
import {
  billingHistory,
  billingInfo,
  checkoutCampaign,
  donationLink,
  handleWebhook,
} from '@/lib/server/payments';
import {
  adminOverview,
  fundTestCampaign,
  maintenance,
  moderate,
  updatePrice,
  updateTag,
  adminTags,
  adminExperiment,
  reconcilePurchase,
  claimSampleStudio,
} from '@/lib/server/admin';
import { roundAsset, uploadedAsset, uploadImage } from '@/lib/server/assets';
import { updateDiscoveryPolicy } from '@/lib/server/discovery-policy';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
async function handler(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params,
    route = path.join('/'),
    method = request.method,
    url = new URL(request.url),
    demo = url.searchParams.get('demo') === '1';
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie, oai-authenticated-user-id',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  const response = (value: unknown, status = 200) =>
    Response.json(value, { status, headers });
  try {
    if (route.startsWith('webhooks/') && method === 'POST')
      return response(await handleWebhook(path[1], request));
    if (route === 'maintenance' && method === 'POST') {
      requireCondition(
        env.MAINTENANCE_TOKEN &&
          (await constantTimeEqual(
            request.headers.get('authorization') ?? '',
            `Bearer ${env.MAINTENANCE_TOKEN}`,
          )),
        'Maintenance authentication required.',
        401,
      );
      return response(await maintenance());
    }
    if (method !== 'GET' && method !== 'HEAD') assertSameOrigin(request);
    if (route === 'health' && method === 'GET') {
      await database();
      return response({
        status: 'ok',
        database: 'connected',
        version: '0.1.0',
      });
    }
    if (route === 'tags' && method === 'GET') {
      const db = await database();
      return response({ tags: await activeTags(db) });
    }
    if (route === 'me' && method === 'GET') {
      const user = await currentUser(request);
      return response({
        user,
        site: {
          catalogMode: env.CATALOG_MODE ?? 'demo',
          billingEnabled: env.BILLING_ENABLED === 'true',
          turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
        },
      });
    }
    if (route === 'demo' && method === 'POST') {
      await rateLimit(`demo:${requestIp(request)}`, 15, 3600000);
      const body = await jsonBody(request);
      await verifyTurnstile(body.turnstileToken, request);
      const session = await makeDemo(request);
      if (session.cookie) headers.set('Set-Cookie', session.cookie);
      return response({ user: session.user });
    }
    if (route === 'billing/info' && method === 'GET')
      return response(await billingInfo());
    if (route === 'support' && method === 'POST') {
      await rateLimit(`support:${requestIp(request)}`, 10, 60000);
      const body = await jsonBody(request);
      return response(await donationLink(String(body.provider)));
    }
    if (path[0] === 'assets' && path.length >= 2 && method === 'GET')
      return await uploadedAsset(
        await currentUser(request),
        decodeURIComponent(path.slice(1).join('/')),
      );
    const user = await requireUser(
      request,
      demo &&
        [
          'daily',
          'round',
          'interaction',
          'report',
          'history',
          'collection',
        ].includes(path[0]),
    );
    if (method !== 'GET') await rateLimit(`mutate:${user.id}`, 120, 60000);
    if (route === 'profile' && method === 'POST') {
      requireCondition(!user.isDemo, 'Sign in to save preferences.', 401);
      return response(await saveProfile(user, await jsonBody(request)));
    }
    if (route === 'daily' && method === 'POST') {
      await rateLimit(`daily:${user.id}`, 30, 60000);
      return response(await dailyFor(user));
    }
    if (route === 'daily/relevance' && method === 'POST') {
      const body = await jsonBody(request);
      return response(
        await rateDaily(user, String(body.setId), String(body.rating)),
      );
    }
    if (path[0] === 'round' && path[1]) {
      if (path[2] === 'asset' && method === 'GET')
        return await roundAsset(user, path[1], Number(path[3]));
      if (path.length === 2 && method === 'GET')
        return response(await roundView(user, path[1]));
      if (path[2] === 'start' && method === 'POST')
        return response(await startRound(user, path[1]));
      if (path[2] === 'guess' && method === 'POST')
        return response(
          await submitGuess(user, path[1], await jsonBody(request)),
        );
    }
    if (route === 'interaction' && method === 'POST') {
      const body = await jsonBody(request);
      return response(
        await interact(
          user,
          String(body.roundId),
          String(body.kind),
          body.active !== false,
        ),
      );
    }
    if (route === 'collection' && method === 'GET')
      return response(await collection(user));
    if (route === 'history' && method === 'GET')
      return response(
        await history(user, url.searchParams.get('before') ?? undefined),
      );
    if (route === 'report' && method === 'POST') {
      await rateLimit(`report:${user.id}`, 10, 3600000);
      return response(await reportGame(user, await jsonBody(request)));
    }
    if (route === 'account/export' && method === 'GET') {
      headers.set(
        'Content-Disposition',
        'attachment; filename="findnewgame-data.json"',
      );
      return response(await exportAccount(user));
    }
    if (route === 'account' && method === 'DELETE')
      return response(await deleteAccount(user, await jsonBody(request)));
    if (route === 'developer' && method === 'GET')
      return response(await developerDashboard(user));
    if (route === 'developer/team' && method === 'GET')
      return response(await studioTeam(user));
    if (route === 'developer/team' && method === 'POST')
      return response(await updateStudioTeam(user, await jsonBody(request)));
    if (route === 'developer' && method === 'POST') {
      await rateLimit(`studio:${user.id}`, 5, 3600000);
      return response(await createDeveloper(user, await jsonBody(request)));
    }
    if (route === 'steam/lookup' && method === 'POST') {
      await rateLimit(`steam:${user.id}`, 10, 60000);
      return response(await steamLookup((await jsonBody(request)).steamUrl));
    }
    if (route === 'assets/upload' && method === 'POST') {
      await rateLimit(`upload:${user.id}`, 20, 3600000);
      return response(await uploadImage(user, request));
    }
    if (path[0] === 'games' && method === 'POST') {
      await rateLimit(`submit:${user.id}`, 10, 3600000);
      const body = await jsonBody(request);
      await verifyTurnstile(body.turnstileToken, request);
      return response(await submitGame(user, body, path[1]));
    }
    if (path[0] === 'games' && path[1] && method === 'GET') {
      const game = await ownedGame(user, path[1]);
      return response({
        ...game,
        content: JSON.parse(game.content_json),
        content_json: undefined,
      });
    }
    if (path[0] === 'analytics' && path[1] && method === 'GET')
      return response(
        await calibrationReport(
          user,
          path[1],
          url.searchParams.get('version') ?? undefined,
        ),
      );
    if (route === 'experiments' && method === 'POST')
      return response(await createExperiment(user, await jsonBody(request)));
    if (path[0] === 'experiments' && path[1] && method === 'GET')
      return response(await experimentReport(user, path[1]));
    if (path[0] === 'experiments' && path[1] && method === 'PATCH')
      return response(await finishExperiment(user, path[1]));
    if (route === 'campaigns/audience' && method === 'POST')
      return response(
        await audienceEstimate(await validateTarget(await jsonBody(request))),
      );
    if (route === 'campaigns' && method === 'POST')
      return response(await createCampaign(user, await jsonBody(request)));
    if (path[0] === 'campaigns' && path[1] && method === 'PATCH')
      return response(
        await updateCampaignState(user, path[1], await jsonBody(request)),
      );
    if (route === 'ads/next' && method === 'POST')
      return response(
        await nextAd(user, String((await jsonBody(request)).roundId)),
      );
    if (route === 'ads/impression' && method === 'POST')
      return response(await recordImpression(user, await jsonBody(request)));
    if (route === 'ads/click' && method === 'POST')
      return response(
        await recordAdClick(user, String((await jsonBody(request)).offerId)),
      );
    if (route === 'billing/checkout' && method === 'POST')
      return response(await checkoutCampaign(user, await jsonBody(request)));
    if (route === 'billing/history' && method === 'GET')
      return response(await billingHistory(user));
    if (path[0] === 'admin') {
      await requireAdmin(request);
      if (route === 'admin' && method === 'GET')
        return response(await adminOverview());
      if (route === 'admin/tags' && method === 'GET')
        return response(await adminTags());
      if (path[1] === 'experiments' && path[2] && method === 'GET')
        return response(await adminExperiment(path[2]));
      if (route === 'admin/reconcile' && method === 'POST')
        return response(await reconcilePurchase(user, await jsonBody(request)));
      if (route === 'admin/claim-studio' && method === 'POST')
        return response(await claimSampleStudio(user, await jsonBody(request)));
      if (route === 'admin/moderate' && method === 'POST')
        return response(await moderate(user, await jsonBody(request)));
      if (route === 'admin/maintenance' && method === 'POST')
        return response(await maintenance());
      if (route === 'admin/tags' && method === 'PATCH')
        return response(await updateTag(user, await jsonBody(request)));
      if (route === 'admin/price' && method === 'PATCH')
        return response(await updatePrice(user, await jsonBody(request)));
      if (route === 'admin/discovery' && method === 'PATCH')
        return response(
          await updateDiscoveryPolicy(
            await database(),
            user,
            await jsonBody(request),
          ),
        );
      if (route === 'admin/fund-test' && method === 'POST')
        return response(
          await fundTestCampaign(String((await jsonBody(request)).campaignId)),
        );
    }
    throw new HttpError(404, 'This endpoint does not exist.', 'not_found');
  } catch (error) {
    if (error instanceof HttpError)
      return response(
        { error: error.message, code: error.code, details: error.details },
        error.status,
      );
    console.error(
      'FindNewGame API error',
      method,
      route,
      error instanceof Error ? error.message : 'Unknown error',
    );
    return response(
      {
        error:
          'Something went wrong. Please try again. Your saved progress has not been reset.',
        code: 'server_error',
      },
      500,
    );
  }
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
