import { z } from "zod";

export type {
  CompositeTypes,
  Database,
  Enums,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "./database.types";

export const environmentSchema = z.enum(["local", "preview", "production"]);

export const apiErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "FEATURE_DISABLED",
  "PROVIDER_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    requestId: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const publicConfigSchema = z.object({
  environment: environmentSchema,
  maintenance: z.boolean(),
  minimumAppVersion: z.string(),
  platform: z.object({
    apiRuntime: z.literal("cloudflare-workers"),
    dataRuntime: z.literal("supabase"),
    portalRuntime: z.literal("vercel"),
  }),
  features: z.object({
    identity: z.boolean(),
    academicCore: z.boolean(),
    notifications: z.boolean(),
    agentApplications: z.boolean(),
    socialFeed: z.boolean(),
    messaging: z.boolean(),
    events: z.boolean(),
    learningMarketplace: z.boolean(),
    marketplace: z.boolean(),
    riderDispatch: z.boolean(),
    payments: z.boolean(),
    aiAssistant: z.boolean(),
  }),
});

export const liveHealthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("kampusone-api"),
  environment: environmentSchema,
  requestId: z.string().min(1),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type PublicConfig = z.infer<typeof publicConfigSchema>;
export type LiveHealth = z.infer<typeof liveHealthSchema>;
