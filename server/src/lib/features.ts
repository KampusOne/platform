import type { Bindings } from "../types";
import { AppError } from "./errors";

type Feature =
  | "ACADEMIC_CORE_ENABLED"
  | "SOCIAL_FEED_ENABLED"
  | "TUTORIALS_ENABLED"
  | "STORE_ENABLED"
  | "LOGISTICS_ENABLED"
  | "MARKETPLACE_ENABLED"
  | "PAYMENTS_ENABLED";

export function featureEnabled(env: Bindings, feature: Feature) {
  if (feature === "TUTORIALS_ENABLED" && !phase2SchemaReady(env)) return false;
  const configured = env[feature];
  if (configured !== undefined) return configured.toLowerCase() === "true";
  if (["TUTORIALS_ENABLED", "STORE_ENABLED", "LOGISTICS_ENABLED"].includes(feature)) {
    return env.MARKETPLACE_ENABLED?.toLowerCase() === "true";
  }
  return false;
}

export function phase2SchemaReady(env: Bindings) {
  return env.PHASE_2_SCHEMA_READY?.toLowerCase() === "true";
}

export function requireFeature(env: Bindings, feature: Feature, message: string) {
  if (!featureEnabled(env, feature)) {
    throw new AppError(503, "FEATURE_DISABLED", message);
  }
}
