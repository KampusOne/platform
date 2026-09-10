import { argon2id, argon2Verify } from "hash-wasm";
import { jwtVerify, SignJWT } from "jose";

import type { AuthenticatedUser, Bindings } from "../types";
import { AppError } from "./errors";

const encoder = new TextEncoder();
const ACCESS_TOKEN_SECONDS = 15 * 60;
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;

function signingKey(env: Bindings) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "Secure session signing is not configured.");
  }
  return encoder.encode(env.JWT_SECRET);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return argon2id({
    password,
    salt,
    iterations: 2,
    parallelism: 1,
    memorySize: 19 * 1024,
    hashLength: 32,
    outputType: "encoded",
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
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
