import { importPKCS8, SignJWT } from "jose";
import type { Bindings } from "../types";
type Row = Record<string, string | number>;
type Table = {
  rows: Row[];
  limited: boolean;
  timeZone: string | null;
  thresholded: boolean;
};
export type GoogleAnalyticsReport =
  | {
      state: "ready";
      generatedAt: string;
      days: number;
      platformDimension: string;
      totals: Row;
      daily: Row[];
      platforms: Row[];
      screens: Row[];
      events: Row[];
      timeZone: string | null;
      limited: boolean;
      thresholded: boolean;
    }
  | { state: "paused" | "setup_required" | "unavailable"; message: string };
const tokens = new WeakMap<
  object,
  { config: string; value: string; until: number }
>();
const tokenRequests = new WeakMap<
  object,
  { config: string; pending: Promise<string> }
>();
const reports = new WeakMap<
  object,
  { config: string; days: number; until: number; value: GoogleAnalyticsReport }
>();
const reportRequests = new WeakMap<
  object,
  { config: string; days: number; pending: Promise<GoogleAnalyticsReport> }
>();
class ReportError extends Error {}
function credentials(env: Bindings) {
  const raw = env.GA4_SERVICE_ACCOUNT_JSON;
  if (!raw || raw.length > 20000)
    throw new ReportError(
      "Add the server reporting credential and grant its service account read access to this GA4 property.",
    );
  let value: { client_email?: unknown; private_key?: unknown };
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ReportError(
      "The server reporting credential needs a valid service-account JSON configuration.",
    );
  }
  if (
    typeof value.client_email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(value.client_email) ||
    typeof value.private_key !== "string" ||
    !value.private_key.startsWith("-----BEGIN PRIVATE KEY-----")
  )
    throw new ReportError("The server reporting credential is incomplete.");
  return { email: value.client_email, key: value.private_key };
}
async function fetchJson(url: string, options: RequestInit) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new ReportError(
      response.status === 401 || response.status === 403
        ? "GA4 reporting access was rejected. Check the service account’s property access and enabled Data API."
        : response.status === 429
          ? "GA4 reporting reached its quota. Return shortly."
          : "GA4 reporting is temporarily unavailable. Retry shortly.",
    );
  const raw = await response.text();
  if (raw.length > 750000)
    throw new ReportError("The GA4 report exceeded its supported size.");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ReportError("GA4 returned an incomplete report. Retry shortly.");
  }
}
async function accessToken(env: Bindings, config: string) {
  const cached = tokens.get(env);
  if (cached?.config === config && cached.until > Date.now())
    return cached.value;
  const underway = tokenRequests.get(env);
  if (underway?.config === config) return underway.pending;
  const pending = (async () => {
    const account = credentials(env),
      key = await importPKCS8(account.key, "RS256");
    const assertion = await new SignJWT({
      scope: "https://www.googleapis.com/auth/analytics.readonly",
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.email)
      .setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(key);
    const result = await fetchJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    if (
      typeof result.access_token !== "string" ||
      result.access_token.length < 10 ||
      result.access_token.length > 8000 ||
      result.token_type !== "Bearer" ||
      typeof result.expires_in !== "number" ||
      result.expires_in < 60
    )
      throw new ReportError("GA4 reporting authorization did not complete.");
    tokens.set(env, {
      config,
      value: result.access_token,
      until: Date.now() + Math.min(3600, result.expires_in) * 1000 - 30000,
    });
    return result.access_token;
  })();
  tokenRequests.set(env, { config, pending });
  try {
    return await pending;
  } finally {
    if (tokenRequests.get(env)?.pending === pending) tokenRequests.delete(env);
  }
}
async function report(
  env: Bindings,
  token: string,
  days: number,
  dimensions: string[],
  metrics: string[],
): Promise<Table> {
  const data = await fetchJson(
    `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: `${days - 1}daysAgo`, endDate: "today" }],
        dimensions: dimensions.map((name) => ({ name })),
        metrics: metrics.map((name) => ({ name })),
        limit: "1000",
        orderBys: dimensions.includes("date")
          ? [{ dimension: { dimensionName: "date" } }]
          : [{ metric: { metricName: metrics[0] }, desc: true }],
        returnPropertyQuota: true,
      }),
    },
  );
  const headers = (value: unknown) =>
    Array.isArray(value)
      ? value.map((h) =>
          typeof h === "object" && h !== null && "name" in h
            ? String(h.name)
            : "",
        )
      : [];
  if (
    JSON.stringify(headers(data.dimensionHeaders)) !==
      JSON.stringify(dimensions) ||
    JSON.stringify(headers(data.metricHeaders)) !== JSON.stringify(metrics) ||
    (data.rows !== undefined && !Array.isArray(data.rows))
  )
    throw new ReportError("GA4 returned an incomplete report. Retry shortly.");
  const rows: Row[] = [];
  for (const row of (data.rows ?? []) as {
    dimensionValues?: { value?: string }[];
    metricValues?: { value?: string }[];
  }[]) {
    if (
      (row.dimensionValues ?? []).length !== dimensions.length ||
      row.metricValues?.length !== metrics.length
    )
      throw new ReportError(
        "GA4 returned an incomplete report. Retry shortly.",
      );
    const entry: Row = {};
    for (const [i, name] of dimensions.entries()) {
      const value = row.dimensionValues?.[i]?.value;
      if (typeof value !== "string" || value.length > 500)
        throw new ReportError("GA4 returned an incomplete report.");
      entry[name] = value;
    }
    for (const [i, name] of metrics.entries()) {
      const raw = row.metricValues[i]?.value,
        value = Number(raw);
      if (
        typeof raw !== "string" ||
        raw.trim() === "" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > Number.MAX_SAFE_INTEGER
      )
        throw new ReportError("GA4 returned an invalid measurement.");
      entry[name] = value;
    }
    rows.push(entry);
  }
  const metadata = data.metadata as
    | {
        timeZone?: unknown;
        subjectToThresholding?: unknown;
        dataLossFromOtherRow?: unknown;
      }
    | undefined;
  return {
    rows,
    limited: typeof data.rowCount === "number" && data.rowCount > rows.length,
    timeZone: typeof metadata?.timeZone === "string" ? metadata.timeZone : null,
    thresholded:
      metadata?.subjectToThresholding === true ||
      metadata?.dataLossFromOtherRow === true,
  };
}
export async function googleAnalyticsReport(
  env: Bindings,
  days: number,
): Promise<GoogleAnalyticsReport> {
  if (![7, 30, 90].includes(days))
    throw new Error("Unsupported reporting period");
  if (env.GA4_REPORTING_ENABLED !== "true")
    return {
      state: "paused",
      message:
        "GA4 reporting is paused. Recorded app activity remains available below.",
    };
  if (!/^\d{1,15}$/.test(env.GA4_PROPERTY_ID ?? ""))
    return {
      state: "setup_required",
      message:
        "Add the numeric GA4 property ID and a server reporting credential.",
    };
  const custom = env.GA4_CUSTOM_DIMENSIONS_READY === "true",
    config = JSON.stringify([
      env.GA4_PROPERTY_ID,
      env.GA4_SERVICE_ACCOUNT_JSON,
      custom,
    ]);
  const cached = reports.get(env);
  if (
    cached?.config === config &&
    cached.days === days &&
    cached.until > Date.now()
  )
    return cached.value;
  const underway = reportRequests.get(env);
  if (underway?.config === config && underway.days === days)
    return underway.pending;
  const pending: Promise<GoogleAnalyticsReport> = (async () => {
    try {
      credentials(env);
      const token = await accessToken(env, config),
        platformDimension = custom ? "customEvent:app_platform" : "platform";
      const [totals, daily, platforms, screens, events] = await Promise.all([
        report(
          env,
          token,
          days,
          [],
          ["activeUsers", "sessions", "screenPageViews", "eventCount"],
        ),
        report(
          env,
          token,
          days,
          ["date"],
          ["activeUsers", "sessions", "eventCount"],
        ),
        report(
          env,
          token,
          days,
          [platformDimension],
          ["activeUsers", "sessions", "eventCount"],
        ),
        report(
          env,
          token,
          days,
          [custom ? "customEvent:screen" : "unifiedScreenName"],
          ["screenPageViews", "eventCount"],
        ),
        report(
          env,
          token,
          days,
          custom ? ["eventName", "customEvent:action"] : ["eventName"],
          ["eventCount"],
        ),
      ]);
      const value: GoogleAnalyticsReport = {
        state: "ready",
        generatedAt: new Date().toISOString(),
        days,
        platformDimension,
        totals: totals.rows[0] ?? {},
        daily: daily.rows,
        platforms: platforms.rows,
        screens: screens.rows,
        events: events.rows,
        timeZone: totals.timeZone,
        limited: [totals, daily, platforms, screens, events].some(
          (r) => r.limited,
        ),
        thresholded: [totals, daily, platforms, screens, events].some(
          (r) => r.thresholded,
        ),
      };
      reports.set(env, { config, days, until: Date.now() + 300000, value });
      return value;
    } catch (error) {
      return {
        state: !env.GA4_SERVICE_ACCOUNT_JSON ? "setup_required" : "unavailable",
        message:
          error instanceof ReportError
            ? error.message
            : "GA4 reporting could not connect. Check its server credential or retry shortly.",
      };
    }
  })();
  reportRequests.set(env, { config, days, pending });
  try {
    return await pending;
  } finally {
    if (reportRequests.get(env)?.pending === pending)
      reportRequests.delete(env);
  }
}
