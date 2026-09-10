export type DeliveryStatus = "complete" | "building" | "blocked" | "planned";

export type RoadmapTask = {
  title: string;
  detail: string;
  status: DeliveryStatus;
  evidence?: string;
};

export type RoadmapPhase = {
  id: string;
  number: string;
  title: string;
  objective: string;
  status: DeliveryStatus;
  progress: number;
  tasks: RoadmapTask[];
  requirements: string[];
  note: string;
};

export const roadmap: RoadmapPhase[] = [
  {
    id: "foundation",
    number: "00",
    title: "Platform foundation",
    objective: "Put one secure, low-cost modular platform beneath every KampusOne surface.",
    status: "complete",
    progress: 100,
    tasks: [
      { title: "Monorepo and contracts", detail: "Expo app, Next.js portals, Hono Worker and shared TypeScript contracts.", status: "complete", evidence: "AGENTS.md · packages/contracts" },
      { title: "Supabase data foundation", detail: "Institution-aware academic schema, RLS, audit log, provider controls and idempotency tables.", status: "complete", evidence: "database/migrations" },
      { title: "Cloudflare Worker baseline", detail: "Live/readiness health routes, public configuration and safe-off feature flags.", status: "complete", evidence: "server/src · server/wrangler.jsonc" },
      { title: "Brand and interface system", detail: "Official assets, KampusOne tokens, Inter product type and Lato headings.", status: "complete", evidence: "packages/design-tokens" },
    ],
    requirements: [],
    note: "The foundation is intentionally a modular monolith: easier to operate now, with clean module boundaries for later scale.",
  },
  {
    id: "identity",
    number: "01",
    title: "Student entry and identity",
    objective: "Let a student understand the product, create an account, verify email and complete campus onboarding.",
    status: "building",
    progress: 78,
    tasks: [
      { title: "Illustrated product introduction", detail: "Three branded, reduced-motion-friendly onboarding stories and preview entry.", status: "complete", evidence: "mobile/app/index.tsx · mobile/assets/onboarding" },
      { title: "Authentication screens", detail: "Sign-up, password login, email OTP, resend timing, recovery and real Supabase client wiring.", status: "complete", evidence: "mobile/app/sign-*.tsx · mobile/src/auth" },
      { title: "Academic profile onboarding", detail: "Institution, programme, level, matriculation details and permission education.", status: "building", evidence: "mobile/app/onboarding.tsx" },
      { title: "Production email delivery", detail: "Branded OTP and recovery email through custom SMTP with verified sender domain.", status: "blocked" },
      { title: "Identity acceptance tests", detail: "New user, returning user, expired OTP, recovery, logout and tenant isolation evidence.", status: "planned" },
    ],
    requirements: ["Verified UNIBEN academic catalogue and named data owner", "Custom SMTP/Resend credentials and verified sending domain", "Pilot admin and agent account emails"],
    note: "The flow is real where configuration exists and clearly enters preview mode when it does not. No secret key is shipped in the app.",
  },
  {
    id: "academic-core",
    number: "02",
    title: "Student academic core",
    objective: "Make the daily utility valuable before social, commerce or paid features expand.",
    status: "building",
    progress: 36,
    tasks: [
      { title: "Today and timetable", detail: "Daily schedule, reminders, week view and direct academic navigation.", status: "building", evidence: "mobile/app/(tabs)/today.tsx · timetable.tsx" },
      { title: "GPA workspace", detail: "Five-point GPA calculation, course rows and semester history stored on device.", status: "complete", evidence: "mobile/app/gpa.tsx" },
      { title: "Academic tools navigation", detail: "Dedicated hub for timetable, GPA, tutorial discovery and AI summary.", status: "complete", evidence: "mobile/app/study-tools.tsx" },
      { title: "Course and timetable persistence", detail: "Student-owned schedules synced under Supabase RLS with offline cache.", status: "planned" },
      { title: "Campus directory and map", detail: "Searchable places first; live positioning only after consent and provider limits.", status: "planned" },
    ],
    requirements: ["Approved course, venue and timetable source", "Decision on campus map tiles/directions provider", "Expo organization/project for background reminder delivery"],
    note: "The navigation problem is resolved with a five-tab daily shell plus a dedicated Study tools hub, keeping the bottom bar calm.",
  },
  {
    id: "operations",
    number: "03",
    title: "Operations and agent verification",
    objective: "Accept agent applications, protect documents, assist checks and leave final authority with audited operators.",
    status: "building",
    progress: 38,
    tasks: [
      { title: "Separate agent application portal", detail: "Apply, save progress, upload required evidence and track status at the agent host.", status: "complete", evidence: "portal/app/agents · portal/components/agent-application.tsx" },
      { title: "Admin review queue", detail: "Pending, needs-review, failed and approved views with reason codes and human override through the Worker.", status: "complete", evidence: "portal/app/admin · server/src/app.ts" },
      { title: "Private document vault", detail: "Private bucket, signed two-minute viewing, MIME/size rules and applicant/operator RLS. Malware scan and retention jobs remain gated.", status: "building", evidence: "database/supabase/migrations/20260910093000_agent_applications.sql" },
      { title: "Assisted document checks", detail: "OCR/name match, metadata/anomaly signals and NIN match. Uncertain evidence stays pending—AI never proves genuineness by itself.", status: "planned" },
      { title: "Agent permissions and suspension", detail: "Institution/workflow-scoped capabilities, suspension, ban, escalation and immutable audit events.", status: "planned" },
    ],
    requirements: ["Choose and contract a Nigerian NIN verification provider", "Document checklist, accepted evidence and escalation owner", "Retention, deletion and legal-hold policy", "OCR/document-risk provider credentials later in this phase"],
    note: "Obscure URLs are not treated as security. Separate hosts, authentication, role claims, tenant scope and audit evidence protect the portals.",
  },
  {
    id: "community",
    number: "04",
    title: "Feed, inbox and campus graph",
    objective: "Create a useful campus information layer without turning the product into unrestricted private messaging.",
    status: "planned",
    progress: 9,
    tasks: [
      { title: "Campus feed", detail: "Text, photo, video and poll posts with like, comment and share actions.", status: "planned" },
      { title: "Official publishing", detail: "Visually distinct KampusOne posts, verified badges, blogs and campus-wide announcements.", status: "planned" },
      { title: "Follow and mutual context", detail: "Profiles show department, level, followers and department-based mutuals without exposing private records.", status: "planned" },
      { title: "Service inbox", detail: "Admin, vendor, tutor, event and rider threads; no classmate-to-classmate direct messages.", status: "building", evidence: "mobile/app/inbox.tsx" },
      { title: "Moderation and safety", detail: "Report, block, takedown, rate limits, media review and audit trails.", status: "planned" },
    ],
    requirements: ["Community rules and moderation escalation matrix", "Media storage/transcoding budget and provider decision", "Notification copy and quiet-hour policy"],
    note: "The feed remains a campus utility surface: official information and trusted activity come before engagement mechanics.",
  },
  {
    id: "learning",
    number: "05",
    title: "Tutorials and learning marketplace",
    objective: "Let verified creators and KampusOne sell useful learning materials with academic tools nearby.",
    status: "planned",
    progress: 8,
    tasks: [
      { title: "Tutor and material discovery", detail: "Search, filters, profiles, availability and verified learning offers.", status: "building", evidence: "mobile/app/(tabs)/tutorials.tsx" },
      { title: "Digital products", detail: "Video, PDF, audio and course products with preview, ownership and access records.", status: "planned" },
      { title: "Creator workspace", detail: "Upload, pricing, draft/publish, orders and earnings visibility.", status: "planned" },
      { title: "Admin commerce controls", detail: "Suspend listings or accounts, record reasons, appeal and preserve transaction evidence.", status: "planned" },
    ],
    requirements: ["Seller terms, copyright/takedown policy and price rules", "Private media delivery and transcoding provider", "Finance owner and refund rules before paid access"],
    note: "Paid learning remains behind a gate until ownership, takedown and refund paths are testable end to end.",
  },
  {
    id: "events",
    number: "06",
    title: "Events, reservations and tickets",
    objective: "Support display-only events, free reservations and paid ticketed events as distinct workflows.",
    status: "planned",
    progress: 0,
    tasks: [
      { title: "Three event modes", detail: "Display only, free reservation and paid ticket experiences with explicit state labels.", status: "planned" },
      { title: "Organizer workspace", detail: "Create via shareable URL, monitor bookings and export permission-aware CSV data.", status: "planned" },
      { title: "Ticket identity", detail: "Unique ticket ID, QR verification, attendee card and image/social sharing.", status: "planned" },
      { title: "Paid event reporting", detail: "Orders, attendees, revenue, refunds and organizer earnings backed by the ledger.", status: "planned" },
    ],
    requirements: ["Event publishing and cancellation rules", "Organizer verification requirements", "Ticket refund/transfer policy", "Payment provider activation in Phase 08"],
    note: "Reservation and payment are separate state machines so a free RSVP can never be mistaken for a paid ticket.",
  },
  {
    id: "delivery",
    number: "07",
    title: "Marketplace, vendors and riders",
    objective: "Move a paid order from a verified vendor to a nearby eligible rider and safely to the customer.",
    status: "planned",
    progress: 0,
    tasks: [
      { title: "Vendor catalogue and orders", detail: "Product listings, inventory, paid order queue and fulfilment handoff.", status: "planned" },
      { title: "Rider onboarding", detail: "Student/non-student evidence, NIN match, approved profile fields and suspension controls.", status: "planned" },
      { title: "Nearby dispatch", detail: "Coarse H3-style service cells, availability and expiring offers—never a public map of all riders.", status: "planned" },
      { title: "Delivery state machine", detail: "Offer, accept, collect, in transit, proof of delivery, dispute and cancellation.", status: "planned" },
      { title: "Customer tracking", detail: "Show the assigned rider and delivery progress with privacy-safe contact details.", status: "planned" },
    ],
    requirements: ["NIN provider and rider safety policy", "Delivery zones, fees and incident escalation owner", "Campus location data and maps decision", "Insurance/liability and prohibited-goods policy"],
    note: "Location matching will use bounded service cells and short retention, not continuous surveillance of students or riders.",
  },
  {
    id: "payments",
    number: "08",
    title: "Payments, revenue and ledger",
    objective: "Make every naira explainable across tickets, learning products, marketplace orders, fees and payouts.",
    status: "planned",
    progress: 0,
    tasks: [
      { title: "Paystack checkout", detail: "Server-created transactions, verified webhooks and idempotent order settlement.", status: "planned" },
      { title: "Append-only ledger", detail: "Charges, fees, refunds, reversals and earnings as immutable balanced entries.", status: "planned" },
      { title: "Seller and organizer earnings", detail: "Available/pending balances, statements, payout review and reconciliation.", status: "planned" },
      { title: "Disputes and refunds", detail: "Reasoned workflows, evidence, approval limits and permanent audit history.", status: "planned" },
    ],
    requirements: ["Paystack business account and restricted credentials", "Fee schedule, payout timetable and refund policy", "Finance operator and reconciliation process", "Legal review of marketplace money flow"],
    note: "No balance is computed from mutable order fields; money movement will be derived from the append-only ledger.",
  },
  {
    id: "ai",
    number: "09",
    title: "AI study assistance",
    objective: "Add note summaries and timetable assistance only with visible limits, privacy controls and predictable cost.",
    status: "planned",
    progress: 7,
    tasks: [
      { title: "Dedicated AI summary page", detail: "Upload entry, clear locked state and provider-readiness explanation—not a hidden hover action.", status: "complete", evidence: "mobile/app/ai-summary.tsx" },
      { title: "Private document pipeline", detail: "Signed upload, extraction, deletion schedule and no-training contract.", status: "planned" },
      { title: "Summary service", detail: "Quota, timeout, idempotency, content limits, kill switch and observable failures.", status: "planned" },
      { title: "Timetable extraction", detail: "AI proposes structured courses; the student confirms every imported item before save.", status: "planned" },
    ],
    requirements: ["Approved AI provider and data-processing terms", "Monthly/student quota and maximum file-size decision", "Retention policy for uploaded notes", "Provider API key only when this phase reaches integration"],
    note: "AI output is assistance, never authority. A provider outage must leave core timetable and study tools usable.",
  },
  {
    id: "insight",
    number: "10",
    title: "Analytics, safety and privacy operations",
    objective: "Measure product usefulness and operate bans, retention and legal requests without collecting data merely because we can.",
    status: "planned",
    progress: 0,
    tasks: [
      { title: "Product analytics", detail: "Consent-aware page time, feature use, streaks, likes and bookings with documented purpose and expiry.", status: "planned" },
      { title: "User activity view", detail: "Institution-scoped operator view with field-level access, reasons and audit logs.", status: "planned" },
      { title: "Safety controls", detail: "Suspend, ban, reinstate, content takedown and appeal across users, agents and sellers.", status: "planned" },
      { title: "Account deletion", detail: "Immediate access removal, lawful retention/legal hold where required, then scheduled deletion or anonymisation—not secret indefinite storage.", status: "planned" },
    ],
    requirements: ["Privacy notice and explicit analytics purposes", "Retention schedule by data category", "Legal-hold and data-subject request owner", "Safety review and appeal service levels"],
    note: "Keeping deleted-user data secretly and indefinitely is not an acceptable product pattern. The design preserves only documented legal/financial evidence for a defined period.",
  },
  {
    id: "release",
    number: "11",
    title: "Pilot, hardening and multi-campus release",
    objective: "Prove UNIBEN safely, then onboard the next institution without rewriting the platform.",
    status: "planned",
    progress: 0,
    tasks: [
      { title: "End-to-end pilot", detail: "Role, tenant, offline, recovery, accessibility, load and rollback evidence on real devices.", status: "planned" },
      { title: "Operational runbooks", detail: "Incident response, provider outage, compromised account, backup and recovery drills.", status: "planned" },
      { title: "Store and web release", detail: "Expo/EAS builds, Cloudflare app/API, Vercel portals and monitored domain cutover.", status: "planned" },
      { title: "Second institution", detail: "Tenant configuration and import—not hard-coded forks—to prove the architecture.", status: "planned" },
    ],
    requirements: ["Pilot cohort and acceptance owners", "Expo, Cloudflare and Vercel production access", "Support rota and incident contacts", "Second-campus launch criteria"],
    note: "UNIBEN is tenant one, not a permanent hard-coded assumption.",
  },
];

export const requirementRegister = [
  { group: "Connected", status: "complete" as const, items: ["Supabase project, application migrations, private bucket and RLS", "KampusOne brand assets and design tokens", "GitHub repository and verification workflow"] },
  { group: "Needed in Phase 01", status: "blocked" as const, items: ["Verified academic catalogue + data owner", "Custom SMTP/Resend key + verified sender domain", "Pilot admin and agent account emails"] },
  { group: "Needed for deployment", status: "blocked" as const, items: ["Cloudflare account ID + scoped API token + DNS access", "Three Vercel projects/domains: ops, agents and build", "Expo organization/project access for device builds and push"] },
  { group: "Needed in later gates", status: "planned" as const, items: ["NIN identity provider", "Maps/directions provider", "Paystack business credentials", "AI provider and quota", "Media processing/storage policy"] },
];

export const deploymentMap = [
  { surface: "Student app", target: "app.kampusone.app", runtime: "Expo web on Cloudflare + native EAS", boundary: "Student session + RLS" },
  { surface: "Privileged API", target: "api.kampusone.app", runtime: "Hono on Cloudflare Workers", boundary: "Server-only provider secrets" },
  { surface: "Operations", target: "ops.kampusone.app", runtime: "Dedicated Vercel project", boundary: "Operator auth + scoped capabilities" },
  { surface: "Agent portal", target: "agents.kampusone.app", runtime: "Dedicated Vercel project", boundary: "Applicant/agent auth + assignments" },
  { surface: "Build tracker", target: "build.kampusone.app", runtime: "Dedicated Vercel project", boundary: "Read-only project visibility" },
  { surface: "Data", target: "Private service", runtime: "Supabase Postgres, Auth and Storage", boundary: "Institution tenant + RLS" },
];
