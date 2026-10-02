import { createSHA256, pbkdf2 } from "hash-wasm";
import { describe, expect, it } from "vitest";

import type { Bindings } from "../types";
import { deriveHandoffCode, equalHash, hashOtp, hashPassword, verifyPassword } from "./security";

const env = {
  OTP_PEPPER: "test-only-pepper-with-at-least-24-characters",
} as Bindings;

describe("password security", () => {
  it("creates a Cloudflare-compatible PBKDF2 hash that verifies", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const iterations = Number.parseInt(hash.split("$")[2] ?? "", 10);

    expect(hash).toMatch(/^\$pbkdf2-sha256\$100000\$/);
    expect(iterations).toBeLessThanOrEqual(100_000);
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("verifies pre-migration PBKDF2 hashes above the Workers WebCrypto ceiling", async () => {
    const password = "legacy account password";
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    const iterations = 120_000;
    const derived = await pbkdf2({
      password,
      salt,
      iterations,
      hashLength: 32,
      hashFunction: createSHA256(),
      outputType: "binary",
    });
    const encode = (value: Uint8Array) =>
      btoa(String.fromCharCode(...value))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
    const hash = `$pbkdf2-sha256${iterations}${encode(salt)}${encode(derived)}`;

    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong legacy password", hash)).resolves.toBe(false);
  });
});

describe("one-time code security", () => {
  it("rejects a different verification code hash", async () => {
    const expected = await hashOtp(env, "194620");
    const supplied = await hashOtp(env, "000000");

    expect(equalHash(expected, supplied)).toBe(false);
  });

  it("derives separate pickup and delivery codes", async () => {
    const pickup = await deriveHandoffCode(env, "a7cddf4d-077b-4c29-88e1-b3ca731c9c4e", "pickup");
    const delivery = await deriveHandoffCode(env, "a7cddf4d-077b-4c29-88e1-b3ca731c9c4e", "delivery");

    expect(pickup.code).toMatch(/^\d{6}$/);
    expect(delivery.code).toMatch(/^\d{6}$/);
    expect(pickup.code).not.toBe(delivery.code);
    expect(equalHash(pickup.hash, await hashOtp(env, pickup.code))).toBe(true);
  });

  it("fails closed when the OTP pepper is absent", async () => {
    await expect(hashOtp({} as Bindings, "194620")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });
});