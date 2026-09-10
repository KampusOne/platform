import type { Bindings } from "../types";
import { AppError } from "./errors";

type Feature = "ACADEMIC_CORE_ENABLED" | "SOCIAL_FEED_ENABLED" | "MARKETPLACE_ENABLED" | "PAYMENTS_ENABLED";

export function requireFeature(env: Bindings, feature: Feature, message: string) {
  if (env[feature]?.toLowerCase() !== "true") {
    throw new AppError(503, "FEATURE_DISABLED", message);
  }
}
