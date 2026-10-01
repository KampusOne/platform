import { afterEach, describe, it, expect, vi } from "vitest";
import { generateKeyPair, exportPKCS8, jwtVerify } from "jose";
import { googleAnalyticsReport } from "../src/lib/google-analytics-reporting";
import type { Bindings } from "../src/types";
const base = {
  GA4_REPORTING_ENABLED: "true",
  GA4_PROPERTY_ID: "123456789",
} as Bindings;
afterEach(() => vi.unstubAllGlobals());
describe("server GA4 reporting adapter", () => {
  it("keeps thresholded missing totals unreported instead of treating them as zero", async () => {
    const { privateKey } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const env = {
      ...base,
      GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "analytics@kampus-test.iam.gserviceaccount.com",
        private_key: await exportPKCS8(privateKey),
      }),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.includes("oauth2"))
          return Response.json({
            access_token: "synthetic-threshold-report-token",
            token_type: "Bearer",
            expires_in: 3600,
          });
        const body = JSON.parse(String(init.body));
        return Response.json({
          dimensionHeaders: body.dimensions,
          metricHeaders: body.metrics,
          rows: [],
          rowCount: 0,
          metadata: { timeZone: "Africa/Lagos", subjectToThresholding: true },
        });
      }),
    );
    const report = await googleAnalyticsReport(env, 7);
    expect(report.state).toBe("ready");
    if (report.state !== "ready") throw new Error("No report");
    expect(report.totals).toEqual({});
    expect(report.thresholded).toBe(true);
    expect(report.daily).toEqual([]);
  });
  it("does not contact providers when paused or incompletely configured", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await googleAnalyticsReport(
          { ...base, GA4_REPORTING_ENABLED: "false" },
          7,
        )
      ).state,
    ).toBe("paused");
    expect(
      (await googleAnalyticsReport({ ...base, GA4_PROPERTY_ID: "../other" }, 7))
        .state,
    ).toBe("setup_required");
    expect((await googleAnalyticsReport({ ...base }, 7)).state).toBe(
      "setup_required",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("signs a read-only service-account assertion, parses exact provider measurements and caches reports", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256", {
        extractable: true,
      }),
      key = await exportPKCS8(privateKey),
      email = "analytics@kampus-test.iam.gserviceaccount.com",
      env = {
        ...base,
        GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({
          client_email: email,
          private_key: key,
        }),
      };
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeDefined();
      if (url === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(String(init.body)),
          assertion = body.get("assertion")!;
        expect(body.get("grant_type")).toBe(
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        );
        const decoded = await jwtVerify(assertion, publicKey, {
          issuer: email,
          audience: url,
        });
        expect(decoded.payload.scope).toBe(
          "https://www.googleapis.com/auth/analytics.readonly",
        );
        expect(decoded.payload.sub).toBeUndefined();
        return Response.json({
          access_token: "test-only-provider-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      expect(url).toBe(
        "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport",
      );
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer test-only-provider-token",
      );
      const body = JSON.parse(String(init.body));
      expect(body.dateRanges).toEqual([
        { startDate: "6daysAgo", endDate: "today" },
      ]);
      expect(body.limit).toBe("1000");
      return Response.json({
        dimensionHeaders: body.dimensions,
        metricHeaders: body.metrics,
        rows: [
          {
            ...(body.dimensions.length
              ? {
                  dimensionValues: body.dimensions.map(
                    (d: { name: string }) => ({
                      value: d.name === "date" ? "20261001" : "Android",
                    }),
                  ),
                }
              : {}),
            metricValues: body.metrics.map(() => ({ value: "12" })),
          },
        ],
        rowCount: 1,
        metadata: { timeZone: "Africa/Lagos" },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const [first, second] = await Promise.all([
      googleAnalyticsReport(env, 7),
      googleAnalyticsReport(env, 7),
    ]);
    expect(first.state).toBe("ready");
    expect(second.state).toBe("ready");
    if (first.state !== "ready") throw new Error("No report");
    expect(first.totals.activeUsers).toBe(12);
    expect(first.platforms[0].platform).toBe("Android");
    expect(first.timeZone).toBe("Africa/Lagos");
    expect(JSON.stringify(first)).not.toContain(key);
    expect(JSON.stringify(first)).not.toContain("test-only-provider-token");
    expect(
      fetch.mock.calls.filter(
        ([url]) => url === "https://oauth2.googleapis.com/token",
      ),
    ).toHaveLength(1);
    const count = fetch.mock.calls.length;
    expect(await googleAnalyticsReport(env, 7)).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(count);
  });
  it("uses registered custom dimensions only when explicitly enabled and rejects malformed measurements", async () => {
    const { privateKey } = await generateKeyPair("RS256", {
        extractable: true,
      }),
      env = {
        ...base,
        GA4_CUSTOM_DIMENSIONS_READY: "true",
        GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({
          client_email: "analytics@kampus-test.iam.gserviceaccount.com",
          private_key: await exportPKCS8(privateKey),
        }),
      };
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.includes("oauth2"))
          return Response.json({
            access_token: "test-only-valid-provider-token",
            token_type: "Bearer",
            expires_in: 3600,
          });
        const body = JSON.parse(String(init.body));
        requests.push(body);
        return Response.json({
          dimensionHeaders: body.dimensions,
          metricHeaders: body.metrics,
          rows: [
            {
              dimensionValues: body.dimensions.map(() => ({ value: "web" })),
              metricValues: body.metrics.map(() => ({ value: "NaN" })),
            },
          ],
        });
      }),
    );
    const r = await googleAnalyticsReport(env, 30);
    expect(r.state).toBe("unavailable");
    expect(JSON.stringify(requests)).toContain("customEvent:app_platform");
    expect(JSON.stringify(requests)).toContain("customEvent:screen");
    expect(JSON.stringify(requests)).toContain("customEvent:action");
    expect(JSON.stringify(r)).not.toContain("PRIVATE KEY");
  });
  it("returns a sanitized state for access rejection, without fabricating activity", async () => {
    const { privateKey } = await generateKeyPair("RS256", {
        extractable: true,
      }),
      env = {
        ...base,
        GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({
          client_email: "analytics@kampus-test.iam.gserviceaccount.com",
          private_key: await exportPKCS8(privateKey),
        }),
      };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("sensitive provider error trace", { status: 403 }),
      ),
    );
    const r = await googleAnalyticsReport(env, 90);
    expect(r.state).toBe("unavailable");
    expect(JSON.stringify(r)).not.toContain("sensitive provider error trace");
    expect(r).not.toHaveProperty("totals");
  });
});
