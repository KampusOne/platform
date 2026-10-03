import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import type { Bindings } from "../types";
import { z } from "@kampusone/contracts";

export const agentOperationsSchema = z.object({
  primaryOffer: z.string().trim().min(2).max(200),
  joiningReason: z.enum(["Reach more students", "Grow my existing business", "Offer affordable campus services", "Build my teaching experience", "Earn from campus deliveries"]),
  serviceDays: z.array(z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])).min(1).max(7).refine(value => new Set(value).size === value.length),
  openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  fulfilmentMethods: z.array(z.enum(["Store pickup", "Campus delivery", "Meet at an agreed location", "Online service"])).min(1).max(4).refine(value => new Set(value).size === value.length),
  supportChannel: z.enum(["KampusOne chat", "WhatsApp", "Phone call"]),
  responseTime: z.enum(["Within 15 minutes", "Within 1 hour", "Within 3 hours", "Within 24 hours"]),
}).strict().refine(value => value.openingTime !== value.closingTime, { message: "Choose different opening and closing times.", path: ["closingTime"] });

export const agentOperationsDraftSchema = z.object({
  primaryOffer: z.string().max(200), joiningReason: z.string().max(80),
  serviceDays: z.array(z.string().max(20)).max(7), openingTime: z.string().max(5), closingTime: z.string().max(5),
  fulfilmentMethods: z.array(z.string().max(80)).max(4), supportChannel: z.string().max(30), responseTime: z.string().max(30),
}).strict();
export type IdentityEnvelope = {
  version: "v1";
  nonce: string;
  ciphertext: string;
  requestId: string;
  universityId: string;
};
export function identityEncryptionConfigured(env: Bindings) {
  return (
    /^[0-9a-fA-F]{64}$/.test(env.KYC_ENCRYPTION_KEY ?? "") &&
    (env.KYC_FINGERPRINT_SECRET?.length ?? 0) >= 32
  );
}
export async function agentIntakeReady(env: Bindings) {
  const row = firstRow(
    await database(env).execute<{ ready: boolean }>(
      sql`select to_regclass('app_private.agent_identity_submissions') is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_application_drafts' and column_name='identity_envelope') as ready`,
    ),
  );
  return row?.ready === true;
}
async function key(env: Bindings) {
  if (!identityEncryptionConfigured(env))
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Private identity submission is being connected. Save your other details and return shortly.",
    );
  const bytes = Uint8Array.from(env.KYC_ENCRYPTION_KEY!.match(/../g)!, (s) =>
    parseInt(s, 16),
  );
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const aad = (owner: string, university: string, requestId: string) =>
  new TextEncoder().encode(
    `K1:AGENT:NIN:v1:${owner}:${university}:${requestId}`,
  );
export async function encryptAgentNin(
  env: Bindings,
  nin: string,
  owner: string,
  university: string,
  requestId: string,
): Promise<IdentityEnvelope> {
  if (!/^\d{11}$/.test(nin))
    throw new AppError(400, "BAD_REQUEST", "Enter an eleven-digit NIN.");
  const nonce = crypto.getRandomValues(new Uint8Array(12)),
    secret = await key(env);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aad(owner, university, requestId),
    },
    secret,
    new TextEncoder().encode(nin),
  );
  return {
    version: "v1",
    nonce: encode(nonce),
    ciphertext: encode(new Uint8Array(encrypted)),
    requestId,
    universityId: university,
  };
}
export async function decryptAgentNin(
  env: Bindings,
  envelope: IdentityEnvelope,
  owner: string,
) {
  if (
    envelope.version !== "v1" ||
    !/^[A-Za-z0-9+/]{16}$/.test(envelope.nonce) ||
    !/^[A-Za-z0-9+/]{36}$/.test(envelope.ciphertext)
  )
    throw new AppError(
      409,
      "CONFLICT",
      "This private identity record needs review.",
    );
  try {
    const value = new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decode(envelope.nonce),
          additionalData: aad(owner, envelope.universityId, envelope.requestId),
        },
        await key(env),
        decode(envelope.ciphertext),
      ),
    );
    if (!/^\d{11}$/.test(value)) throw new Error("Invalid identity length");
    return value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      409,
      "CONFLICT",
      "The private identity record could not be opened. Re-enter your NIN or contact an authorized reviewer.",
    );
  }
}
