# KampusOne — Master Product Correction, Admin Operations and Implementation Prompt

## 1. Your assignment

Act as the product architect and engineering lead responsible for correcting KampusOne across the student app, web preview, admin website, agent portal, APIs, authentication, academic data and operational workflows.

This is not a request for a cosmetic redesign or another small admin dashboard. Turn the 241 numbered requirements below into an evidence-based implementation programme, with working backend behaviour, appropriate interfaces, permissions, data models, tests and deployment checks.

**My highest design priority is a large, feature-rich admin platform with a genuinely substantial sidebar. I want many meaningful sections and subsections, not five basic links and a few statistic cards. Do not simplify away the administrative capabilities I am requesting.**

KampusOne must support students from different Nigerian universities from the beginning. UNIBEN is the initial campus with the deepest operational support; it is not the only institution that can register, and its academic structure must not become everybody else's default.

The numbered inventory contains reported defects, requested features and supporting implementation requirements. Do not describe all 241 as independently reproduced bugs. Verify their status. Keep their IDs even where several requirements share one implementation.

### Working mode and authority

Start with research, inspection and an implementation plan. Reading this prompt alone does not authorize production deletion, payment execution, mass email, account suspension or deployment. Produce the initial deliverables in Section 9, then proceed with implementation when I approve the build stage.

During an approved implementation stage, make actual changes where tools and access permit. Do not stop at generic advice, but do not pretend to have edited code, configured a provider, sent a test or deployed something you have not actually done. Research-only work must be labelled as research-only.

Do not request that I repeat this brief. Ask only targeted questions about genuinely unresolved decisions or missing access that inspection cannot resolve. Preserve a clear checkpoint when work must continue in another session.

## 2. Sources, design direction and existing architecture

Read the attached university PDFs, school guidelines, brand guidelines, design tokens, product/architecture documents and screenshots before making decisions that depend on them. Identify what was actually available and read; do not claim to have processed missing attachments.

My latest explicit instructions in this brief define the updated product direction. Older documents remain background, not an excuse to restore features or restrictions I have rejected. Record conflicting instructions in a decision log rather than silently reconciling them. For example, old release boundaries must not silently override the current requirement for ordinary-student posting.

Treat academic sources differently from product preferences: preserve what the university documents actually say. Record source filename, page, issuing institution, document date and applicable cohort/session wherever available. Distinguish source statements, implementation proposals and externally verified updates.

When external verification is needed, consult current official documentation and authoritative institutional sources. Check present provider capabilities, pricing, configuration requirements and restrictions instead of relying on outdated tutorials. Cite the sources used. Do not claim that the PDF collection covers every Nigerian university unless coverage has been checked.

### Visual references

Use the two supplied desktop admin references for their navigation breadth, density, hierarchy, tables, reporting and operational workspaces. Do not copy their branding, sample figures, irrelevant HR sections or decorative filler.

Use the supplied X-style composer reference for its open writing area, avatar, audience control, accessible Post action and compact media toolbar. Replace its prompt with **“What's happening on campus?”** and apply KampusOne's identity. Do not recreate X's blue theme.

Use the existing approved logo and brand assets without distortion. Resolve older and newer typography/token differences before finalizing the design. My present direction is warm cream and branded brown/terracotta, a brown verification badge, restrained illustrations, readable type and light mode by default. Do not introduce random green settings toggles or a blue verification badge.

Orange markings on my screenshots are annotations identifying problems, not assets to reproduce.

### Architecture to inspect, not blindly assume

My stated direction includes the Expo/React Native student app and web preview, Cloudflare Workers for backend services, Supabase for authentication, Neon for application data, Resend for email, Hugging Face for timetable-related AI, and Gemini for study-related AI. Verify the repository and deployed configuration before declaring this to be the actual architecture.

Do not migrate databases, replace authentication or duplicate user identities merely to match an assumption. Propose and document the integration boundary between Supabase identity and the application's data store. Preserve the existing working functionality and data.

Confirm the canonical owned domain and existing hosts before changing DNS. My intention is one KampusOne ecosystem, not accidental separate products caused by inconsistent domain spelling.

## 3. Non-negotiable admin architecture

**Build a substantial administration and operations website. Its full sidebar should be long, grouped, searchable and expandable, with features and subfeatures visible to the Super Admin. A tiny dashboard is not an acceptable interpretation of this request.**

A large sidebar does not mean putting every widget on the homepage. Give each operational domain its own workspace. Do not fill the navigation with dead links just to make it look large. Distinguish planned modules from implemented modules in the internal build tracker; customer-facing routes must never pretend to work.

Use the following as the proposed minimum navigation architecture. Supporting subpages not explicitly listed among the 241 requirements are architecture proposals: identify their dependencies and agree their delivery tranche, without disguising them as already-working features.

```text
ADMIN / OPERATIONS

Overview
  Operational overview · Pending work · Alerts · Recent activity · Saved views

Universities & Campuses
  All universities · University workspace · Campuses · Campus availability
  Faculties/colleges · Departments · Programmes/degrees · Programme durations
  Sessions/cohorts · Academic calendars · Missing-data submissions
  Source documents · Import batches · Data corrections

Students & Users
  All users · Profiles and media · Academic profiles · Account status
  Verification badges · Role memberships · University transfers
  Account assistance · Restricted accounts · Privacy requests

Staff & Access
  Staff accounts · Invitations · Roles · Permission matrix · University scopes
  Access changes · Privileged sessions · Staff activity · Audit trail

Agents & Applications
  All agents · New applications · Incomplete applications · Pending review
  Document review · Automated checks · Flagged applications · Manual review
  Bulk decisions · Rejections/resubmissions · Approval history

Vendors & Stores
  Vendors · Storefronts · Store verification · Seller tiers
  Trial claims · Trial expiry · Store status · Seller issues

Tutors & Learning Services
  Tutors · Courses/subjects · Levels taught · Tutor applications
  Teaching offers · Materials · Tutor activity · Tutor issues

Riders & Delivery
  Riders · Rider applications · Bike documents · Service campuses
  Rider status · Delivery activity · Rider issues

Marketplace
  Products · Categories · Media · Inventory · Orders · Buyers
  Cancellations · Refund requests · Disputes · Product moderation

Feeds & Publishing
  All posts · Student posts · Publisher posts · Media
  Polls · Q&A · Anonymous Q&A · Reports · Scheduled publishing
  Removed content · Appeals · Publishing personas

Academic Tools
  Timetables · Import jobs · Parsing review · Shared schedules
  GPA/CGPA configurations · Course data · Academic rules · Alarms/reminders

Campus Guidelines & Knowledge
  University guidelines · Faculty rules · Department rules
  Source library · Versions · Effective dates · Review queue · Corrections

AI Operations
  Timetable AI · Study AI · Provider health · Job queue
  Failures/retries · Usage · Quotas · Rate limits · Cost controls
  Model configuration · Quality review · Privacy/retention controls

Verification & Trust
  Badge grants · Badge revocations · Verification categories
  Identity review · Inconsistency flags · Overrides · Decision history

Revenue & Finance
  Revenue overview · Transactions · Fees/commissions
  Refunds · Reconciliation · Financial exceptions · Finance exports

Payouts
  Payout setup · Bank resolution · Name mismatches · Eligible agents
  Payout requests · Approval queue · Batches · Failed payouts · Payout history

Email & Broadcasts
  Campaigns · Drafts · Audience segments · Individual messages
  Templates · Sender personas · Test sends · Scheduled campaigns
  Delivery events · Bounces · Complaints · Suppression/preferences

Notifications
  Notification centre · Templates · Device registrations
  Test notification · Delivery attempts · Receipts · Failed deliveries

Analytics
  Acquisition · Active users · Retention · Screen visits · Feature usage
  University comparisons · Marketplace activity · Agent funnels
  AI usage · Notification engagement · Reports · Event-quality checks

Support & Moderation
  Support inbox · User reports · Content cases · Agent issues
  Buyer/seller disputes · Escalations · Appeals · Case history

Security & Privacy
  Authentication events · Privileged access · Suspicious activity
  Data-access history · Sensitive exports · Retention · Deletion requests

System & Integrations
  API health · Database connectivity · Auth integration · Email integration
  AI providers · Storage/media · Background jobs · Error logs
  Configuration status · Webhooks · Deployments · Incident notes

Product Controls
  Feature flags · University rollout · Role capabilities · Plans/entitlements
  Trial policies · Limits · Brand settings · Maintenance controls

Implementation Tracker
  All 241 requirements · Phases · Dependencies · Blockers
  Test evidence · Release history · Outstanding decisions
```

### Navigation and page behaviour

Provide expandable groups, navigation search, favourites, breadcrumbs, an obvious active state, preserved sidebar scroll and an expand-all option. The Super Admin must be able to explore the full catalogue. Restricted staff see only their authorized workspaces.

Include a persistent **All universities / selected university** context. Make scope visible beside sensitive actions. Switching university must scope queries, charts, lists, exports, caches and operations—not merely change a heading. Staff must not acquire access to another university by editing an address or request parameter.

Provide consistent operational tables with server-backed filtering, sorting, pagination, saved views, selected-row actions and authorized exports. Put dangerous bulk actions behind a review step showing precisely which records will be affected.

The homepage should prioritize real metrics, pending agent reviews, academic-data submissions, operational failures and recent administrative activity. Do not fabricate revenue, growth, traffic, uptime or recent users. Never present missing data as zero activity.

Use a central navigation/module registry linking each workspace to its route, permissions, university scope, feature flag and loading/empty/error behaviour. A permission toggle must control real authorization, not just hide a sidebar link.

## 4. Complete 241-item requirements register

Preserve the following numbering in implementation plans, commits or change notes, tests and progress tracking. Subtasks may be added without renumbering or deleting an original requirement.

### A. Super Admin / Operations Platform — 1–41

1. **Admin redesign:** Replace the inadequate admin UI/UX with a coherent, usable operational interface rather than superficial restyling.
2. **Platform scale:** Structure admin as a substantial operational website, not a small dashboard attached to the student app.
3. **Reference-led layout:** Apply the supplied desktop references to hierarchy, information density and workspace structure while retaining KampusOne branding.
4. **Substantial sidebar:** Provide the large, organized feature and subfeature navigation described above; do not reduce it to a few generic links.
5. **University management:** Create a dedicated Universities section with real institution records and management workflows.
6. **University drill-down:** Open an institution to inspect its students, campuses, faculties, departments, programmes, agents and activity.
7. **University analytics:** Provide both cross-university comparisons and properly scoped institution-level analytics.
8. **Screen analytics:** Instrument screen visits so the most-used screens can be measured accurately.
9. **Tool analytics:** Instrument feature/tool usage so useful tools and failing workflows can be identified.
10. **Engagement events:** Capture relevant product activity using a documented event scheme and appropriate privacy controls.
11. **Reporting:** Build useful trends, charts, filters and reports, not only disconnected headline counters.
12. **Admin hostname:** Configure a non-obvious randomized admin subdomain on the confirmed owned domain; do not treat obscurity as the security control.
13. **Private admin entry:** Provide sign-in for provisioned administrators; remove public Super Admin registration prompts.
14. **Staff provisioning:** Allow the Super Admin to invite/create additional administrator accounts securely.
15. **Role-based access:** Implement enforceable role-based permissions for administrative functions.
16. **Module permissions:** Allow explicit selection of the modules an administrator may access.
17. **Action permissions:** Separate viewing, creating, editing, managing, approving, rejecting, deleting, exporting and other sensitive capabilities.
18. **Restricted workspaces:** Support a Revenue-and-Analytics-only employee without exposing users, identity documents or unrelated operations.
19. **Staff management:** Manage staff activation, suspension, role changes, access revocation and account status from Super Admin.
20. **Auditability:** Record administrative actors, actions, targets, timestamps and relevant reasons/change details in protected audit records.
21. **User management:** Build searchable, filterable user administration with meaningful account information and controlled actions.
22. **Profile pictures:** Display real user avatars in administrative lists and profile views.
23. **Profile inspection:** Allow authorized inspection of profile and cover photographs, with appropriate moderation and access controls.
24. **Role visibility:** Show whether a user is a student, agent, vendor, tutor, rider, publisher or staff member without creating disconnected identities.
25. **Agent management:** Provide a dedicated agent workspace with status, applications, activity and management actions.
26. **Vendor management:** Provide a dedicated seller/vendor workspace rather than burying vendors in a generic users list.
27. **Tutor management:** Provide tutor-specific records, teaching information, materials and operational actions.
28. **Rider management:** Provide rider-specific records, documents, campus coverage and operational actions.
29. **Marketplace operations:** Support real product, store, order and marketplace management workflows.
30. **Feed operations:** Support publishing oversight, reports, moderation and content-management workflows.
31. **AI operations:** Provide AI health, usage, failures and controlled administrative tooling.
32. **Academic-data operations:** Manage academic structures, supporting documents, corrections and pending submissions.
33. **Feature controls:** Provide controlled feature availability and configuration without relying on scattered hard-coded conditions.
34. **Finance operations:** Provide revenue and payout administration with separate sensitive permissions.
35. **System monitoring:** Provide meaningful health and operational monitoring based on observed data.
36. **Support management:** Provide a support/issues workspace with status, assignment and resolution history.
37. **Security monitoring:** Provide controlled authentication and security-event monitoring.
38. **Manual verification:** Allow authorized Super Admin verification of any account through an explicit, auditable workflow.
39. **Verification controls:** Allow granting, changing and revoking verification status through admin.
40. **Brown badge:** Use the approved custom brown KampusOne verification badge, not a blue badge.
41. **Cross-role verification:** Support verification for students/publishers, vendors, tutors, riders and relevant agent categories.

### B. Email & Communications — 42–53

42. **Broadcast workspace:** Build a functioning Email Broadcast section in admin.
43. **Individual email:** Send an authorized operational message to one selected person.
44. **All-user communication:** Support an all-user audience with appropriate campaign safeguards.
45. **Agent audience:** Target relevant agents, including agent-type and status filters.
46. **Seller audience:** Target vendors/sellers or selected seller cohorts.
47. **Buyer audience:** Target appropriate buyer/customer segments without unrestricted personal-data exports.
48. **Tutor audience:** Target tutors and relevant tutoring cohorts.
49. **Staff audience:** Communicate with selected administrators or staff groups.
50. **Custom segments:** Support additional legitimate segments such as university, faculty, department or account state.
51. **Promotional campaigns:** Support promotional messaging with subscription preferences and suppression handling.
52. **Human-facing sender:** Support the approved sender display identity, such as “Jeffrey from KampusOne.”
53. **Campaign operations:** Provide templates, audience previews, test sends, scheduling and delivery-event reporting.

### C. Demo / Placeholder Content — 54–64

54. **Demo products:** Remove identified demo marketplace products from the live experience safely.
55. **Demo cart:** Remove demo cart content and demo-specific messaging; do not disguise non-working checkout as live commerce.
56. **Demo PDFs:** Remove identified placeholder/demo PDFs from live libraries and listings.
57. **Demo materials:** Remove demo learning materials and associated misleading availability.
58. **Fake activity:** Remove seeded histories, fake engagement and fabricated activity from live user experiences.
59. **Demo interface:** Remove demo labels and demo-only components after their underlying records/workflows are appropriately handled.
60. **Personal examples:** Stop hard-coding the founder's identity or personal details into other users' accounts and examples.
61. **Academic defaults:** Remove assumptions that every user studies Computer Engineering at UNIBEN in 200 level.
62. **Connection placeholders:** Replace “This service is being connected” with functioning behaviour or truthful actionable states.
63. **Posting placeholder:** Replace the “Posting is being connected” experience with an actual publishing workflow and proper failures.
64. **Honest availability:** Make features work; temporary gating may protect users but must remain a tracked blocker, not a completed fix.

### D. Platform Personas — 65–69

65. **Public author identity:** Stop labeling all platform-managed publishing simply as “Admin.”
66. **Marketplace persona:** Support a verified, platform-managed marketplace identity such as Stella.
67. **Learning persona:** Support a platform-managed tutorial/material publishing identity such as Michael.
68. **Email persona:** Support Jeffrey from KampusOne as an approved email display identity.
69. **Persona governance:** Preserve the actual staff actor and platform ownership internally; do not manufacture independent customers or testimonials.

### E. Feed & Student Posting — 70–86

70. **Ordinary-student access:** Enable posting for ordinary student accounts without requiring publisher verification.
71. **Text publishing:** Allow ordinary students to publish text with real validation and persistence.
72. **Image publishing:** Allow students to attach and publish supported images.
73. **Video publishing:** Allow students to attach and publish supported videos.
74. **Media previews:** Show selected media before publishing, with removal and appropriate preview controls.
75. **Composer redesign:** Use the supplied X-style interaction layout rather than a giant boxed textarea and stacked oversized buttons.
76. **Campus prompt:** Use “What's happening on campus?” as the main composer prompt.
77. **KampusOne styling:** Apply approved colours, typography, icons and spacing rather than X's branding.
78. **Media toolbar:** Provide a compact, clear attachment toolbar with usable gallery/camera/video actions.
79. **Publisher capabilities:** Grant richer publishing formats through explicit account capabilities checked by the server.
80. **Polls:** Support eligible publishers creating polls with options, voting rules and results.
81. **Q&A:** Support question posts and a working answer/reply workflow.
82. **Anonymous Q&A:** Support clearly explained anonymous-response experiences with appropriate protections.
83. **Private submissions:** Keep incoming Q&A answers private to their intended review workflow until publication is authorized.
84. **Answer inbox:** Let the publisher review submitted answers in an organized interface.
85. **Published replies:** Let the publisher select an answer, respond and publish it under the disclosed sharing rules.
86. **Clear labels:** Visually distinguish ordinary Q&A, anonymous Q&A and public/private response states.

### F. Authentication — 87–98

87. **Repeated login defect:** Reproduce and diagnose why reopening the preview repeatedly requires authentication.
88. **Persistent sessions:** Repair session persistence, restoration and refresh across supported platforms.
89. **Returning-user routing:** Send valid returning users to their account rather than the welcome/signup choice.
90. **Google Sign-In:** Make Google authentication work end-to-end on the supported environments.
91. **Apple Sign-In:** Make Apple authentication work end-to-end where configured and supported.
92. **Supabase integration:** Complete and test provider configuration, callbacks, identity linking and web/native redirect handling.
93. **Login copy:** Remove unnecessary promotional descriptions from authentication screens.
94. **Specific copy removal:** Remove the “Your timetable, verified campus updates and student services are waiting” paragraph and equivalent filler.
95. **Simple auth UI:** Provide clear, compact sign-in/signup forms without an oversized marketing layout.
96. **Root navigation:** Remove back arrows from first-entry screens that have no meaningful previous destination.
97. **Welcome balance:** Correct vertical spacing and illustration sizing so content is balanced rather than suspended above a large empty area.
98. **Navigation audit:** Review every back/close control against its actual navigation context.

### G. General UI / UX Cleanup — 99–110

99. **Description cleanup:** Remove redundant descriptive text throughout the product.
100. **Concise empty states:** Use a suitable illustration, a short state label and a useful action where needed.
101. **No repeated introductions:** Stop explaining what KampusOne is on ordinary task screens.
102. **Dark-mode redesign:** Rebuild dark-mode surfaces, contrast, components and states instead of mechanically darkening the light theme.
103. **Light default:** Use light mode by default while respecting an explicitly saved user preference.
104. **No green toggles:** Remove the unapproved green settings-toggle treatment.
105. **Branded switches:** Standardize settings toggles using the approved component and colour tokens.
106. **Toggle motion:** Add smooth state transitions without compromising responsiveness or accessibility.
107. **Native feedback:** Add appropriate native haptics where supported and user preferences permit.
108. **Explore repetition:** Replace the monotonous repeated card/icon/description/arrow catalogue with a more considered Explore hierarchy.
109. **Visual hierarchy:** Improve grouping, density, emphasis and discoverability while maintaining consistency.
110. **Design discipline:** Follow the approved simplicity, illustration, typography and interaction rules throughout all surfaces.

### H. Loading States — 111–119

111. **Skeleton standard:** Replace generic page-loading circles with layout-aware skeletons throughout the app.
112. **Feed skeletons:** Match the shape and hierarchy of actual feed content.
113. **Marketplace skeletons:** Match product, store and order layouts as appropriate.
114. **Profile skeletons:** Match profile headers, avatars and profile content without displaying fake personal details.
115. **Timetable skeletons:** Match actual calendar or class-list layouts.
116. **Dashboard skeletons:** Match dashboard modules and preserve layout stability.
117. **Learning/AI skeletons:** Provide suitable materials, history and result-loading states without pretending generated text already exists.
118. **Admin skeletons:** Provide useful table, detail-panel and chart loading states.
119. **Action progress:** Avoid circular loaders; use text status or determinate progress for submissions/uploads rather than replacing forms with skeletons.

### I. Streak System — 120–129

120. **Replace basic streak UI:** Redesign the current underdeveloped streak page.
121. **Connect streak data:** Remove the service-connection placeholder by implementing or repairing the real streak service.
122. **Meaningful experience:** Make the page show actual progress and meaningful engagement rather than only a goal form.
123. **Calendar:** Display an understandable activity calendar and day-by-day progression.
124. **Evolving flames:** Progress through distinct branded flame shades/states as milestones are reached.
125. **Milestones:** Present achievements and next milestones using real streak data.
126. **Personal best:** Calculate and display genuine personal-best information.
127. **Progress story:** Give streak progression a visual narrative without excessive explanatory copy.
128. **Sharing:** Improve streak sharing using accurate, privacy-conscious share content.
129. **Rewarding interaction:** Replace “enter a number and save” as the main experience with progress-first interactions.

### J. AI Study System — 130–137

130. **Persistent history:** Save study activity so users can revisit prior work.
131. **Session list:** Provide an organized list of previous study sessions.
132. **Saved summaries:** Reopen previous summaries with their associated source/session context.
133. **Saved notes:** Reopen previously created study notes.
134. **Revision:** Revisit quizzes and study outputs without losing earlier work.
135. **History interface:** Provide search/filter/detail behaviour appropriate to accumulated learning history.
136. **Gemini study role:** Use Gemini for the intended study workloads through a maintained provider integration.
137. **Gemini diagnosis:** Trace the apparently non-working Gemini configuration from deployed secret access to frontend results.

### K. AI Timetable — 138–143

138. **Working import:** Make AI timetable import work rather than assuming an entered API key completes integration.
139. **Worker bindings:** Verify the required deployed environment variables/secrets and the code paths that read them.
140. **End-to-end trace:** Diagnose frontend request, authentication, Worker handling, provider call, parsing, persistence and response rendering.
141. **Input workflow:** Support the intended timetable inputs with extraction, review, correction and save stages.
142. **Hugging Face role:** Implement the proposed Hugging Face timetable adapter after validating a suitable model/provider combination.
143. **Useful AI errors:** Show truthful failure and retry states while retaining private diagnostic detail internally.

### L. Nigerian University Support — 144–159

144. **Remove UNIBEN-only onboarding:** Let students register without belonging to UNIBEN.
145. **National readiness:** Prepare the academic/account architecture for Nigerian universities broadly.
146. **PDF foundation:** Ingest the attached university and academic-structure PDFs as source material, with provenance and a coverage report.
147. **Institution selection:** Provide a searchable real university selector without silent institution defaults.
148. **Faculties/colleges:** Scope organizational options to the selected university and its actual structure.
149. **Departments:** Scope department choices to their documented institutional relationships.
150. **Programmes/degrees:** Represent programmes and qualifications distinctly where the documents support those distinctions.
151. **Duration:** Store programme duration and study-year information only with an identified source or an explicitly unverified status.
152. **Entry year:** Collect the student's actual admission/start year.
153. **Expected completion:** Suggest or collect expected graduation appropriately; allow corrections rather than treating a prediction as an official date.
154. **Missing-option path:** Provide “My department/programme isn't listed” without blocking the whole signup unnecessarily.
155. **User submission:** Collect missing academic information and enough context to review it.
156. **Admin queue:** Send missing-data submissions into a dedicated administrative review queue.
157. **Data stewardship:** Let authorized staff add, correct, merge and reject academic entries with source/audit history.
158. **UNIBEN-first operations:** Preserve deep UNIBEN support while allowing other universities to use available core features.
159. **Configuration-led expansion:** Add future institutions through data and configuration rather than a destructive architecture rewrite.

### M. Notifications — 160–165

160. **Testing uncertainty:** Establish which notification behaviours can actually be tested in the web preview and each native build.
161. **Test mechanism:** Provide a controlled test-notification action.
162. **Admin trigger:** Let authorized staff trigger a test notification for an explicitly selected account/device.
163. **Platform distinction:** Distinguish browser notifications, native push and locally scheduled reminders in implementation and documentation.
164. **Delivery testing:** Verify registration, device tokens, send requests, receipts where available and observed device behaviour.
165. **Diagnostics:** Show useful internal failure states without claiming that provider acceptance proves the user received a notification.

### N. Account / Security Management — 166–169

166. **Session-list cleanup:** Remove the overwhelming repeated login-session/revoke rows from the normal account view.
167. **Simple account security:** Present concise, meaningful account-security information.
168. **Last login:** Show useful last-login/current-device information where accurately available.
169. **Advanced controls:** Retain accessible recovery and session-revocation controls without dumping all security internals onto the main screen.

### O. Agent Portal & Onboarding — 170–198

170. **Agent entry redesign:** Replace the current inappropriate separate-product login/marketing experience.
171. **One account:** Extend the existing KampusOne identity rather than creating an unrelated agent account.
172. **Email entry:** Begin with “Continue with your KampusOne email.”
173. **Verification code:** Send a real email code through the configured authentication workflow.
174. **Identity confirmation:** Verify the account before continuing into agent application details.
175. **Onboarding transition:** Move verified applicants directly into the appropriate application/resume state.
176. **Wizard:** Build a polished multi-step agent application rather than one giant form.
177. **Step validation:** Prevent progression with invalid required fields and show the exact inline corrections needed.
178. **Step transitions:** Animate transitions subtly and preserve entered information.
179. **Personal details:** Collect necessary identity and contact information, prefilling existing verified account fields appropriately.
180. **Phone:** Collect and validate the relevant contact telephone number.
181. **WhatsApp:** Collect a WhatsApp contact where required, allowing it to match the phone number.
182. **University/campus:** Collect the institution and campus the applicant will serve.
183. **Location:** Collect relevant campus/off-campus and service-location information without unnecessary precision.
184. **Agent type:** Ask whether the applicant is applying as a vendor, tutor, rider or another supported agent type.
185. **Conditional questions:** Adapt business/evidence questions to the selected agent type.
186. **Vendor information:** Collect meaningful vendor/business information.
187. **Business name:** Collect the appropriate business/public store name.
188. **Business address:** Collect the relevant business location/address and campus context.
189. **Campus permission:** Request selling/marketing permission where applicable, with a truthful not-applicable/review path.
190. **Rider information:** Collect rider-specific identity, service and operating details.
191. **Bike/evidence uploads:** Support appropriate rider/bike images and supporting documents.
192. **Tutor subjects:** Collect courses/subjects taught, using academic selections and a missing-option path where appropriate.
193. **Tutor levels:** Collect the levels/cohorts the tutor teaches.
194. **Tutor background:** Collect relevant experience, qualification/evidence and reason for applying.
195. **Agent terms:** Present accessible agent terms and conditions for review.
196. **Agreement:** Require an explicit terms checkbox and store the accepted version and timestamp.
197. **Submission state:** Show clear submitted/under-review feedback with a suitable animation.
198. **Application email:** Send a real application-received/under-review email after successful submission.

### P. Agent Verification — 199–214

199. **Pending queue:** Provide a dedicated queue of submitted agent applications.
200. **Application inspection:** Let authorized reviewers inspect application information and submitted evidence.
201. **Automation foundation:** Define the integration foundation for future Python-assisted checking without claiming it already exists.
202. **File checks:** Support automated file/document/image checks appropriate to available validated tools.
203. **Consistency checks:** Compare relevant names/details and flag discrepancies with their evidence.
204. **Document quality:** Identify unreadable, incomplete or otherwise problematic evidence for human review.
205. **Application flags:** Flag suspicious/inconsistent applications without treating automated suspicion as proven misconduct.
206. **Explanations:** Record an understandable reason and supporting evidence for each automated flag.
207. **Review grouping:** Separate apparently complete applications from those requiring closer human inspection.
208. **Human control:** Keep a human reviewer responsible for final approval/rejection decisions.
209. **Individual approval:** Provide a working Verify/Approve action with recorded actor and time.
210. **Bulk approval:** Support a reviewed selection of suitable applications, with preview and auditability.
211. **Manual override:** Allow authorized, reasoned overrides without silently bypassing unrelated financial/security controls.
212. **Rejection workflow:** Provide a clear reject/request-correction workflow.
213. **Rejection reason:** Require a specific reason rather than a generic unexplained rejection.
214. **Applicant communication:** Send understandable rejection/correction/resubmission instructions through email.

### Q. Agent Payouts — 215–224

215. **Post-approval prompt:** Prompt approved agents to configure payout details.
216. **Payout setup location:** Make the setup accessible in the approved agent's profile/dashboard.
217. **Account resolution:** Integrate an appropriate Nigerian bank-account resolution/verification provider after checking requirements and availability.
218. **Resolved name:** Retrieve the bank's reported account-holder name through the authorized provider workflow.
219. **Name review:** Compare the resolved name appropriately with the verified agent/business identity.
220. **Mismatch handling:** Route unsuitable/mismatched details into a clear warning, correction or authorized review state.
221. **Protected storage:** Store only necessary payout data/references with appropriate access controls, masking and security.
222. **Eligibility:** Mark an agent payout-eligible only when the applicable approval/setup requirements are satisfied.
223. **Eligible list:** Provide an administrative list of agents ready for the payout workflow.
224. **Payout records:** Track payout requests, approvals, processing, failures and completed transactions accurately.

### R. Marketplace / Sellers — 225–230

225. **Real inventory:** Replace removed demo stock only with genuine approved listings or authorized platform-managed offerings.
226. **Real seller workflow:** Connect marketplace listings and actions to functioning seller accounts, not a fake demonstration environment.
227. **Store administration:** Manage seller/store status and account relationships properly.
228. **Twelve-month offer:** Implement the stated 12-month seller/store free-trial offer as a real entitlement.
229. **Trial lifecycle:** Persist and expose trial claim, start, end and status rather than only displaying promotional text.
230. **Trial/store oversight:** Give admin visibility and audited controls over seller/store and trial status.

### S. AI Usage / Free Period / Rate Limits — 231–237

231. **Limited free use:** Enforce appropriate AI allowances during free/trial access; free must not silently mean unlimited.
232. **Server enforcement:** Enforce quotas and abuse limits on the backend, not only with disabled frontend buttons.
233. **Usage accounting:** Record relevant successful usage and provider consumption using a documented policy.
234. **Admin usage view:** Make AI allowance consumption and operational costs visible to authorized administrators.
235. **Limit feedback:** Tell users plainly when their allowance is exhausted.
236. **No silent failure:** Distinguish quota exhaustion, temporary rate limiting, provider failure and network failure.
237. **Evolving plans:** Make allowances, entitlements and plan behaviour configurable without rewriting each AI feature.

### T. Campus Guidelines / Empty Broken Screens — 238–241

238. **Guidelines content:** Replace the empty Campus Guidelines page with sourced, institution-appropriate content and an honest availability state.
239. **Blank-screen audit:** Find and classify other exposed screens that lack functional content or behaviour.
240. **No false completion:** Do not leave blank routes presented as finished features or count hiding them as completion.
241. **Complete states:** Give each exposed feature its appropriate loading, empty, populated, error, permission and unavailable states.

## 5. Required implementation decisions and safeguards

The following directions explain how the register should be implemented. They are not replacement requirements and must not erase any numbered item.

### A. Audit before diagnosis

Create an evidence inventory: repository/branch/commit, deployed hosts, API routes, database migrations, identity provider, storage, environment configuration, current feature flags and available logs. Mark unavailable access precisely.

For each reported failure, reproduce it where possible. A screenshot can establish a visible symptom; it cannot establish which backend component failed. Do not conclude that an API key is invalid, a database is missing or a provider is broken without evidence.

Map each feature end-to-end: UI action → client request → authenticated API → authorization → validation → database/provider operation → durable result → rendered state. Fix the broken part rather than replacing a truthful error with a fake success message.

Use bounded requests, explicit error codes, redacted diagnostics and request IDs. Provide retry/recovery states without exposing secrets, bank information, identity documents or access tokens.

### B. Admin security, permissions and verification

Generate the non-obvious admin hostname securely only during authorized configuration. A long random address is an additional preference, never a promise of an “unhackable” system. Design authentication, multi-factor protection for privileged access, rate limiting, session controls and authorization independently of hostname secrecy.

Use deny-by-default permissions. Model both the action and the permitted university/resource scope. Include permissions such as users.view, users.verify, agents.review, payouts.approve, broadcasts.send, analytics.view and staff.manage. Prevent a restricted staff member from granting themselves broader access.

Separate public badge status, document verification, agent approval, publisher capabilities, staff permissions and payout eligibility. A brown badge must not automatically grant financial powers or every publisher tool. Manual badge grants must record who authorized them, why and when.

Restrict sensitive documents, contact information and financial records by purpose and permission. Support auditability without granting every administrator unrestricted access to everything a student uploads. Preserve useful user security controls even while simplifying the interface.

### C. One identity across app, agents and admin

Define the identity/account relationship explicitly. A student may also be a vendor, tutor or rider. Role membership should extend that account; it must not create an accidental duplicate login.

Student and agent access can use the common identity system, while staff authorization remains separately provisioned and more restrictive. Do not assume a student session is sufficient for administrative entry.

For session restoration, test browser refresh, closing/reopening, OAuth callbacks, app restart, token expiry, logout and revoked sessions. Do not show the welcome screen before restoration has completed. Do not mistake a genuinely expired/revoked session for a persistence bug.

For Google and Apple, verify current official provider requirements, registered redirects, environment separation, native callbacks and cancellation/error paths. Do not leave apparently working provider buttons connected to no implementation. Preserve the agreed existing sign-in method while completing provider integration.

### D. Academic dataset and guidelines

Treat the attached PDFs as a documented input dataset, not proof of completeness or current regulatory status. Produce a source inventory and coverage report. Identify scanned/unreadable pages, missing faculties/programmes, duplicates, conflicting names and undated rules.

Model institution → campus where applicable → organizational units → programme/qualification, allowing the real relationships rather than forcing every institution into the same rigid structure. Keep department and programme distinct when the source distinguishes them. Record study mode, entry route, duration, applicable cohort/session and status when supported.

For guidelines, preserve whether a rule is university-wide, faculty-specific, departmental or programme-specific. Store the source excerpt/reference, version and effective scope. Do not apply one institution's grading scale, progression rule, attendance threshold or degree duration to another without evidence.

Import into staging first. Validate, normalize aliases, propose deduplication, review conflicts and publish approved records. Imports should be repeatable without producing duplicates, with a batch log and a reversal plan. Avoid reproducing copyrighted source documents more broadly than permission allows.

A student's missing-department submission must not instantly become an official global catalogue entry. Store the original submission, let the student proceed with a provisional academic profile where appropriate, and route it for review. After approval, link the provisional entry to the authoritative record without losing user information.

Separate institution registration support from campus-service readiness. A student outside UNIBEN should be able to register and use available core tools without being shown fictional local vendors, campus maps or university rules.

### E. Analytics and honest operational data

Create an event dictionary before building graphs. Define screen_view, feature_started, feature_completed, feature_failed, timetable_import, study_session, application_submitted and other needed events. Specify properties, triggering conditions, deduplication and retention.

Keep product analytics, security/audit logs and financial ledgers distinct. Define active-user, retention, conversion and revenue metrics explicitly. Show when data collection began so an uninstrumented past is not presented as zero activity.

Use the minimum useful data. Do not put passwords, email codes, bank details, document contents or unrestricted private study prompts in analytics. Provide appropriate privacy disclosures and controls; research applicable requirements before release.

Make tenant filtering, permission filtering and export restrictions apply on the server. Test that university-specific staff cannot inspect other institutions through analytics or cached results.

### F. Composer, Q&A and media

Use the open composer layout: close/back according to context, profile avatar, audience selector where actually supported, “What's happening on campus?”, inline attachments and a clearly accessible Post action. Handle keyboard and safe-area changes correctly.

Ordinary students get text, images and video. Eligible accounts get polls and Q&A tools. Check publishing permissions server-side. Preserve drafts across recoverable failures, prevent duplicate posts from retries and show honest upload/processing progress.

Validate upload ownership, file type, size and supported format; define storage, processing and failed-upload cleanup. Do not publish a broken media placeholder as if upload succeeded.

For Q&A, define who can see a response before and after publication. Explain the possibility of a publisher sharing an answer before submission. Anonymous mode must not reveal the respondent to the publisher or public through names, API fields, notifications or exports. Any retained moderation linkage must be tightly restricted and honestly disclosed; do not promise absolute anonymity beyond what is implemented.

Provide reporting, deletion and abuse-handling workflows. Do not let anonymous Q&A bypass community protections.

### G. AI timetable, study history and limits

Separate timetable extraction jobs from study sessions and expose a common provider-adapter boundary. Evaluate a currently available Hugging Face model/provider against representative timetable inputs; an API key alone is not proof that a suitable model or hosted endpoint exists. Use Gemini for the intended study tasks after verifying deployed configuration.

For timetable import: upload/paste/manual input → validation → extraction → structured schema validation → editable review → user confirmation → save timetable → configure eligible reminders. Do not auto-commit invented class times, rooms or course codes. Flag ambiguity and keep manual correction usable.

For study: retain source references, sessions, notes, summaries and quizzes with owner-only access by default. Support reopening, revision and deletion. Define retention and storage limits instead of accumulating everything forever.

Implement server-side rate limits and allowance reservations that behave correctly under concurrent requests. Define whether failures refund reserved allowance and distinguish successful jobs from provider retries. Show remaining allowance and reset/renewal information where applicable. Keep provider costs and user allowances separately understandable.

I have mentioned a 12-month free period for sellers and in relation to AI. Record this as an entitlement-policy decision: confirm the AI beneficiaries, covered tools, claim/start trigger and reset cycle before activating it. Do not silently interpret the offer as unlimited AI. Exact numerical quotas and future prices are not supplied here; propose options with verified costs rather than inventing them as settled policy.

### H. Agent onboarding, checks and payout setup

Use three principal data stages—personal/contact details; university/campus/location; role-specific business/teaching/rider details—followed by review, terms and submission. Role choice may appear earlier when needed to select the correct questions. Preserve the simple progressive experience rather than exposing every question at once.

Save drafts securely. Support resume, corrections and resubmissions. Explain why sensitive evidence is needed and avoid unnecessary collection. Capture terms version and send confirmation only after a durable successful submission.

Design the future Python-checking boundary with a job record, secure document access, versioned result schema, check reasons, evidence, retry handling and human decision records. Choose a compatible runtime only after checking actual workload/runtime requirements; do not assume a heavy verification pipeline belongs inside an ordinary request handler.

Do not treat an “AI-generated image” detector as conclusive proof of fraud. Prefer specific observable flags, such as unreadable text, missing evidence or inconsistent fields, and retain human review. Bulk approval must act on an explicit reviewed selection, not silently approve the entire queue.

For bank details, compare current providers' account-resolution support, verification requirements, commercial availability and costs. Distinguish obtaining an account name from proving identity or ownership. Handle abbreviations, name order and legitimate business accounts through a defined review policy.

Keep financial transactions auditable and idempotent. Never infer payout success from a client response alone or directly overwrite balances. Require explicit approval for real money movement, authenticated provider events and reconciliation.

### I. Email, personas and notifications

Model platform personas as managed publishing identities with a public ownership disclosure and an internal staff author. Do not create fake ordinary users, reviews, purchases or conversations to make the app look active. Use legitimate verified sending domains and valid reply handling.

Separate necessary operational email from promotional campaigns. Include audience previews, counts, permissions, test sends, confirmation, deduplication, delivery-event handling, preferences and suppression controls. Opening the broadcast editor must not accidentally send a campaign.

For notifications, document web preview, browser/PWA where implemented, development build and release build separately. Test permission denial, token refresh, foreground/background behaviour and an actual device. Distinguish a queued notification, provider acceptance, delivery evidence and user interaction.

Keep test delivery restricted to the intended recipient/device. Do not send a mass “test” to all students. Do not report notifications working merely because the send endpoint returned success.

### J. Visual polish without misleading states

Use shared components for buttons, forms, drawers, dialogs, skeletons, switches, empty states and badges. Apply them consistently across app, agent and admin surfaces while respecting each surface's information density.

Balance welcome content using responsive layout, safe areas and keyboard-aware behaviour, not hard-coded spacer heights. Keep forms readable on smaller devices. Do not remove necessary field labels, consent wording, security information or helpful errors when deleting marketing copy.

Use skeletons for unknown page content. Use labelled progress for uploads, generation and submissions. Honor reduced-motion preferences; do not make motion or colour the only indication of status.

For streaks, define the qualifying activity, timezone, day boundary, duplicate-event handling and missed-day policy before implementing visuals. A refresh must not create a new streak day. Show real progress, not fabricated motivational numbers.

Use working empty states after removing demo content. Keep non-production fixtures isolated for tests; do not confuse test fixtures with live inventory. Before production cleanup, prepare an exact deletion/archive manifest and backup, exclude genuine user records, and obtain confirmation for irreversible actions.

## 6. Delivery sequence

Plan the entire scope now, but implement in dependency-aware tranches. Do not repeatedly redesign the same screen while leaving its service unimplemented.

**Phase 0 — Evidence and reconciliation.** Inspect supplied material and available systems, reproduce failures, map all 241 IDs, identify conflicting old instructions, confirm hosts and define acceptance tests. Output an audit, architecture diagram/description and decision log.

**Phase 1 — Admin foundation and identity.** Establish the approved large sidebar architecture, shared design components, secure admin entry, staff roles/scopes, audit trail and shared identity boundaries. Repair persistent sessions and diagnose OAuth. Implement minimum operational visibility and instrumentation hooks alongside the foundation.

**Phase 2 — Universities and academic data.** Create the source-aware academic model, PDF import/review pipeline, Universities workspace, missing-data queue and multi-university onboarding. Build guidelines publication with real source scope, not generic text.

**Phase 3 — Student core and visual corrections.** Fix root navigation, welcome/login balance, loading patterns, settings, Explore and profile visibility. Deliver ordinary-student posting/media and its moderation path. Redesign streaks against a working streak service.

**Phase 4 — Agents and verification.** Implement the shared-identity application wizard, draft/resume, evidence uploads, review queues, approvals, rejections and transactional emails. Build the automated-checking integration boundary without falsely claiming an unbuilt checker is operational.

**Phase 5 — AI tools and learning history.** Complete timetable extraction/review, Gemini study functions, retained history, usage metering and enforced quotas. Do not defer API diagnosis until this phase; investigate blocking configuration in Phase 0 and schedule fixes as soon as prerequisites exist.

**Phase 6 — Commerce and communications.** Finish real seller/store flows, trial entitlements, payout setup and approved financial operations. Add segmented email broadcasts, notifications and device-level testing. Remove demo data through the approved cleanup process.

**Phase 7 — Hardening and release.** Complete analytics/reporting, cross-university access tests, accessibility and performance checks, error-state coverage, restore/rollback checks and release verification. Reconcile the tracker against all 241 IDs.

For each phase, state prerequisites, requirement IDs, proposed changes, migrations, provider dependencies, acceptance evidence, rollback approach and remaining blockers. Explain justified changes to the sequence. Do not silently remove low-priority items from scope.

## 7. Configuration, budget and access deliverables

Produce an environment/configuration matrix showing the setting name, purpose, consumer, correct environment, secret/public classification, current verification status, required owner action and the visible behaviour it enables. Include sanitized examples only; never print actual secrets.

Distinguish local development, preview, staging and production. Verify that deployments read the same variables that their code expects. A configured variable is not proof of a successful integration.

Document the minimum working integration for authentication, email, file/media storage, timetable AI, study AI, push notifications and bank resolution. Clearly separate immediately required providers from optional later services.

Provide a cost-aware plan for the intended early rollout and a scenario around 10,000 users. State assumptions about daily activity, AI usage, storage, bandwidth and messages. Use verified provider pricing for estimates. Do not promise that “free tier” means unlimited or permanently free.

Prefer maintainable modules and clear boundaries over unnecessary microservices, sharding or infrastructure proliferation. A sidebar with hundreds of capabilities does not require hundreds of separately deployed backends.

## 8. Acceptance and completion rules

Track each requirement as **Not inspected, Confirmed missing/broken, Already working with evidence, Planned, In progress, Blocked, Implemented—not verified, Verified in test, or Verified in production**, as appropriate. Do not equate merged code with a verified live fix.

At a minimum, demonstrate these end-to-end journeys with recorded results:

- A student from a documented non-UNIBEN institution registers without receiving the founder's profile or UNIBEN's default academic structure; a missing department enters the review queue.
- A returning user reopens the supported preview/app and reaches their account through valid session restoration; logout and revocation still work.
- A finance-only staff member sees Revenue/Analytics and is denied other modules through both UI and direct API access, including other-university records outside their scope.
- A permitted administrator inspects a profile/cover image, assigns the brown badge and leaves an audit trail without implicitly granting payout or staff permissions.
- An ordinary student publishes text, an image and a video; previews work, failures preserve their work, and retries do not duplicate posts.
- Anonymous Q&A preserves its promised privacy, including API responses and notification content, while the publisher can publish an allowed response.
- A student imports a timetable, corrects uncertain extraction, saves it and later reopens it; a study session also remains available in history.
- AI allowance exhaustion produces a clear limit state, and parallel requests cannot bypass the allowed usage.
- An applicant resumes a multi-step agent form, submits it, receives the email, is reviewed and receives a specific approval or correction/rejection result.
- An approved agent resolves payout details, receives the correct match/review state and only becomes eligible when the required conditions are satisfied.
- A broadcast test reaches only its selected recipient; the full campaign honours its final audience, preferences and send permissions.
- A selected real device receives a test notification with platform, build, registration and delivery evidence recorded.
- Trial claim/start/expiry works without being reset by reinstalling or signing in again; demo records are absent while genuine data remains intact.
- Every exposed route has appropriate loading, content, empty and failure states, and all live dashboard numbers can be traced to actual data.

Use unit, integration and end-to-end tests where appropriate. Include authorization-negative tests, accessibility checks, small-screen/keyboard tests, slow-network handling, duplicate submissions and failure recovery. For deployments, record the commit/build, URL, environment and actual verification result.

A frontend mockup is not proof of a backend feature. A hidden broken route is not a completed requirement. An automated detector's opinion is not an approval decision. A provider's accepted request is not proof of completed payout or device delivery.

## 9. Required first response and ongoing outputs

Your first response should produce an evidence-based starting package, not simply repeat that you understand:

**Source and current-state audit.** Identify the provided documents/screenshots, what can be concluded from them, what was inspected live and what remains unverified. Clearly separate reported symptoms from reproduced defects.

**Complete requirement traceability register.** Include all 241 IDs with their problem/expected outcome, evidence status, affected surface, proposed approach, backend/data needs, permissions, dependencies, priority, acceptance test and current status. Related requirements may share work, but none may disappear.

**Admin architecture specification.** Produce the actual large sidebar hierarchy, route/module catalogue, university-scoping behaviour, workspace layouts and role/action matrix. Show the intended Super Admin view and a restricted staff view. Do not return only a generic dashboard description.

**Academic ingestion plan.** Explain how the attached university PDFs and school guidelines become reviewed, versioned institutional data; provide coverage gaps and unresolved source conflicts. Do not invent university information to fill the gaps.

**Implementation plan and first build tranche.** Explain what should be done first, why it unlocks later work, the exact IDs covered, configuration requirements, tests and any decision needed from me. Distinguish proposed architecture from changes already made.

**Progress tracker.** Maintain a durable requirements/phase tracker in the repository or existing tracking system once authorized. Include blockers, tested results, commits/builds and the next action. Do not create a tracker that claims completion without implementation evidence.

During implementation, report what changed, what was tested, what failed, what remains blocked and what I must provide. Ask for credentials through secure configuration flows, not pasted secrets. Only state that a deployment or feature works after checking the actual target environment.

The outcome I want is a functional multi-university KampusOne product with a substantial, well-organized admin operation—not another attractive set of disconnected screens.
