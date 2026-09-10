import { neon } from "@neondatabase/serverless";

import type { Bindings } from "../types";
import { isUuid } from "./auth";

const eventNames = new Set([
  "app.opened",
  "screen.viewed",
  "screen.time",
  "feature.used",
  "onboarding.completed",
  "permission.prompted",
  "permission.result",
  "notification.opened",
  "class.alarm.tested",
  "event.booked",
  "feed.engaged",
  "commerce.viewed",
]);

const surfaces = new Set(["mobile", "web", "agent_portal", "operations_portal"]);
const platforms = new Set(["ios", "android", "web", "server"]);
const forbiddenPropertyKey = /(^|_)(email|phone|nin|matric|name|address|token|password|document|message|latitude|longitude|coordinate)(_|$)/i;

export type ValidAnalyticsEvent = {
  eventId: string;
  occurredAt: string;
  institutionId: string;
  sessionId: string;
  eventName: string;
  surface: string;
  platform: string;
  route?: string;
  durationMs?: number;
  appVersion?: string;
  properties: Record<string, string | number | boolean | null>;
};

export function validateAnalyticsBatch(value: unknown):
  | { ok: true; events: ValidAnalyticsEvent[] }
  | { ok: false; message: string } {
  if (!value || typeof value !== "object") return { ok: false, message: "Expected a JSON object." };
  const events = (value as { events?: unknown }).events;
  if (!Array.isArray(events) || events.length < 1 || events.length > 25) {
    return { ok: false, message: "events must contain between 1 and 25 items." };
  }

  const parsed: ValidAnalyticsEvent[] = [];
  for (const [index, raw] of events.entries()) {
    if (!raw || typeof raw !== "object") return { ok: false, message: `events[${index}] must be an object.` };
    const candidate = raw as Record<string, unknown>;
    const requiredIds = [candidate.eventId, candidate.institutionId, candidate.sessionId];
    if (!requiredIds.every((item) => typeof item === "string" && isUuid(item))) {
      return { ok: false, message: `events[${index}] contains an invalid identifier.` };
    }
    if (typeof candidate.occurredAt !== "string" || Number.isNaN(Date.parse(candidate.occurredAt))) {
      return { ok: false, message: `events[${index}].occurredAt must be an ISO timestamp.` };
    }
    if (typeof candidate.eventName !== "string" || !eventNames.has(candidate.eventName)) {
      return { ok: false, message: `events[${index}].eventName is not allow-listed.` };
    }
    if (typeof candidate.surface !== "string" || !surfaces.has(candidate.surface)) {
      return { ok: false, message: `events[${index}].surface is invalid.` };
    }
    if (typeof candidate.platform !== "string" || !platforms.has(candidate.platform)) {
      return { ok: false, message: `events[${index}].platform is invalid.` };
    }
    if (candidate.route !== undefined && (typeof candidate.route !== "string" || candidate.route.length > 240)) {
      return { ok: false, message: `events[${index}].route is invalid.` };
    }
    if (candidate.durationMs !== undefined && (!Number.isInteger(candidate.durationMs) || Number(candidate.durationMs) < 0 || Number(candidate.durationMs) > 86_400_000)) {
      return { ok: false, message: `events[${index}].durationMs is invalid.` };
    }
    if (candidate.appVersion !== undefined && (typeof candidate.appVersion !== "string" || candidate.appVersion.length > 40)) {
      return { ok: false, message: `events[${index}].appVersion is invalid.` };
    }

    const properties = candidate.properties ?? {};
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
      return { ok: false, message: `events[${index}].properties must be an object.` };
    }
    const safeProperties: Record<string, string | number | boolean | null> = {};
    for (const [key, property] of Object.entries(properties)) {
      if (forbiddenPropertyKey.test(key)) return { ok: false, message: `events[${index}].properties contains a prohibited key.` };
      if (property !== null && !["string", "number", "boolean"].includes(typeof property)) {
        return { ok: false, message: `events[${index}].properties values must be scalar.` };
      }
      if (typeof property === "string" && property.length > 300) {
        return { ok: false, message: `events[${index}].properties contains an oversized value.` };
      }
      safeProperties[key] = property as string | number | boolean | null;
    }
    if (JSON.stringify(safeProperties).length > 8_000) {
      return { ok: false, message: `events[${index}].properties is too large.` };
    }

    parsed.push({
      eventId: candidate.eventId as string,
      occurredAt: candidate.occurredAt,
      institutionId: candidate.institutionId as string,
      sessionId: candidate.sessionId as string,
      eventName: candidate.eventName,
      surface: candidate.surface,
      platform: candidate.platform,
      properties: safeProperties,
      ...(typeof candidate.route === "string" ? { route: candidate.route } : {}),
      ...(typeof candidate.durationMs === "number" ? { durationMs: candidate.durationMs } : {}),
      ...(typeof candidate.appVersion === "string" ? { appVersion: candidate.appVersion } : {}),
    });
  }
  return { ok: true, events: parsed };
}

export async function ingestAnalyticsEvents(env: Bindings, subjectId: string, events: ValidAnalyticsEvent[]) {
  if (!env.NEON_DATABASE_URL) throw new Error("NEON_DATABASE_URL is not configured");
  const sql = neon(env.NEON_DATABASE_URL);
  const queries = events.map((event) => sql`
    insert into kampusone_analytics.events (
      event_id,
      occurred_at,
      institution_id,
      subject_id,
      session_id,
      event_name,
      surface,
      route,
      duration_ms,
      platform,
      app_version,
      consent_scope,
      properties
    )
    select
      ${event.eventId}::uuid,
      ${event.occurredAt}::timestamptz,
      ${event.institutionId}::uuid,
      ${subjectId}::uuid,
      ${event.sessionId}::uuid,
      ${event.eventName},
      ${event.surface},
      ${event.route ?? null},
      ${event.durationMs ?? null},
      ${event.platform},
      ${event.appVersion ?? null},
      'product_analytics',
      ${JSON.stringify(event.properties)}::jsonb
    where not exists (
      select 1
      from kampusone_analytics.subject_suppressions suppression
      where suppression.subject_id = ${subjectId}::uuid
        and (suppression.expires_at is null or suppression.expires_at > now())
    )
    on conflict (event_id) do nothing
    returning event_id
  `);
  const results = await sql.transaction(queries);
  return results.reduce((total, rows) => total + rows.length, 0);
}
