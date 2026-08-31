import { env } from 'cloudflare:workers';
import type { PublicUser } from '@/lib/types';
import {
  normalizeLavaEvent,
  normalizeTributeEvent,
  verifyTributeSignature,
  type PaymentEvent,
} from '@/lib/payment-contracts';
import { all, database, first, id, sha256 } from './database';
import {
  constantTimeEqual,
  HttpError,
  requireCondition,
  safeUrl,
  textField,
} from './security';
import { developerFor } from './developer';
import { CONFIG } from '@/lib/config';

export interface PaymentProvider {
  readonly name: 'lava' | 'tribute';
  configured(): boolean;
  checkout(input: {
    email: string;
    amountCents: number;
    currency: string;
    returnUrl: string;
  }): Promise<{ externalId: string; url: string }>;
  verify(raw: string, headers: Headers): Promise<boolean>;
  parse(data: Record<string, unknown>): Promise<PaymentEvent>;
}
export class LavaProvider implements PaymentProvider {
  readonly name = 'lava';
  configured() {
    return (
      !!env.LAVA_API_KEY && !!env.LAVA_OFFER_ID && !!env.LAVA_WEBHOOK_TOKEN
    );
  }
  async checkout(input: {
    email: string;
    amountCents: number;
    currency: string;
    returnUrl: string;
  }) {
    requireCondition(
      this.configured(),
      'Lava checkout is not configured.',
      503,
      'provider_unavailable',
    );
    let response: Response;
    try {
      response = await fetch('https://gate.lava.top/api/v3/invoice', {
        method: 'POST',
        headers: {
          'X-Api-Key': env.LAVA_API_KEY!,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          email: input.email,
          offerId: env.LAVA_OFFER_ID,
          currency: input.currency,
          amount: input.amountCents / 100,
          buyerLanguage: 'EN',
          successful_return_url: input.returnUrl,
          failure_return_url: input.returnUrl,
          cancel_return_url: input.returnUrl,
        }),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new HttpError(
        502,
        'The payment provider did not respond. Do not retry immediately; check your billing history.',
        'provider_uncertain',
      );
    }
    requireCondition(
      response.ok,
      'The payment provider could not create an invoice.',
      502,
      'provider_error',
    );
    const data = (await response.json()) as {
      id?: string;
      paymentUrl?: string;
    };
    requireCondition(
      data.id && data.paymentUrl,
      'The payment provider returned an incomplete invoice.',
      502,
    );
    return {
      externalId: data.id,
      url: safeUrl(data.paymentUrl, 'Payment URL'),
    };
  }
  async verify(raw: string, headers: Headers) {
    void raw;
    return (
      !!env.LAVA_WEBHOOK_TOKEN &&
      constantTimeEqual(headers.get('X-Api-Key') ?? '', env.LAVA_WEBHOOK_TOKEN)
    );
  }
  async parse(data: Record<string, unknown>) {
    return normalizeLavaEvent(data);
  }
}
export class TributeProvider implements PaymentProvider {
  readonly name = 'tribute';
  configured() {
    return !!env.TRIBUTE_API_KEY;
  }
  async checkout(): Promise<{ externalId: string; url: string }> {
    throw new HttpError(
      409,
      'Tribute creator products do not carry a campaign invoice ID. Use Lava checkout for automatic campaign billing. Tribute donations and signed purchase reconciliation are supported.',
      'tribute_manual_reconciliation',
    );
  }
  async verify(raw: string, headers: Headers) {
    return verifyTributeSignature(
      raw,
      headers.get('trbt-signature') ?? '',
      env.TRIBUTE_API_KEY ?? '',
    );
  }
  async parse(data: Record<string, unknown>) {
    return normalizeTributeEvent(data);
  }
}
const providers = { lava: new LavaProvider(), tribute: new TributeProvider() };
export async function billingInfo() {
  const db = await database(),
    price = await first<{ value_json: string }>(
      db,
      'SELECT value_json FROM site_config WHERE key=?',
      'impression_price_cents',
    );
  return {
    enabled: env.BILLING_ENABLED === 'true',
    lavaConfigured: providers.lava.configured(),
    tributeConfigured: providers.tribute.configured(),
    tributeDonationUrl: env.TRIBUTE_DONATION_URL
      ? safeUrl(env.TRIBUTE_DONATION_URL, 'Tribute donation URL', [
          't.me',
          'tribute.tg',
          'web.tribute.tg',
        ])
      : null,
    impressionPriceCents: Number(
      price?.value_json ?? CONFIG.defaultImpressionPriceCents,
    ),
    currency: 'USD',
    notice:
      'Payments do not affect organic discovery. No checkout is enabled until the merchant account is configured and verified.',
  };
}
export async function checkoutCampaign(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  requireCondition(
    env.BILLING_ENABLED === 'true',
    'Paid campaigns are not enabled in this beta.',
    503,
    'billing_disabled',
  );
  requireCondition(
    env.SITE_URL,
    'A trusted site URL is required before billing can be enabled.',
    503,
  );
  const provider = providers[String(body.provider) as keyof typeof providers];
  requireCondition(provider, 'Choose a payment provider.');
  requireCondition(
    provider.name === 'lava',
    'Tribute purchases require verified manual reconciliation. Use Lava for automatic campaign invoicing.',
    409,
    'tribute_manual_reconciliation',
  );
  requireCondition(
    provider.configured(),
    'This payment provider is not configured.',
    503,
  );
  const db = await database(),
    developer = await developerFor(user),
    campaignId = textField(body.campaignId, 'Campaign', 1, 100);
  const campaign = await first<{
    requested_impressions: number;
    payment_status: string;
    moderation_status: string;
    is_test: number;
  }>(
    db,
    'SELECT requested_impressions,payment_status,moderation_status,is_test FROM ad_campaigns WHERE id=? AND developer_id=?',
    campaignId,
    developer?.id ?? '',
  );
  requireCondition(campaign, 'Campaign not found.', 404);
  requireCondition(!campaign.is_test, 'Test campaigns do not accept payments.');
  requireCondition(
    campaign.moderation_status === 'approved',
    'Approve the campaign before accepting payment.',
    409,
  );
  requireCondition(
    campaign.payment_status !== 'paid',
    'This campaign is already funded.',
    409,
  );
  const existing = await first<{
    id: string;
    checkout_url: string | null;
    status: string;
  }>(
    db,
    "SELECT id,checkout_url,status FROM payments WHERE campaign_id=? AND status IN ('pending','creating','uncertain') ORDER BY created_at DESC LIMIT 1",
    campaignId,
  );
  if (existing) {
    requireCondition(
      existing.checkout_url,
      'An invoice request is already being processed. Check billing history before trying again.',
      409,
      'invoice_in_progress',
    );
    return { id: existing.id, url: existing.checkout_url };
  }
  const price = await billingInfo(),
    amountCents = Math.round(
      campaign.requested_impressions * price.impressionPriceCents,
    ),
    paymentId = id('payment-');
  requireCondition(user.email, 'An account email is required for payment.');
  const reserved = await db.batch([
    db
      .prepare(
        "INSERT INTO payments (id,user_id,provider,purpose,campaign_id,amount_cents,currency,status,impressions,created_at) SELECT ?,?,?,'campaign',?,?,'USD','creating',?,? FROM ad_campaigns WHERE id=? AND payment_status='unpaid' AND moderation_status='approved' AND NOT EXISTS (SELECT 1 FROM payments WHERE campaign_id=? AND status IN ('creating','pending','uncertain','paid'))",
      )
      .bind(
        paymentId,
        user.id,
        provider.name,
        campaignId,
        amountCents,
        campaign.requested_impressions,
        Date.now(),
        campaignId,
        campaignId,
      ),
    db
      .prepare(
        "UPDATE ad_campaigns SET payment_status='processing' WHERE id=? AND EXISTS (SELECT 1 FROM payments WHERE id=?)",
      )
      .bind(campaignId, paymentId),
  ]);
  requireCondition(
    reserved[0].meta.changes === 1,
    'Another payment request is already in progress.',
    409,
    'invoice_in_progress',
  );
  try {
    const invoice = await provider.checkout({
      email: user.email,
      amountCents,
      currency: 'USD',
      returnUrl: `${new URL(safeUrl(env.SITE_URL, 'Site URL')).origin}/developer/ads?payment=${paymentId}`,
    });
    await db
      .prepare(
        "UPDATE payments SET external_payment_id=?,checkout_url=?,status='pending' WHERE id=?",
      )
      .bind(invoice.externalId, invoice.url, paymentId)
      .run();
    return { id: paymentId, url: invoice.url };
  } catch (error) {
    await db
      .prepare("UPDATE payments SET status='uncertain' WHERE id=?")
      .bind(paymentId)
      .run();
    throw error;
  }
}
type PaymentRow = {
  id: string;
  user_id: string | null;
  campaign_id: string | null;
  amount_cents: number;
  currency: string;
  purpose: string;
  status: string;
  impressions: number;
  provisioned_at: number | null;
};
export async function handleWebhook(providerName: string, request: Request) {
  const provider = providers[providerName as keyof typeof providers];
  requireCondition(provider, 'Unknown payment provider.', 404);
  requireCondition(
    providerName === 'lava' ? !!env.LAVA_WEBHOOK_TOKEN : provider.configured(),
    'This webhook is not configured.',
    503,
    'provider_unavailable',
  );
  requireCondition(
    Number(request.headers.get('content-length') ?? 0) < 65536,
    'Webhook is too large.',
    413,
  );
  const reader = request.body?.getReader();
  requireCondition(reader, 'A webhook body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > 65536) {
      await reader.cancel();
      throw new HttpError(413, 'Webhook is too large.');
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const raw = new TextDecoder().decode(bytes);
  requireCondition(
    await provider.verify(raw, request.headers),
    'Invalid webhook signature.',
    401,
    'invalid_signature',
  );
  let data: Record<string, unknown>, event: PaymentEvent;
  try {
    data = JSON.parse(raw);
    event = await provider.parse(data);
  } catch {
    throw new HttpError(
      400,
      'Invalid or unsupported payment event.',
      'invalid_event',
    );
  }
  if (event.state === 'ignored') return { received: true, ignored: true };
  const db = await database(),
    now = Date.now(),
    rawHash = await sha256(raw);
  const previous = await first(
    db,
    'SELECT id FROM payment_webhook_events WHERE provider=? AND event_key=?',
    provider.name,
    event.eventKey,
  );
  if (previous) return { received: true, duplicate: true };
  let payment = await first<PaymentRow>(
    db,
    'SELECT * FROM payments WHERE provider=? AND external_payment_id=?',
    provider.name,
    event.externalPaymentId,
  );
  if (!payment && provider.name === 'lava')
    throw new HttpError(
      409,
      'Payment record is not available yet. Retry this notification.',
      'payment_not_found',
    );
  if (!payment) {
    const paymentId = id('payment-');
    await db
      .prepare(
        "INSERT OR IGNORE INTO payments (id,provider,external_payment_id,purpose,amount_cents,currency,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)",
      )
      .bind(
        paymentId,
        provider.name,
        event.externalPaymentId,
        event.purpose,
        event.amountCents,
        event.currency,
        now,
      )
      .run();
    payment = (await first<PaymentRow>(
      db,
      'SELECT * FROM payments WHERE provider=? AND external_payment_id=?',
      provider.name,
      event.externalPaymentId,
    ))!;
  }
  requireCondition(
    payment.amount_cents === event.amountCents &&
      payment.currency === event.currency,
    'Payment amount or currency does not match the invoice.',
    409,
    'payment_mismatch',
  );
  const webhookId = id('webhook-'),
    statements: D1PreparedStatement[] = [
      db
        .prepare(
          'INSERT OR IGNORE INTO payment_webhook_events (id,provider,event_key,raw_hash,status,created_at) VALUES (?,?,?,?,?,?)',
        )
        .bind(
          webhookId,
          provider.name,
          event.eventKey,
          rawHash,
          event.state,
          now,
        ),
    ];
  if (event.state === 'paid') {
    // Only an unprovisioned matching invoice may increase a campaign budget.
    // The transaction marker also prevents duplicate callbacks from provisioning twice.
    if (payment.campaign_id)
      statements.push(
        db
          .prepare(
            "UPDATE ad_campaigns SET paid_impressions=paid_impressions+?,payment_status='paid',status=CASE WHEN moderation_status='approved' AND status!='paused' THEN 'active' ELSE status END WHERE id=? AND EXISTS (SELECT 1 FROM payments WHERE id=? AND provisioned_at IS NULL AND status!='refunded') AND EXISTS (SELECT 1 FROM payment_webhook_events WHERE id=?)",
          )
          .bind(
            payment.impressions,
            payment.campaign_id,
            payment.id,
            webhookId,
          ),
      );
    if (payment.purpose === 'donation')
      statements.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO donations (id,payment_id,user_id,amount_cents,currency,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM payment_webhook_events WHERE id=?) AND EXISTS (SELECT 1 FROM payments WHERE id=? AND status!='refunded')",
          )
          .bind(
            id('donation-'),
            payment.id,
            payment.user_id,
            event.amountCents,
            event.currency,
            now,
            webhookId,
            payment.id,
          ),
      );
    statements.push(
      db
        .prepare(
          "UPDATE payments SET status='paid',paid_at=COALESCE(paid_at,?),provisioned_at=CASE WHEN purpose!='unmatched' THEN COALESCE(provisioned_at,?) ELSE provisioned_at END WHERE id=? AND status!='refunded' AND EXISTS (SELECT 1 FROM payment_webhook_events WHERE id=?)",
        )
        .bind(now, now, payment.id, webhookId),
    );
  } else if (event.state === 'failed') {
    statements.push(
      db
        .prepare(
          "UPDATE payments SET status='failed' WHERE id=? AND status NOT IN ('paid','refunded')",
        )
        .bind(payment.id),
    );
    if (payment.campaign_id)
      statements.push(
        db
          .prepare(
            "UPDATE ad_campaigns SET payment_status='unpaid' WHERE id=? AND payment_status NOT IN ('paid','refunded') AND EXISTS (SELECT 1 FROM payments WHERE id=? AND status='failed') AND NOT EXISTS (SELECT 1 FROM payments WHERE campaign_id=? AND status IN ('paid','pending','creating','uncertain'))",
          )
          .bind(payment.campaign_id, payment.id, payment.campaign_id),
      );
  } else {
    statements.push(
      db
        .prepare("UPDATE payments SET status='refunded' WHERE id=?")
        .bind(payment.id),
    );
    if (payment.campaign_id)
      statements.push(
        db
          .prepare(
            "UPDATE ad_campaigns SET status='paused',payment_status='refunded' WHERE id=?",
          )
          .bind(payment.campaign_id),
      );
  }
  await db.batch(statements);
  return { received: true };
}
export async function donationLink(provider: string) {
  requireCondition(
    env.BILLING_ENABLED === 'true',
    'Donations are not enabled yet.',
    503,
    'billing_disabled',
  );
  if (provider === 'tribute') {
    requireCondition(
      env.TRIBUTE_DONATION_URL,
      'Tribute donations are not configured.',
      503,
    );
    return {
      url: safeUrl(env.TRIBUTE_DONATION_URL, 'Tribute donation URL', [
        't.me',
        'tribute.tg',
        'web.tribute.tg',
      ]),
    };
  }
  requireCondition(
    provider === 'lava' && env.LAVA_API_KEY,
    'Lava donations are not configured.',
    503,
  );
  const response = await fetch('https://gate.lava.top/api/v1/donate', {
    headers: { 'X-Api-Key': env.LAVA_API_KEY },
    signal: AbortSignal.timeout(8000),
  });
  requireCondition(
    response.ok,
    'Donation provider is temporarily unavailable.',
    502,
  );
  const data = (await response.json()) as { url: string };
  return {
    url: safeUrl(data.url, 'Donation URL', ['app.lava.top', 'lava.top']),
  };
}
export async function billingHistory(user: PublicUser) {
  const db = await database();
  return {
    payments: await all(
      db,
      'SELECT id,provider,purpose,amount_cents,currency,status,created_at,paid_at,checkout_url FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
      user.id,
    ),
  };
}
