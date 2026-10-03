import type { Bindings } from "../types";
import { AppError } from "./errors";
import { prepareCollectionInitialization, recordCollectionReceiptContext, recordPaymentPricingAlert, classifyPaystackContext } from "./payment-pricing";

type InitializeInput = {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl?: string;
  metadata: Record<string, unknown>;
};

export async function initializePaystack(
  env: Bindings,
  input: InitializeInput,
) {
  if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo <= 0) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "A positive whole-kobo payment amount is required.",
    );
  }
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Secure payments are not configured yet.",
    );
  }
  if (
    env.ENVIRONMENT === "production" &&
    !env.PAYSTACK_SECRET_KEY.startsWith("sk_live_")
  )
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Live payment configuration is not ready. Your purchase remains unpaid.",
    );
  const pricingSnapshot=await prepareCollectionInitialization(env,input.reference,input.amountKobo,input.metadata);
  let response: Response;
  try {
    response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        amount: input.amountKobo,
        reference: input.reference,
        currency: "NGN",
        // This assigns settlement fees to the main account for a split. It is
        // NOT an override of the dashboard's Pass fees to customers setting.
        // The separately reviewed account setting must be disabled first.
        bearer: "account",
        metadata: {...input.metadata,paymentReference:input.reference,...(pricingSnapshot?{pricingSnapshotReference:pricingSnapshot.provider_reference,providerFeeProfileId:pricingSnapshot.fee_profile_id,providerFeeProfileVersion:pricingSnapshot.fee_profile_version}:{})},
        ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Checkout could not connect. Your purchase is saved; check its status before retrying.",
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    status?: boolean;
    message?: string;
    data?: {
      authorization_url?: string;
      access_code?: string;
      reference?: string;
    };
  } | null;
  if (
    !response.ok ||
    !payload?.status ||
    !payload.data?.authorization_url ||
    payload.data.reference !== input.reference
  ) {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      payload?.message ?? "The payment provider is unavailable.",
    );
  }
  try {
    if (new URL(payload.data.authorization_url).protocol !== "https:")
      throw new Error();
  } catch {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The payment provider returned an invalid checkout link. Your purchase remains unpaid.",
    );
  }
  return payload.data;
}

export async function verifyPaystack(env: Bindings, reference: string) {
  if (!env.PAYSTACK_SECRET_KEY)
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Secure payments are not configured yet.",
    );
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(reference))
    throw new AppError(
      400,
      "BAD_REQUEST",
      "That payment reference is invalid.",
    );
  let response:Response;
  try { response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
      signal: AbortSignal.timeout(10000),
    },
  ); }catch {throw new AppError(503,"PROVIDER_UNAVAILABLE","The payment receipt could not be fetched. Its saved reference remains available for reconciliation.");}
  const payload = (await response.json().catch(() => null)) as {
    status?: boolean;
    data?: {
      id?: number|string;
      status?: string;
      reference?: string;
      currency?: string;
      amount?: number;
      fees?: number;
      paid_at?: string;
      domain?: string;
      channel?:string;
      authorization?:{country?:string;brand?:string;card_type?:string};
    };
  } | null;
  const data = payload?.data;
  if (data && (data.reference!==reference || data.currency!=="NGN"))
    await recordPaymentPricingAlert(env,reference,data.reference!==reference?"PAYMENT_REFERENCE_MISMATCH":"PAYMENT_CURRENCY_MISMATCH",{expectedReference:reference,actualReference:data.reference??null,actualCurrency:data.currency??null});
  if (
    !response.ok ||
    payload?.status !== true ||
    !data ||
    data.reference !== reference ||
    data.currency !== "NGN" ||
    !Number.isSafeInteger(data.amount) ||
    Number(data.amount) <= 0 ||
    (env.ENVIRONMENT === "production" && data.domain !== "live")
  )
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The payment receipt could not be verified. Your balance has not changed.",
    );
  if (
    data.status === "success" &&
    (!Number.isSafeInteger(data.fees) ||
      Number(data.fees) < 0 ||
      typeof data.paid_at !== "string" ||
      !Number.isFinite(Date.parse(data.paid_at)))
  )
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The payment receipt is incomplete. It will be reconciled before funds are released.",
    );
  const providerTransactionId=typeof data.id==="string"&&/^[1-9][0-9]*$/.test(data.id)?data.id:
    typeof data.id==="number"&&Number.isSafeInteger(data.id)&&data.id>0?String(data.id):null;
  if(data.id!==undefined&&providerTransactionId===null)throw new AppError(503,"PROVIDER_UNAVAILABLE","The provider returned an invalid transaction identifier.");
  const channel=typeof data.channel==="string"?data.channel:null,
    paymentCountry=typeof data.authorization?.country==="string"?data.authorization.country.toUpperCase():null,
    cardNetwork=typeof data.authorization?.brand==="string"?data.authorization.brand.toUpperCase():typeof data.authorization?.card_type==="string"?data.authorization.card_type.toUpperCase():null;
  if(data.status==="success")await recordCollectionReceiptContext(env,{reference,amountKobo:Number(data.amount),feeKobo:Number(data.fees),providerTransactionId,channel,paymentCountry,cardNetwork,currency:data.currency!,providerMode:data.domain==="live"?"live":"test",paidAt:data.paid_at??null});
  return {
    status: data.status ?? "pending",
    reference,
    amountKobo: Number(data.amount),
    feeKobo: Number(data.fees ?? 0),
    paidAt: data.paid_at ?? null,
    providerTransactionId,
    channel,
    paymentCountry,
    cardNetwork,
    transactionClass:classifyPaystackContext(channel,paymentCountry,cardNetwork),
  };
}

export async function validPaystackSignature(
  env: Bindings,
  rawBody: string,
  supplied?: string,
) {
  // Paystack signs events with the merchant secret key, not a separate webhook token.
  const secret = env.PAYSTACK_SECRET_KEY ?? env.PAYSTACK_WEBHOOK_SECRET;
  if (!secret || !supplied) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const expected = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (expected.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}
