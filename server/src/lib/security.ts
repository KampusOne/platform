import { jwtVerify, SignJWT } from "jose";

import type { AuthenticatedUser, Bindings } from "../types";
import { AppError } from "./errors";

const encoder = new TextEncoder();
const ACCESS_TOKEN_SECONDS = 15 * 60;
const PBKDF2_ITERATIONS = 310_000;
const PBKDF2_HASH_BYTES = 32;
const PASSWORD_HASH_PREFIX = "$pbkdf2-sha256$";
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;

function signingKey(env: Bindings) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "Secure session signing is not configured.");
  }
  return encoder.encode(env.JWT_SECRET);
}

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function constantTimeBytesEqual(expected: Uint8Array, supplied: Uint8Array): boolean {
  if (expected.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index]! ^ supplied[index]!;
  return difference === 0;
}

async function derivePbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations },
    passwordKey,
    PBKDF2_HASH_BYTES * 8,
  );
  return new Uint8Array(derived);
}

export async function hashPassword(password: string): Promise<string> {
  // Cloudflare Workers supports PBKDF2 through Web Crypto natively. Keeping the
  // password KDF inside crypto.subtle avoids runtime WASM compilation, which
  // Cloudflare blocks for packages such as hash-wasm.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `${PASSWORD_HASH_PREFIX}${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    if (hash.startsWith(PASSWORD_HASH_PREFIX)) {
      const parts = hash.split("$");
      if (parts.length !== 5 || parts[1] !== "pbkdf2-sha256") return false;
      const iterations = Number.parseInt(parts[2] ?? "", 10);
      if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;
      const salt = fromBase64Url(parts[3] ?? "");
      const expected = fromBase64Url(parts[4] ?? "");
      if (salt.length < 16 || expected.length !== PBKDF2_HASH_BYTES) return false;
      const supplied = await derivePbkdf2(password, salt, iterations);
      return constantTimeBytesEqual(expected, supplied);
    }

    // Legacy accounts may still contain Argon2id hashes created before the
    // Cloudflare migration. Attempt verification lazily so hash-wasm is never
    // loaded on registration or for newly-created PBKDF2 accounts. If the
    // runtime cannot execute the legacy WASM verifier, fail authentication
    // closed instead of crashing the Worker.
    if (hash.startsWith("$argon2")) {
      const { argon2Verify } = await import("hash-wasm");
      return await argon2Verify({ password, hash });
    }

    return false;
  } catch {
    return false;
  }
}

export function generateOtp(): string {
  const range = 900_000;
  const ceiling = Math.floor(0x1_0000_0000 / range) * range;
  let random = ceiling;
  while (random >= ceiling) random = crypto.getRandomValues(new Uint32Array(1))[0] ?? ceiling;
  return String(100_000 + (random % range));
}

export function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashOtp(env: Bindings, code: string): Promise<string> {
  if (!env.OTP_PEPPER || env.OTP_PEPPER.length < 24) {
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "Email verification is not configured.");
  }
  return sha256(`${env.OTP_PEPPER}:${code}`);
}

export async function deriveHandoffCode(
  env: Bindings,
  orderId: string,
  kind: "pickup" | "delivery",
) {
  if (!env.OTP_PEPPER || env.OTP_PEPPER.length < 24) {
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "Secure handoff codes are not configured.");
  }
  const entropy = await sha256(`${env.OTP_PEPPER}:handoff:${kind}:${orderId}`);
  const code = String(Number.parseInt(entropy.slice(0, 12), 16) % 1_000_000).padStart(6, "0");
  return { code, hash: await hashOtp(env, code) };
}

export function equalHash(expected: string, supplied: string) {
  if (expected.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

export async function issueAccessToken(env: Bindings, user: AuthenticatedUser): Promise<string> {
  return new SignJWT({
    email: user.email,
    roles: user.roles,
    universityId: user.universityId,
    operatorRoles: user.operatorRoles,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setAudience("kampusone-clients")
    .setIssuer("kampusone-api")
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
    .sign(signingKey(env));
}

export async function verifyAccessToken(env: Bindings, token: string): Promise<AuthenticatedUser> {
  try {
    const { payload } = await jwtVerify(token, signingKey(env), {
      audience: "kampusone-clients",
      issuer: "kampusone-api",
    });
    if (!payload.sub || typeof payload.email !== "string") throw new Error("Invalid claims");

    return {
      id: payload.sub,
      email: payload.email,
      roles: Array.isArray(payload.roles) ? payload.roles.filter((role): role is string => typeof role === "string") : [],
      universityId: typeof payload.universityId === "string" ? payload.universityId : null,
      operatorRoles: Array.isArray(payload.operatorRoles)
        ? payload.operatorRoles.filter((role): role is string => typeof role === "string")
        : [],
    };
  } catch {
    throw new AppError(401, "UNAUTHENTICATED", "Your session is invalid or has expired.");
  }
}

export function validatePassword(password: string) {
  if (password.length < 10 || password.length > 128) {
    throw new AppError(400, "BAD_REQUEST", "Use a password between 10 and 128 characters.");
  }
  const common = new Set(["password123", "1234567890", "qwerty12345", "kampusone"]);
  if (common.has(password.toLowerCase())) {
    throw new AppError(400, "BAD_REQUEST", "Choose a less common password.");
  }
}
