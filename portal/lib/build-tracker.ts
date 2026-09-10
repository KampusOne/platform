export type BuildStatus = "done" | "in_progress" | "planned" | "blocked" | "needs_input";

export type BuildItem = {
  name: string;
  detail: string;
  status: BuildStatus;
  evidence?: string;
};

export type BuildPhase = {
  id: string;
  number: string;
  title: string;
  objective: string;
  status: BuildStatus;
  reviewGate: string;
  items: BuildItem[];
};

export const trackerUpdatedAt = "10 September 2026 · Phase 1 working build";

export const buildPhases: BuildPhase[] = [
  {
    id: "foundation",
    number: "00",
    title: "Platform foundation",
    objective: "Create one maintainable codebase with safe deployment boundaries.",
    status: "done",
    reviewGate: "Passed: type checks, tests, dry builds, RLS and security-advisor review.",
    items: [
      { name: "Expo student app", detail: "Expo Router, shared tokens, five primary tabs and preview states.", status: "done", evidence: "mobile/" },
      { name: "Separated web surfaces", detail: "Host-aware Next.js operations, agents and build tracker routes.", status: "done", evidence: "portal/proxy.ts" },
      { name: "Cloudflare API", detail: "Hono Worker, health checks, CORS, secure headers and fail-closed flags.", status: "done", evidence: "server/" },
      { name: "Supabase core", detail: "Multi-institution academic schema, RLS, trusted roles and private operations schema.", status: "done", evidence: "database/supabase/migrations/" },
      { name: "Deployment automation", detail: "GitHub checks, Cloudflare Worker workflow and Vercel project links.", status: "done", evidence: ".github/workflows/" },
    ],
  },
  {
    id: "identity",
    number: "01",
    title: "Identity, onboarding & agent intake",
    objective: "Let a student create an account and let an agent submit evidence without unsafe automation.",
    status: "in_progress",
    reviewGate: "Open: migrations, builds, role tests and a real email round-trip must pass together.",
    items: [
      { name: "Student welcome and intro", detail: "Branded welcome plus four illustrated, accessible intro stories.", status: "done", evidence: "mobile/app/index.tsx · intro.tsx" },
      { name: "Email authentication", detail: "Create account, password login, OTP verification and recovery with Supabase Auth.", status: "in_progress", evidence: "mobile/app/create-account.tsx · login.tsx" },
      { name: "14-step onboarding", detail: "Academic identity, interests, permissions, privacy choices and review summary.", status: "done", evidence: "mobile/app/onboarding.tsx" },
      { name: "Agent application", detail: "Application, document checklist, consent and transparent verification timeline.", status: "in_progress", evidence: "portal/app/agents/" },
      { name: "Operations review", detail: "Review queue, document checks, pending/manual outcomes and append-only evidence.", status: "in_progress", evidence: "portal/app/admin/" },
      { name: "Neon isolation", detail: "Existing legacy schema preserved; new analytics work isolated on a development branch.", status: "done", evidence: "Neon: phase-1-platform-foundation" },
      { name: "Cloudflare verification boundary", detail: "Authenticated privileged endpoints and provider adapters remain fail-closed.", status: "in_progress", evidence: "server/src/" },
    ],
  },
  {
    id: "academic",
    number: "02",
    title: "Academic utility core",
    objective: "Make Today, timetable, GPA and study organisation useful before social expansion.",
    status: "planned",
    reviewGate: "Student pilot can complete one week of classes without a spreadsheet or separate reminder app.",
    items: [
      { name: "Today orchestration", detail: "Next class, moved class, deadlines, offline state and contextual quick actions.", status: "in_progress", evidence: "mobile/app/(tabs)/index.tsx" },
      { name: "Timetable workspace", detail: "Manual entry, course import, saved terms and class alarms.", status: "planned" },
      { name: "GPA workspace", detail: "Semester calculations, saved history, grading scales and export.", status: "planned" },
      { name: "Campus directory", detail: "Searchable venues, offices and map-ready place details.", status: "planned" },
      { name: "Notification permission health", detail: "Device state, quiet hours, test notification and test alarm controls.", status: "planned" },
    ],
  },
  {
    id: "community",
    number: "03",
    title: "Feed, profiles & controlled inbox",
    objective: "Add campus discovery without turning the product into unrestricted direct messaging.",
    status: "planned",
    reviewGate: "Moderation, blocking, reporting, rate limits and notification controls pass abuse review.",
    items: [
      { name: "Inbox entry point", detail: "Top-right inbox for Campus One, vendors, riders and service conversations.", status: "done", evidence: "mobile/app/inbox.tsx" },
      { name: "Feed composer", detail: "Text, image, video and polls with draft/upload/retry states.", status: "planned" },
      { name: "Official publishing", detail: "Distinct Campus One editorial posts, verified badge and author permissions.", status: "planned" },
      { name: "Student profiles", detail: "Department, level, verified state, follows and mutual-context summaries.", status: "planned" },
      { name: "Engagement safety", detail: "Like, comment, share, report, mute, block and anti-spam controls.", status: "planned" },
    ],
  },
  {
    id: "events",
    number: "04",
    title: "Events, reservations & tickets",
    objective: "Support display-only, free reservation and paid ticketed events as separate product states.",
    status: "planned",
    reviewGate: "Capacity, duplicate booking, check-in, cancellation, exports and payment reconciliation tests pass.",
    items: [
      { name: "Event discovery", detail: "Cards, detail pages and non-bookable display events.", status: "planned" },
      { name: "Free reservations", detail: "Capacity, waitlist, organiser attendee view and CSV export.", status: "planned" },
      { name: "Paid events", detail: "Provider checkout, ledger-backed revenue and refund states.", status: "blocked" },
      { name: "Ticket cards", detail: "Unique ticket ID, QR verification, image export and social sharing.", status: "planned" },
      { name: "Planner workspace", detail: "Create, publish, monitor bookings and view revenue.", status: "planned" },
    ],
  },
  {
    id: "commerce",
    number: "05",
    title: "Learning marketplace & commerce",
    objective: "Let approved sellers offer videos, PDFs, materials and tutorials with admin safeguards.",
    status: "planned",
    reviewGate: "Ledger, payouts, disputes, tax assumptions, content rights and takedown process are approved.",
    items: [
      { name: "Learning catalogue", detail: "Video, PDF, audiobook and physical material product types.", status: "planned" },
      { name: "Seller tools", detail: "Draft, price, inventory, publish and sales insights.", status: "planned" },
      { name: "Admin commerce controls", detail: "Suspend listing, pause seller, reason codes and appeal trail.", status: "planned" },
      { name: "Payments and ledger", detail: "Idempotent checkout, double-entry ledger, fees and payout reconciliation.", status: "blocked" },
    ],
  },
  {
    id: "delivery",
    number: "06",
    title: "Vendors, riders & campus delivery",
    objective: "Match paid orders to eligible nearby riders without leaking sensitive identity data.",
    status: "planned",
    reviewGate: "Identity-provider, location retention, safety escalation and delivery dispute reviews pass.",
    items: [
      { name: "Rider onboarding", detail: "Licensed identity verification, student status, documents and manual exception path.", status: "blocked" },
      { name: "Nearby matching", detail: "H3/hex-cell candidate search with coarse locations and expiry.", status: "planned" },
      { name: "Delivery offers", detail: "Vendor posts a paid order; an eligible rider accepts exactly once.", status: "planned" },
      { name: "Customer tracking", detail: "Pickup, rider profile summary, delivery code and completion evidence.", status: "planned" },
    ],
  },
  {
    id: "ai",
    number: "07",
    title: "AI study & document review",
    objective: "Use AI as an assisted workflow with confidence thresholds, budgets and human review.",
    status: "planned",
    reviewGate: "Privacy impact, prompt-injection, unsafe-output, cost ceiling and human override tests pass.",
    items: [
      { name: "Note summary page", detail: "Upload, extraction, structured summary, citations and deletion controls.", status: "planned" },
      { name: "Timetable extraction", detail: "Image/PDF parsing with user confirmation before any schedule write.", status: "planned" },
      { name: "Document consistency checks", detail: "OCR names, file integrity and provider signals; uncertainty stays pending.", status: "planned" },
      { name: "Forgery policy", detail: "AI never declares a legal identity genuine on its own; licensed signals and manual review decide.", status: "planned" },
      { name: "Cost controls", detail: "Per-user/global quotas, provider kill switch and usage audit.", status: "done", evidence: "app_private.provider_controls" },
    ],
  },
  {
    id: "operations",
    number: "08",
    title: "Admin intelligence, moderation & retention",
    objective: "Give authorised staff useful evidence without creating unchecked surveillance.",
    status: "planned",
    reviewGate: "Least privilege, purpose limitation, retention schedule, exports and incident response are signed off.",
    items: [
      { name: "Product analytics", detail: "Consent-aware page time, streaks and feature events in Neon; no NIN or document payloads.", status: "in_progress", evidence: "database/neon/" },
      { name: "User activity view", detail: "Purpose-scoped timeline, booked events, likes and account state with audited access.", status: "planned" },
      { name: "Moderation console", detail: "Content reports, product suspension, user/agent bans, reasons and appeals.", status: "planned" },
      { name: "Account closure", detail: "Immediate access removal plus documented lawful retention/anonymisation—not hidden indefinite storage.", status: "planned" },
      { name: "Data requests", detail: "Export, correction, deletion eligibility and legal-hold workflows.", status: "planned" },
    ],
  },
  {
    id: "release",
    number: "09",
    title: "Pilot release & scale gates",
    objective: "Ship a measurable UNIBEN pilot with rollback, support and cost safety.",
    status: "planned",
    reviewGate: "Mobile builds, domain/TLS, backup restore, security, accessibility and pilot support drills pass.",
    items: [
      { name: "Separate production URLs", detail: "ops.kampusone.app, agents.kampusone.app, build.kampusone.app and api.kampusone.app.", status: "in_progress" },
      { name: "Mobile release", detail: "EAS build profiles, signing, store metadata and staged rollout.", status: "planned" },
      { name: "Observability", detail: "Cloudflare logs, error reporting, Neon/Supabase health and user-safe incident messaging.", status: "planned" },
      { name: "Recovery", detail: "Database restore test, storage recovery, key rotation and rollback runbooks.", status: "planned" },
    ],
  },
];

export const requirements = [
  { phase: "Release gate", name: "Approve the Phase 1 Supabase production migration", status: "needs_input" as const, owner: "Product owner", detail: "The additive migration passed a full rollback validation. Production RLS, grants, private Storage policies and UNIBEN seed records remain unchanged until you explicitly approve the live apply.", location: "database/supabase/migrations/20260910090000_identity_onboarding_agent_verification.sql" },
  { phase: "Now", name: "Supabase mobile/web environment", status: "needs_input" as const, owner: "Engineering configuration", detail: "Set the project URL and publishable key in Expo/Vercel. Keep the secret key only in Cloudflare.", location: "Expo EAS, Vercel and Cloudflare encrypted environment settings" },
  { phase: "Now", name: "Neon Worker connection", status: "needs_input" as const, owner: "Engineering configuration", detail: "Use the Phase 1 branch connection string for preview analytics. Create a least-privilege writer before production.", location: "Cloudflare secret: NEON_DATABASE_URL" },
  { phase: "Now", name: "Cloudflare deploy credentials", status: "needs_input" as const, owner: "Repository owner", detail: "Confirm the GitHub environment contains CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.", location: "GitHub Actions environment secrets" },
  { phase: "Now", name: "Dedicated portal domains", status: "needs_input" as const, owner: "Domain owner", detail: "Attach ops, agents and build domains to the Vercel project and point Cloudflare DNS at Vercel.", location: "Cloudflare DNS + Vercel Domains" },
  { phase: "Optional", name: "Lovable design collaboration credits", status: "needs_input" as const, owner: "Lovable workspace owner", detail: "The first mobile design pass completed. More Lovable-generated prototype routes require workspace credits, but this does not block the production codebase.", location: "Lovable workspace billing" },
  { phase: "Pilot", name: "Branded email", status: "planned" as const, owner: "Product owner", detail: "Choose Resend or another SMTP provider and verify kampusone.app for OTP and recovery mail.", location: "Supabase Auth SMTP + provider dashboard" },
  { phase: "Events & commerce", name: "Payment provider", status: "blocked" as const, owner: "Business/compliance", detail: "Choose Paystack or Flutterwave, finish settlement/KYC decisions and provide sandbox credentials first.", location: "Cloudflare encrypted secrets" },
  { phase: "Riders", name: "Licensed Nigerian identity provider", status: "blocked" as const, owner: "Business/compliance", detail: "A provider contract and privacy assessment are required. Do not send NIN to a generic AI model.", location: "Server-only provider adapter" },
  { phase: "Maps", name: "Map tiles and directions", status: "planned" as const, owner: "Product owner", detail: "Select Mapbox, MapTiler or equivalent after campus-place data is ready.", location: "Public map token + server-restricted directions key" },
  { phase: "AI", name: "Model gateway", status: "planned" as const, owner: "Product owner", detail: "Add only after quotas, retention and evaluation datasets pass review.", location: "Cloudflare encrypted secrets" },
  { phase: "Mobile pilot", name: "Push and app signing", status: "planned" as const, owner: "Product owner", detail: "Expo/EAS access plus Apple/Google notification and signing credentials are needed for device tests.", location: "Expo EAS credential store" },
] as const;

export const buildNotes = [
  { date: "10 Sep", title: "Lovable first pass incorporated", body: "The initial mobile design pass was used to cross-check palette, onboarding hierarchy, motion and tactile feedback. The production implementation remains in the Campus One repository; the follow-up Lovable run is paused only because its workspace has no credits." },
  { date: "10 Sep", title: "Neon is included without duplicating identity", body: "Supabase remains the source of truth for auth, permissions, private files and transactional campus records. Neon receives consent-aware product analytics and later reporting/read models through Cloudflare only." },
  { date: "10 Sep", title: "Legacy Neon schema preserved", body: "The existing production branch contains older public and kampusone_v12 tables. Phase 1 uses a child branch and a separate schema so no prior work is overwritten." },
  { date: "10 Sep", title: "Uncertain verification remains pending", body: "OCR or AI mismatches can request manual review. Only deterministic policy/provider failures can reject, and an authorised operator can override with an audited reason." },
  { date: "10 Sep", title: "Admin security is role-based", body: "A difficult URL is not treated as protection. The operations URL is less public, but authentication, institution scope, RLS and audit logs are the actual controls." },
  { date: "10 Sep", title: "Account closure follows lawful retention", body: "Access can end immediately while narrowly required records follow a published retention schedule or legal hold. Campus One will not secretly keep every activity forever." },
];
