export type RuntimeEnvironment = "local" | "staging" | "production";

export type Bindings = {
  AI?: import('./lib/ai-workers').WorkersAIBinding;
  AI_TEXT_PROVIDER?: string;
  /** Set to false to bypass the non-personal Worker read cache immediately. */
  SHARED_READ_CACHE_ENABLED?: string;
  /** Enable only after the reviewed cache revision migration is installed. */
  VERSIONED_READ_CACHE_ENABLED?: string;
  READ_CACHE_METRICS_ENABLED?: string;
  WORKERS_AI_CHAT_MODEL?: string;
  WORKERS_AI_PRO_MODEL?: string;
  MAP_SATELLITE_TILE_URL?: string;
  MAP_SATELLITE_ATTRIBUTION?: string;
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
  PAYOUTS_ENABLED?: string;
  KIRA_SUBSCRIPTIONS_ENABLED?: string;
  AI_ASSISTANT_ENABLED: string;
  DATABASE_URL?: string;
  JWT_SECRET?: string;
  OTP_PEPPER?: string;
  BUNNY_STREAM_API_KEY?:string;
  BUNNY_STREAM_LIBRARY_ID?:string;
  BUNNY_STREAM_TOKEN_KEY?:string;
  VDOCIPHER_API_SECRET?:string;
  CLOUDINARY_CLOUD_NAME?:string;
  CLOUDINARY_API_KEY?:string;
  CLOUDINARY_API_SECRET?:string;
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
  COOKIE_DOMAIN?: string;
  APP_ORIGIN?: string;
  PAYSTACK_SECRET_KEY?: string;
  PAYSTACK_WEBHOOK_SECRET?: string;
  /** Bachs hosted-checkout bearer key (Cloudflare encrypted secret). */
  BACHS_API_KEY?: string;
  /** Bachs webhook endpoint signing secret (not the API key). */
  BACHS_WEBHOOK_SECRET?: string;
  /** Remains OFF until provider-aware fulfillment and migration are complete. */
  BACHS_PRICED_CHECKOUT_ENABLED?: string;
  /** Merchant processing-cost setting confirmed for the configured BACHS account. */
  BACHS_MERCHANT_BEARS_COST_CONFIRMED?: string;
  ADMIN_BOOTSTRAP_TOKEN?: string;
  INITIAL_ADMIN_EMAIL?: string;
  UNIFIED_SCHEMA_READY?: string;
  R2_DIRECT_UPLOADS_ENABLED?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_PRIVATE_BUCKET_NAME?: string;
  R2_MEDIA_BUCKET_NAME?: string;
  R2_UPLOAD_URL_TTL_SECONDS?: string;
  R2_PLAYBACK_URL_TTL_SECONDS?: string;
  MEDIA_BUCKET?: R2Bucket;
  PRIVATE_BUCKET?: R2Bucket;
  PUBLIC_API_ORIGIN?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  AUTH_PROVIDER?: string;
  HF_TOKEN?: string;
  HF_CHAT_MODEL?: string;
  HF_REASONING_MODEL?: string;
  HF_VISION_MODEL?: string;
  HF_PRO_MODEL?: string;
  HF_TRANSCRIPTION_MODEL?: string;
  HF_TRANSCRIPTION_FALLBACK_MODEL?: string;
  GROQ_API_KEY?: string;
  GROQ_TRANSCRIPTION_MODEL?: string;
  KIRA_YOUTUBE_ENABLED?: string;
  YOUTUBE_API_KEY?: string;
  KAMPUSONE_PUBLIC_LAUNCH_DATE?: string;
  KAMPUSONE_AGENT_APPLICATION_URL?: string;
  KAMPUSONE_WAITLIST_URL?: string;
  AI_CHAT_WINDOW_LIMIT?: string;
  AI_STUDY_TRIAL_LIMIT?: string;
  EXPO_ACCESS_TOKEN?: string;
  FCM_SERVICE_ACCOUNT_JSON?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_TRANSCRIPTION_MODEL?: string;
  KYC_FINGERPRINT_SECRET?: string;
  KYC_ENCRYPTION_KEY?: string;
  AI_DAILY_USER_LIMIT?: string;
  AI_DAILY_GLOBAL_LIMIT?: string;
  AI_UNLIMITED_EMAIL_HASHES?: string;
  GA4_ANALYTICS_ENABLED?: string;
  GA4_MEASUREMENT_ID?: string;
  GA4_API_SECRET?: string;
  GA4_REPORTING_ENABLED?: string;
  GA4_PROPERTY_ID?: string;
  GA4_SERVICE_ACCOUNT_JSON?: string;
  GA4_CUSTOM_DIMENSIONS_READY?: string;
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
