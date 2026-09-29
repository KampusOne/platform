import { z } from "@kampusone/contracts";
import { Hono } from "hono";

import { AppError } from "../lib/errors";
import {
  analyticsEventNames,
  sendGoogleAnalyticsBatch,
  type ProductAnalyticsBatch,
} from "../lib/google-analytics";
import type { Bindings, Variables } from "../types";

export const analyticsRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

const token = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

const analyticsEventSchema = z
  .object({
    name: z.enum(analyticsEventNames),
    timestampMs: z.number().int().positive(),
    sessionId: z.string().regex(/^\d{1,13}$/),
    screen: token.optional(),
    feature: token.optional(),
    action: token.optional(),
    component: token.optional(),
    target: token.optional(),
    errorCode: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[A-Z0-9_]+$/)
      .optional(),
    durationMs: z.number().int().min(0).max(600_000).optional(),
  })
  .strict();

const analyticsBatchSchema = z
  .object({
    clientId: z.string().regex(/^\d{1,10}\.\d{1,12}$/),
    platform: z.enum(["android", "ios", "web"]),
    appVersion: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9._+-]+$/),
    buildNumber: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9._+-]+$/)
      .optional(),
    events: z.array(analyticsEventSchema).min(1).max(25),
  })
  .strict();

const safetyWindows = new Map<
  string,
  { startedAt: number; eventCount: number }
>();
const WINDOW_MS = 60_000;
const MAX_EVENTS_PER_WINDOW = 600;
const MAX_TRACKED_CLIENTS = 2_000;

function consumeSafetyWindow(clientId: string, events: number) {
  const now = Date.now();
  let current = safetyWindows.get(clientId);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    current = { startedAt: now, eventCount: 0 };
    safetyWindows.set(clientId, current);
  }
  if (current.eventCount + events > MAX_EVENTS_PER_WINDOW) return false;
  current.eventCount += events;

  if (safetyWindows.size > MAX_TRACKED_CLIENTS) {
    for (const [key, value] of safetyWindows) {
      if (now - value.startedAt >= WINDOW_MS) safetyWindows.delete(key);
      if (safetyWindows.size <= MAX_TRACKED_CLIENTS) break;
    }
  }
  return true;
}

analyticsRoutes.post("/events", async (context) => {
  const raw = await context.req.json().catch(() => null);
  const parsed = analyticsBatchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "The analytics batch is invalid.",
    );
  }

  if (!consumeSafetyWindow(parsed.data.clientId, parsed.data.events.length)) {
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Analytics is being sent too quickly.",
    );
  }

  const batch: ProductAnalyticsBatch = parsed.data;
  const delivery = await sendGoogleAnalyticsBatch(context.env, batch);

  if (delivery.status === "misconfigured") {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Analytics is enabled but not configured.",
    );
  }
  if (delivery.status === "failed") {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Analytics delivery is temporarily unavailable.",
    );
  }

  return context.json({ status: delivery.status }, 202);
});
