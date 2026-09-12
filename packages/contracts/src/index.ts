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

export const environmentSchema = z.enum(["local", "staging", "production"]);

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
  features: z.object({
    academicCore: z.boolean(),
    socialFeed: z.boolean(),
    tutorials: z.boolean(),
    store: z.boolean(),
    logistics: z.boolean(),
    marketplace: z.boolean(),
    payments: z.boolean(),
    aiAssistant: z.boolean(),
  }),
});

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(10).max(128),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  acceptedTerms: z.literal(true),
  legalVersion: z.string().trim().min(1).max(40),
});

export const verifyEmailSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/),
  deviceLabel: z.string().trim().min(1).max(120).optional(),
});

export const resendVerificationSchema = z.object({ email: emailSchema });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  deviceLabel: z.string().trim().min(1).max(120).optional(),
});

export const refreshSessionSchema = z.object({
  refreshToken: z.string().min(32).max(512).optional(),
  deviceLabel: z.string().trim().min(1).max(120).optional(),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(10).max(128),
});

export const onboardingProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/),
  universityId: z.string().uuid(),
  facultyId: z.string().uuid(),
  departmentId: z.string().uuid(),
  courseId: z.string().uuid().nullable().optional(),
  currentLevel: z.string().trim().regex(/^[1-9]00$/),
  matriculationNumber: z.string().trim().min(3).max(40),
  graduationYear: z.number().int().min(2020).max(2200),
});

export const timetableEntrySchema = z.object({
  title: z.string().trim().min(1).max(160),
  courseCode: z.string().trim().max(24).optional(),
  venue: z.string().trim().max(160).optional(),
  lecturer: z.string().trim().max(120).optional(),
  dayOfWeek: z.number().int().min(0).max(6),
  startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  reminderMinutes: z.number().int().min(0).max(240).default(15),
  reminderEnabled: z.boolean().default(true),
});

export const gpaResultSchema = z.object({
  courseCode: z.string().trim().toUpperCase().min(2).max(24),
  courseTitle: z.string().trim().min(2).max(180),
  units: z.number().positive().max(30),
  grade: z.string().trim().toUpperCase().min(1).max(3),
  gradePoint: z.number().min(0).max(7),
});

export const gpaTermSchema = z.object({
  sessionLabel: z.string().trim().min(4).max(24),
  semester: z.number().int().min(1).max(3),
  levelCode: z.string().trim().min(3).max(12),
  results: z.array(gpaResultSchema).min(1).max(40),
});

export const agentApplicationSchema = z.object({
  universityId: z.string().uuid(),
  agentType: z.enum(["TUTOR", "VENDOR", "RIDER"]),
  displayName: z.string().trim().min(2).max(120),
  phoneE164: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
  statement: z.string().trim().min(20).max(1000),
  legalName: z.string().trim().min(2).max(160),
  address: z.string().trim().min(10).max(500),
  emergencyContactName: z.string().trim().min(2).max(120),
  emergencyContactPhone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
  acceptedAgentTerms: z.literal(true),
  termsVersion: z.string().trim().min(1).max(40),
});

export const reviewAgentApplicationSchema = z.object({
  decision: z.enum(["APPROVED", "NEEDS_CORRECTION", "REJECTED"]),
  note: z.string().trim().min(3).max(1000),
});

export const agentVerificationReviewSchema = z.object({
  identityStatus: z.enum(["MANUALLY_VERIFIED", "REJECTED"]),
  phoneVerified: z.boolean(),
  bankStatus: z.enum(["NOT_STARTED", "VERIFIED", "REJECTED"]),
  providerReference: z.string().trim().max(160).nullable().optional(),
  bankAccountName: z.string().trim().max(160).nullable().optional(),
  bankAccountLast4: z.string().regex(/^\d{4}$/).nullable().optional(),
  note: z.string().trim().min(10).max(1000),
});

export const disputeReviewSchema = z.object({
  status: z.enum(["UNDER_REVIEW", "RESOLVED", "CLOSED"]),
  resolutionCode: z.enum(["RELEASE_EARNINGS", "REFUND_REQUIRED", "NO_ACTION", "PARTIAL_REFUND_REVIEW"]).nullable().optional(),
  note: z.string().trim().min(10).max(2000),
});

export const payoutReviewSchema = z.object({
  status: z.enum(["IN_REVIEW", "APPROVED", "PROCESSING", "PAID", "FAILED", "REJECTED"]),
  note: z.string().trim().min(3).max(1000),
  providerReference: z.string().trim().max(160).nullable().optional(),
});

export const paymentEventReviewSchema = z.object({
  resolutionCode: z.enum(["REFUNDED", "MATCHED_MANUALLY", "DUPLICATE_CONFIRMED", "REJECTED_AS_INVALID"]),
  note: z.string().trim().min(10).max(2000),
});

export const tutorialListingSchema = z.object({
  courseId: z.string().uuid().nullable().optional(),
  courseCode: z.string().trim().min(2).max(24),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(20).max(2000),
  format: z.enum(["IN_PERSON", "ONLINE", "HYBRID"]),
  priceKobo: z.number().int().min(0).max(100_000_000),
  capacity: z.number().int().min(1).max(500),
  locationText: z.string().trim().max(160).nullable().optional(),
  cancellationCutoffHours: z.number().int().min(0).max(168).default(2),
});

export const tutorialListingStateSchema = z.object({
  status: z.enum(["SUBMITTED", "PAUSED", "ARCHIVED"]),
});

export const tutorialResourceSchema = z.object({
  listingId: z.string().uuid().nullable().optional(),
  courseId: z.string().uuid().nullable().optional(),
  courseCode: z.string().trim().toUpperCase().min(2).max(24),
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(10).max(2000),
  resourceType: z.enum(["PAST_QUESTION", "NOTE", "PDF", "AUDIOBOOK"]),
  accessModel: z.enum(["FREE", "BOOKING_INCLUDED", "PAID"]).default("FREE"),
  priceKobo: z.number().int().min(0).max(100_000_000).default(0),
  levelCode: z.string().trim().min(3).max(20).nullable().optional(),
  batchLabel: z.string().trim().min(2).max(60).nullable().optional(),
  previewText: z.string().trim().max(5000).nullable().optional(),
  fileUrl: z.string().url().refine((value) => value.startsWith("https://"), {
    message: "Learning-resource links must use HTTPS.",
  }).nullable().optional(),
  pageCount: z.number().int().positive().max(10_000).nullable().optional(),
  durationSeconds: z.number().int().positive().max(24 * 60 * 60).nullable().optional(),
}).superRefine((value, context) => {
  if (value.accessModel === "PAID" && value.priceKobo === 0) {
    context.addIssue({ code: "custom", message: "Paid resources need a price.", path: ["priceKobo"] });
  }
  if (value.accessModel !== "PAID" && value.priceKobo !== 0) {
    context.addIssue({ code: "custom", message: "Only paid resources may have a price.", path: ["priceKobo"] });
  }
  if (value.resourceType === "AUDIOBOOK" && !value.durationSeconds) {
    context.addIssue({ code: "custom", message: "Audiobooks need a duration.", path: ["durationSeconds"] });
  }
});

export const tutorialResourceStateSchema = z.object({
  status: z.enum(["SUBMITTED", "ARCHIVED"]),
});

export const tutorialModerationSchema = z.object({
  decision: z.enum(["APPROVED", "NEEDS_CORRECTION", "REJECTED"]),
  note: z.string().trim().min(3).max(1000),
});

export const tutorialDemoSeedSchema = z.object({ universityId: z.string().uuid() });

export const tutorialCancellationSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const tutorialReviewSchema = z.object({
  bookingId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(3).max(1000).nullable().optional(),
});

export const tutorialNoShowSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
});

export const listingStateSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "PAUSED", "ARCHIVED"]),
});

export const tutorialAvailabilitySchema = z.object({
  listingId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  capacity: z.number().int().min(1).max(500),
});

export const vendorProductSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(10).max(2000),
  categoryId: z.string().uuid(),
  priceKobo: z.number().int().min(0).max(100_000_000),
  stockQuantity: z.number().int().min(0).max(1_000_000),
  imageUrl: z.string().url().nullable().optional(),
});

export const contentSourceSchema = z.object({
  universityId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  sourceUrl: z.string().url().nullable().optional(),
});

export const productCategorySchema = z.object({
  universityId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  listingRules: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["PENDING", "APPROVED", "RESTRICTED", "PROHIBITED"]).default("PENDING"),
});

export const deliveryZoneSchema = z.object({
  universityId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  baseFeeKobo: z.number().int().min(0).max(10_000_000),
  active: z.boolean().default(true),
});

export const feedPostSchema = z.object({
  universityId: z.string().uuid(),
  sourceId: z.string().uuid(),
  category: z.enum(["UPDATE", "EVENT", "SPORTS", "OPPORTUNITY", "EMERGENCY"]),
  title: z.string().trim().min(4).max(180),
  summary: z.string().trim().min(4).max(500),
  body: z.string().trim().min(4).max(20_000),
  imageUrl: z.string().url().nullable().optional(),
  urgent: z.boolean().default(false),
  sponsored: z.boolean().default(false),
  publishNow: z.boolean().default(false),
});

export const campusPlaceSchema = z.object({
  universityId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  category: z.enum(["ACADEMIC", "SERVICE", "TRANSPORT", "HOSTEL", "FOOD", "HEALTH", "SPORT"]),
  description: z.string().trim().max(2000).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accessibilityNotes: z.string().trim().max(1000).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  publishNow: z.boolean().default(false),
});

export const tutorialBookingSchema = z.object({
  listingId: z.string().uuid(),
  availabilityWindowId: z.string().uuid(),
});

export const completionConfirmationSchema = z.object({ confirmed: z.literal(true) });

export const disputeSchema = z.object({
  resourceType: z.enum(["TUTORIAL_BOOKING", "STORE_ORDER"]),
  resourceId: z.string().uuid(),
  category: z.enum(["NOT_DELIVERED", "NOT_AS_DESCRIBED", "SAFETY", "PAYMENT", "NO_SHOW", "OTHER"]),
  reason: z.string().trim().min(10).max(1000),
});

export const storeOrderSchema = z.object({
  vendorProfileId: z.string().uuid(),
  deliveryZoneId: z.string().uuid(),
  deliveryNote: z.string().trim().max(500).nullable().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(100),
  })).min(1).max(30),
});

export const orderStateSchema = z.object({
  status: z.enum(["ACCEPTED", "READY", "CANCELLED"]),
  note: z.string().trim().max(500).nullable().optional(),
});

export const riderPresenceSchema = z.object({
  online: z.boolean(),
  capacityStatus: z.enum(["AVAILABLE", "AT_CAPACITY", "PAUSED"]),
});

export const handoffCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export const payoutRequestSchema = z.object({
  agentProfileId: z.string().uuid(),
  amountKobo: z.number().int().min(100_00).max(100_000_000_00),
});

export const paymentInitializationSchema = z.object({
  resourceType: z.enum(["TUTORIAL_BOOKING", "STORE_ORDER"]),
  resourceId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(160),
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
export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type OnboardingProfileInput = z.infer<typeof onboardingProfileSchema>;
export type TimetableEntryInput = z.infer<typeof timetableEntrySchema>;
export type GpaTermInput = z.infer<typeof gpaTermSchema>;
export type AgentApplicationInput = z.infer<typeof agentApplicationSchema>;
