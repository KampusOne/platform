import type { Bindings } from "../types";
import { AppError } from "./errors";

/** HMAC, not a reversible identifier or an unsalted hash of an eleven-digit NIN. */
export async function identityFingerprint(env: Bindings, nin: string) {
  if (!env.KYC_FINGERPRINT_SECRET || env.KYC_FINGERPRINT_SECRET.length < 32)
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Identity deduplication is not configured.",
    );
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.KYC_FINGERPRINT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode("NG:NIN:" + nin),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
