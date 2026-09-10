export type RuntimeEnvironment = "local" | "preview" | "production";

export type Bindings = {
  ENVIRONMENT: RuntimeEnvironment;
  ALLOWED_ORIGINS: string;
  MINIMUM_APP_VERSION: string;
  MAINTENANCE_MODE: string;
  ACADEMIC_CORE_ENABLED: string;
  SOCIAL_FEED_ENABLED: string;
  MARKETPLACE_ENABLED: string;
  PAYMENTS_ENABLED: string;
  AI_ASSISTANT_ENABLED: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
};

export type Variables = {
  requestId: string;
};
