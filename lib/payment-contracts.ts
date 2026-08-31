export interface PaymentEvent {
  eventKey: string;
  externalPaymentId: string;
  state: 'paid' | 'failed' | 'refunded' | 'ignored';
  amountCents: number;
  currency: string;
  purpose: 'campaign' | 'donation' | 'unmatched';
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function normalizeLavaEvent(
  data: Record<string, unknown>,
): PaymentEvent {
  const type = typeof data.eventType === 'string' ? data.eventType : '',
    contract = typeof data.contractId === 'string' ? data.contractId : '',
    amount = Number(data.amount),
    currency =
      typeof data.currency === 'string' ? data.currency.toUpperCase() : '';
  if (
    !contract ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    !['USD', 'EUR', 'RUB'].includes(currency)
  )
    throw new Error('Invalid Lava payment event.');
  const state =
    type === 'payment.success' && data.status === 'completed'
      ? 'paid'
      : type === 'payment.failed'
        ? 'failed'
        : 'ignored';
  return {
    eventKey: `${contract}:${type}`,
    externalPaymentId: contract,
    state,
    amountCents: Math.round(amount * 100),
    currency,
    purpose: 'campaign',
  };
}
export async function normalizeTributeEvent(
  data: Record<string, unknown>,
): Promise<PaymentEvent> {
  const name = typeof data.name === 'string' ? data.name : '',
    payload = data.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== 'object' || !data.created_at)
    throw new Error('Invalid Tribute event.');
  const amount = Number(payload.amount),
    currency =
      typeof payload.currency === 'string'
        ? payload.currency.toUpperCase()
        : '';
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !['USD', 'EUR', 'RUB'].includes(currency)
  )
    throw new Error('Unsupported Tribute amount or currency.');
  const donation = ['new_donation', 'recurrent_donation'].includes(name),
    purchase = name === 'new_digital_product',
    refund = name === 'digital_product_refund';
  if (!donation && !purchase && !refund)
    return {
      eventKey: name,
      externalPaymentId: 'ignored',
      state: 'ignored',
      amountCents: amount,
      currency,
      purpose: 'unmatched',
    };
  const stable = canonicalJson({ name, created_at: data.created_at, payload });
  const hash = [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (donation && !payload.donation_request_id)
    throw new Error('Missing donation request ID.');
  const purchaseId =
    typeof payload.purchase_id === 'number' ? payload.purchase_id : NaN;
  if (
    (purchase || refund) &&
    (!Number.isSafeInteger(purchaseId) || purchaseId <= 0)
  )
    throw new Error('Missing purchase ID.');
  const external = donation ? `donation:${hash}` : `purchase:${purchaseId}`;
  return {
    eventKey: donation ? external : `${name}:${purchaseId}`,
    externalPaymentId: external,
    state: refund ? 'refunded' : 'paid',
    amountCents: amount,
    currency,
    purpose: donation ? 'donation' : 'unmatched',
  };
}
export async function verifyTributeSignature(
  raw: string,
  signature: string,
  key: string,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(signature) || !key) return false;
  const secret = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signatureBytes = Uint8Array.from(
    signature.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
  );
  return crypto.subtle.verify(
    'HMAC',
    secret,
    signatureBytes,
    new TextEncoder().encode(raw),
  );
}
