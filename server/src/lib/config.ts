import type { PublicConfig } from "@kampusone/contracts";

import type { Bindings } from "../types";
import { featureEnabled } from "./features";

const enabled = (value: string | undefined) => value?.toLowerCase() === "true";

export function getPublicConfig(env: Bindings): PublicConfig {
  return {
    environment: env.ENVIRONMENT,
    maintenance: enabled(env.MAINTENANCE_MODE),
    minimumAppVersion: env.MINIMUM_APP_VERSION,
    features: {
      academicCore: enabled(env.ACADEMIC_CORE_ENABLED),
      socialFeed: enabled(env.SOCIAL_FEED_ENABLED),
      tutorials: featureEnabled(env, "TUTORIALS_ENABLED"),
      store: featureEnabled(env, "STORE_ENABLED"),
      logistics: featureEnabled(env, "LOGISTICS_ENABLED"),
      marketplace: featureEnabled(env, "MARKETPLACE_ENABLED"),
      payments: enabled(env.PAYMENTS_ENABLED),
      aiAssistant: enabled(env.AI_ASSISTANT_ENABLED),
    },
  };
}

export function allowedOrigins(env: Bindings): Set<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function readiness(env: Bindings) {
  const checks = {
    database: Boolean(env.DATABASE_URL),
    signingKey: Boolean(env.JWT_SECRET && env.JWT_SECRET.length >= 32),
    otpPepper: Boolean(env.OTP_PEPPER && env.OTP_PEPPER.length >= 24),
    emailProvider: Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL),
  };

  return {
    ready: Object.values(checks).every(Boolean),
    checks,
  };
}
