# Admin architecture and access

The portal is a separate operational website using one Worker and one application database. A module link exists only when a backing route exists. Proposed capabilities stay visibly marked Planned in the delivery catalogue; their presence is not implementation evidence.

## Actual grouped navigation

| Section | Capabilities |
| --- | --- |
| Overview | Operational overview; Pending work; Recent activity |
| Universities & campuses | University directory; Campus availability; Communities & cohorts; Missing-data submissions; Faculties · departments · programmes (Planned); Source batches & corrections |
| Students & users | All users & academic profiles; Active accounts; Transfers & privacy requests (Planned) |
| Staff & access | Staff accounts & permissions; Staff & administrative audit; Staff invitations (Planned) |
| Agents & applications | All agent applications; Application & document review; Pending review; Corrections & resubmissions; Approval history; Automated checks & flags (Planned); Reviewed bulk decisions (Planned) |
| Vendors & stores | Vendor applications; Approved vendor directory; Store verification & products; Trial claims & expiry |
| Tutors & learning services | Tutor applications; Teaching offers & materials; Subjects & levels taught (Planned) |
| Riders & delivery | Rider applications; Approved rider directory; Service campuses & delivery activity (Planned) |
| Marketplace | Products, stores & disputes; Orders · cancellations · refunds (Planned) |
| Feeds & publishing | All posts; Published posts; Campus publishing & sources; Polls · Q&A · reports · appeals (Planned); Managed publishing personas (Planned) |
| Academic tools | Academic correction queue; Timetables · import jobs · GPA rules (Planned) |
| Campus guidelines & knowledge | University · faculty · department rules; Sources · versions · effective dates |
| AI operations | Provider health · jobs · failures (Planned); Usage · quotas · cost controls (Planned) |
| Verification & trust | Account verification; Agent identity review; Verification categories & overrides (Planned) |
| Revenue & finance | Store order activity; Reconciliation · fees · exports (Planned) |
| Payouts | Bank review & eligible agents; Requests · approvals · batches · history (Planned) |
| Email & broadcasts | Campaigns · audiences · test sends; Templates · delivery events · preferences (Planned) |
| Notifications | Devices · test notification · receipts |
| Analytics | Recorded product events; Retention · university comparisons · funnels (Planned) |
| Support & moderation | Support inbox & case replies; Reports · escalations · appeals (Planned) |
| Security & privacy | Protected audit trail; Authentication · sensitive access · retention (Planned) |
| System & integrations | API · database · providers · deployments (Planned) |
| Product controls | University rollout; Trial oversight; Flags · entitlements · limits · maintenance (Planned) |
| Implementation tracker | Module dependencies & delivery status; All 241 requirements & test evidence |

## Scope and workspace contract

Global staff select all universities or one university. Restricted staff select an assigned university; an omitted filter never becomes global access. Every protected route checks current server grants. Changing account or scope invalidates prior rendered records. Search, sorting and pagination for operational lists are server-side. Empty and failed queries have different states.

The super administrator receives the complete registered navigation. A finance-only account receives assigned finance/analytics capabilities and a university scope; the Worker denies student inspection, applications, staff, content and other-university access regardless of a guessed URL. The tests verify those API boundaries; an authenticated browser session is still required to certify the complete private UI journey.

| Action group | Permission boundary |
| --- | --- |
| Staff provisioning and suspension | staff.manage; separately provisioned staff only; no self-grant or platform-admin alteration |
| Profile/cover inspection | users.view within resource university |
| Brown verification badge | users.verify; audited; grants no staff, payout or publishing power |
| Publisher capabilities | content.capabilities, explicit per-account grant |
| Private agent identity evidence | agents.verify, independent from queue viewing |
| Applications and human review | agents.view / agents.review, record scope and reason |
| Academic source review | global academic.view / academic.manage for unassigned claims; university scope for guidelines |
| Payout account review | finance.review within assigned institution; identity and account review remain separate |
| Payout authorization | payouts.approve plus financial invariants; no client balance writes |
| Campaign drafting and sending | broadcasts.manage / broadcasts.send; reviewed audience and separate test confirmation |
| Push testing | notifications.test; one selected current-session device |
| Audit | audit.view; actual recorded actions |

The route/action registry is `server/src/lib/admin-access.ts`; the navigation catalogue is `portal/lib/admin-modules.ts`. These files are executable sources of the current permission model. Unknown routes are denied. Private content and financial writes never inherit access from a display badge.
