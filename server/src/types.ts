export type RuntimeEnvironment = "local" | "staging" | "production";

export type Bindings = {
  ENVIRONMENT: RuntimeEnvironment;
  ALLOWED_ORIGINS: string;
  MINIMUM_APP_VERSION: string;
  MAINTENANCE_MODE: string;
  ACADEMIC_CORE_ENABLED: string;
  SOCIAL_FEED_ENABLED: string;
  MARKETPLACE_ENABLED: string;
  PHASE_2_SCHEMA_READY?: string;
  PHASE_3_SCHEMA_READY?: string;
  TUTORIALS_ENABLED?: string;
  STORE_ENABLED?: string;
  STORE_DEMO_ENABLED?: string;
  LOGISTICS_ENABLED?: string;
  PAYMENTS_ENABLED: string;
  AI_ASSISTANT_ENABLED: string;
  DATABASE_URL?: string;
  JWT_SECRET?: string;
  OTP_PEPPER?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
  COOKIE_DOMAIN?: string;
  APP_ORIGIN?: string;
  PAYSTACK_SECRET_KEY?: string;
  PAYSTACK_WEBHOOK_SECRET?: string;
  ADMIN_BOOTSTRAP_TOKEN?: string;
  INITIAL_ADMIN_EMAIL?: string;
  UNIFIED_SCHEMA_READY?: string;
  MEDIA_BUCKET?: R2Bucket;
  PRIVATE_BUCKET?: R2Bucket;
  PUBLIC_API_ORIGIN?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  AUTH_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  KYC_FINGERPRINT_SECRET?: string;
  AI_DAILY_USER_LIMIT?: string;
  AI_DAILY_GLOBAL_LIMIT?: string;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  roles: string[];
  universityId: string | null;
  operatorRoles: string[];
  sessionFamilyId?: string;
};

export type Variables = {
  requestId: string;
  user?: AuthenticatedUser;
};
