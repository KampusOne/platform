import { describe, expect, it } from "vitest";
import {
  ageOn,
  allowedAgentAge,
  commissionFor,
  MINIMUM_WITHDRAWAL_KOBO,
} from "../src/lib/platform-policy";
import { detectedMime } from "../src/routes/media";
describe("launch policies", () => {
  it.each([
    [0, 200, 0],
    [250000, 200, 5000],
    [250001, 300, 7500],
    [500000, 300, 15000],
    [500001, 500, 25000],
  ])("snapshots commission for %i kobo", (gross, rate, fee) => {
    const result = commissionFor(gross);
    expect(result.basisPoints).toBe(rate);
    expect(result.commissionKobo).toBe(fee);
    expect(result.netKobo + result.commissionKobo).toBe(gross);
  });
  it("uses integer arithmetic even at the safe integer bound", () => {
    const r = commissionFor(Number.MAX_SAFE_INTEGER);
    expect(r.netKobo + r.commissionKobo).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each([-1, 0.01, NaN, Infinity])("rejects invalid money %s", (value) =>
    expect(() => commissionFor(value)).toThrow(),
  );
  it("requires a 5000 naira minimum withdrawal", () =>
    expect(MINIMUM_WITHDRAWAL_KOBO).toBe(500000));
  it("turns 16 at midnight in Lagos, not UTC", () => {
    expect(
      allowedAgentAge("2010-09-14", new Date("2026-09-13T22:59:59Z")),
    ).toBe(false);
    expect(
      allowedAgentAge("2010-09-14", new Date("2026-09-13T23:00:00Z")),
    ).toBe(true);
  });
  it("rejects impossible and future dates", () => {
    expect(ageOn("2010-02-31")).toBe(-1);
    expect(allowedAgentAge("2999-01-01")).toBe(false);
  });
  it("does not trust an SVG or an extension to identify a safe upload", () => {
    expect(
      detectedMime(new TextEncoder().encode('<svg onload="alert(1)"/>')),
    ).toBeNull();
    expect(detectedMime(new TextEncoder().encode("%PDF-1.7"))).toBe(
      "application/pdf",
    );
    expect(detectedMime(new Uint8Array([255, 216, 255, 0]))).toBe("image/jpeg");
  });
});
