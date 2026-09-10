import type { PublicConfig } from "@kampusone/contracts";

import type { Bindings } from "../types";

const enabled = (value: string | undefined) => value?.toLowerCase() === "true";

export function getPublicConfig(env: Bindings): PublicConfig {
  return {
    environment: env.ENVIRONMENT,
    maintenance: enabled(env.MAINTENANCE_MODE),
    minimumAppVersion: env.MINIMUM_APP_VERSION,
    platform: {
      apiRuntime: "cloudflare-workers",
      dataRuntime: "supabase",
      portalRuntime: "vercel",
    },
    features: {
      identity: enabled(env.IDENTITY_ENABLED),
      academicCore: enabled(env.ACADEMIC_CORE_ENABLED),
      notifications: enabled(env.NOTIFICATIONS_ENABLED),
      agentApplications: enabled(env.AGENT_APPLICATIONS_ENABLED),
      socialFeed: enabled(env.SOCIAL_FEED_ENABLED),
      messaging: enabled(env.MESSAGING_ENABLED),
      events: enabled(env.EVENTS_ENABLED),
      learningMarketplace: enabled(env.LEARNING_MARKETPLACE_ENABLED),
      marketplace: enabled(env.MARKETPLACE_ENABLED),
      riderDispatch: enabled(env.RIDER_DISPATCH_ENABLED),
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
    supabaseUrl: Boolean(env.SUPABASE_URL),
    publishableKey: Boolean(env.SUPABASE_PUBLISHABLE_KEY),
    serverSecret: Boolean(env.SUPABASE_SECRET_KEY),
  };

  return {
    ready: Object.values(checks).every(Boolean),
    checks,
  };
}
