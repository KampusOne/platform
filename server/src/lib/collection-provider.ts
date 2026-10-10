import { sql } from 'drizzle-orm';
import type { Bindings } from '../types';
import { database, firstRow } from './database';
import { AppError } from './errors';
import { initializePaystack, verifyPaystack } from './paystack';
import { getBachsCheckoutSettings } from './bachs';
import { fingerprintBachsPurchase, initializeBachsPricedCheckout, saveBachsPricingQuote, verifyBachsPricedCheckout, type BachsPurchaseSnapshot } from './bachs-pricing-store';

export function bachsCollectionsEnabled(env: Bindings) { return env.BACHS_PRICED_CHECKOUT_ENABLED === 'true'; }
export function collectionConfigured(env: Bindings) {
  const key = bachsCollectionsEnabled(env) ? env.BACHS_API_KEY : env.PAYSTACK_SECRET_KEY;
  return Boolean(key && (env.ENVIRONMENT !== 'production' || key.startsWith('sk_live_')) && (!bachsCollectionsEnabled(env) || env.BACHS_WEBHOOK_SECRET));
}
export function collectionReference(env: Bindings, kind: 'AI' | 'O' | 'T' | 'M' | 'RC') {
  return `K1-${bachsCollectionsEnabled(env) && kind === 'AI' ? 'B-' : ''}${kind}-${crypto.randomUUID()}`;
}
export function isBachsReference(reference: string) { return /^K1-B-(?:AI|O|T|M|RC)-/.test(reference); }

type Intent = { userId: string; universityId: string; resourceType: 'STORE_ORDER' | 'TUTORIAL_BOOKING' | 'TUTORIAL_PURCHASE' | 'KIRA_SUBSCRIPTION' | 'RIDER_COMMISSION'; resourceId: string; amountKobo: number; snapshot: BachsPurchaseSnapshot; expiresAt: string };
/** The database binds provider, buyer, campus and price before the durable POST claim. */
export async function initializeCollection(env: Bindings, input: Parameters<typeof initializePaystack>[1]) {
  if (!isBachsReference(input.reference)) return initializePaystack(env, input);
  if (!bachsCollectionsEnabled(env) || env.PAYMENTS_ENABLED !== 'true' || !collectionConfigured(env))
    throw new AppError(503, 'FEATURE_DISABLED', 'Payments are temporarily unavailable. Your purchase is saved.');
  const intent = firstRow(await database(env).execute<Intent>(sql`select * from app_private.bachs_purchase_intent(${input.reference})`));
  if (!intent || intent.userId !== input.metadata.userId || intent.resourceId !== input.metadata.resourceId || intent.resourceType !== input.metadata.resourceType || Number(intent.amountKobo) !== input.amountKobo)
    throw new AppError(409, 'CONFLICT', 'This checkout does not match its saved purchase. Review it again.');
  if (!Number.isFinite(Date.parse(intent.expiresAt)) || Date.parse(intent.expiresAt) <= Date.now() + 60_000) throw new AppError(409, 'CONFLICT', 'This purchase quote is about to expire. Review a new quote.');
  const settings = await getBachsCheckoutSettings(env);
  if (!settings.bankTransferEnabled || settings.feePreference !== 'org_pays')
    throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Checkout cannot confirm the displayed total. Your purchase remains saved.');
  const resourceFingerprint = await fingerprintBachsPurchase(intent.snapshot);
  const quote = await saveBachsPricingQuote(env, {
    ...intent, reference: input.reference, resourceSnapshot: intent.snapshot, resourceFingerprint,
    context: 'CHECKOUT_BANK_TRANSFER', pricing: { subtotalKobo: input.amountKobo, priceMode: 'FIXED_TOTAL', expiresInMinutes: Math.min(15, Math.floor((Date.parse(intent.expiresAt) - Date.now()) / 60000)) },
  });
  const session = await initializeBachsPricedCheckout({ ...env, BACHS_MERCHANT_BEARS_COST_CONFIRMED: 'true' }, {
    quoteId: quote.quoteId, userId: intent.userId, universityId: intent.universityId,
    resourceFingerprint, acceptedTotalKobo: input.amountKobo, email: input.email,
    ...(input.callbackUrl ? { successUrl: input.callbackUrl + '?reference=' + encodeURIComponent(input.reference) } : {}),
  });
  return { authorization_url: session.checkoutUrl, access_code: session.checkoutId, reference: input.reference };
}

/** Historical Paystack references remain pinned to Paystack after a BACHS cutover. */
export async function verifyCollection(env: Bindings, reference: string): Promise<Awaited<ReturnType<typeof verifyPaystack>>> {
  if (!isBachsReference(reference)) return verifyPaystack(env, reference);
  const saved = firstRow(await database(env).execute<{ id: string; userId: string; universityId: string }>(sql`select id,user_id as "userId",university_id as "universityId" from app_private.bachs_checkout_quotes where provider_reference=${reference}`));
  if (!saved) throw new AppError(404, 'NOT_FOUND', 'That payment has no saved BACHS checkout.');
  const result = await verifyBachsPricedCheckout(env, saved.id, saved.userId, saved.universityId);
  if (result.status !== 'verified' || !('receipt' in result)) return { status: 'pending', reference, amountKobo: 0, feeKobo: 0, paidAt: null, providerTransactionId: null, channel: null, paymentCountry: null, cardNetwork: null, transactionClass: 'LOCAL_COLLECTION' };
  const receipt = result.receipt as { amount_kobo: number; actual_fee_kobo: number; paid_at: string; payment_id: string };
  return { status: 'success', reference, amountKobo: Number(receipt.amount_kobo), feeKobo: Number(receipt.actual_fee_kobo), paidAt: receipt.paid_at, providerTransactionId: receipt.payment_id, channel: 'bank_transfer', paymentCountry: 'NG', cardNetwork: null, transactionClass: 'LOCAL_COLLECTION' };
}
