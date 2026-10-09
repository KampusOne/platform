import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../types";

const { execute, providerInitialize } = vi.hoisted(() => ({
  execute: vi.fn(),
  providerInitialize: vi.fn(),
}));
vi.mock("./database", () => ({
  database: () => ({ execute }),
  firstRow: (result: { rows: unknown[] }) => result.rows[0],
}));
vi.mock("./paystack", () => ({ initializePaystack: providerInitialize }));

import { initializePaystackOnce } from "./payment-idempotency";

const env = {} as Bindings;
const input = {
  email: "synthetic@example.invalid",
  amountKobo: 600000,
  reference: "K1-O-test-once",
  metadata: {},
};
const session = {
  reference: input.reference,
  authorization_url: "https://checkout.paystack.com/synthetic-test",
  access_code: "test-access",
};

beforeEach(() => {
  execute.mockReset();
  providerInitialize.mockReset();
});

describe("outgoing Paystack idempotency boundary", () => {
  it("persists a unique claim before contacting Paystack and saves the result", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ claim_state: "CLAIMED" }] })
      .mockResolvedValueOnce({ rows: [{ saved: true }] });
    providerInitialize.mockResolvedValue(session);

    expect(await initializePaystackOnce(env,input)).toMatchObject(session);
    expect(providerInitialize).toHaveBeenCalledTimes(1);
    expect(providerInitialize).toHaveBeenCalledWith(env,input);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("reuses the original checkout URL without a second provider request", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      claim_state: "READY",
      authorization_url: session.authorization_url,
      access_code: session.access_code,
    }] });
    expect(await initializePaystackOnce(env,input)).toMatchObject({ ...session,reused: true });
    expect(providerInitialize).not.toHaveBeenCalled();
  });

  it("rejects concurrent initiation without contacting Paystack", async () => {
    execute.mockResolvedValueOnce({ rows: [{ claim_state: "IN_PROGRESS" }] });
    await expect(initializePaystackOnce(env,input)).rejects.toMatchObject({
      status:409, code:"CONFLICT",
      details:{ reference:input.reference,reason:"CHECKOUT_IN_PROGRESS" },
    });
    expect(providerInitialize).not.toHaveBeenCalled();
  });

  it("keeps timed-out external initialization uncertain and requires status reconciliation", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ claim_state: "CLAIMED" }] })
      .mockResolvedValueOnce({ rows: [{ saved: true }] });
    providerInitialize.mockRejectedValue(new Error("synthetic provider timeout"));
    await expect(initializePaystackOnce(env,input)).rejects.toThrow("synthetic provider timeout");
    expect(providerInitialize).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
