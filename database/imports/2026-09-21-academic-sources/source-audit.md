# KampusOne academic source audit and ingestion plan

Audit date: 21 September 2026. Scope: the two supplied university PDFs, the academic requirements in the complete master prompt, and the lightweight architecture blueprint. Both university PDFs were extracted page by page and read through their final pages. This is an audit of supplied evidence, not a new nationwide institutional verification exercise. No current university rule has been independently confirmed through a fresh primary-source retrieval in this subtask.

## 1. What the attachments actually contain

| Source | Verified physical/content coverage | Authority and use |
| --- | --- | --- |
| `Nigerian_Universities_Faculties_Programmes_and_Regulations.pdf` | 77 pages; 328 unique register rows (77 federal, 69 state, 182 private); 47 profile headings; 18 rule records; 95 unique source-directory entries with exact outbound URLs | Secondary research compiled for Warrior. It cites official sources, but the compilation itself is not a NUC register, Senate circular, or university handbook. Suitable for staged claims with original-source verification. |
| `KampusOne_Nigerian_Universities_Faculties_Programmes_and_Rules.pdf` | 30 pages; 328 listed register entries; 22 profile sections; 20 rule sections | A PDF conversion of a conversation report. Page 2 expressly says no new verification occurred during conversion and the original citation URLs were unavailable. There are no URI link annotations. Additional claims require recovery of the primary source. |

Both have extractable text on every page. No textless/scanned-only page blocked extraction. Representative rendered pages were inspected to check reading order and table/section interpretation; this is not a claim that every original handbook linked in the reports was retrieved or OCR-checked.

The 77-page report's coverage codes count as 281 V0 (register only), 23 V1 (academic-unit lists only), and 24 V2 (selected mixed detail). Its page 2 declares 602 organisational labels and 518 mixed department/programme/option entries across 107 selected groups; those three aggregate counts are retained as report-declared, not independently deduplicated counts of active faculties or degrees. The V2 code is broad: LASU's only detail group is additional schools (page 38), while Nile has selected degree programmes but an empty academic-structure list (page 54). Consequently V2 must not be exposed as “complete departments verified.”

The reports share many institutions. Four profile institutions appear only in the 30-page profile collection: FUTA, FUT Minna, MOUAU, and Covenant. Thus the combined profile collection covers 51 distinct institutions, not 69 different institutions. It still does not verify all faculties, all degrees, or all rules for any nationwide inventory.

Do not treat the reports' F001/S001/P001 labels as NUC-issued IDs. They are report-local references. Do not use a listed website or establishment year as proof of admission status, accreditation, active campus services, or programme availability.

## 2. Exact page coverage

| Dataset | 77-page report | 30-page report |
| --- | --- | --- |
| Scope and caveats | pp. 1–4 | pp. 1–4 |
| Federal register | pp. 5–8 | pp. 5–6 |
| State register | pp. 9–11 | pp. 7–8 |
| Private register | pp. 12–18 | pp. 9–13 |
| Federal profiles | pp. 19–36 | Profiles mixed by section, pp. 14–22 |
| State profiles | pp. 37–45 | pp. 22–23 |
| Private profiles | pp. 46–54 | pp. 23–24 |
| Scoped rules | pp. 55–63 | pp. 25–29 |
| Remaining gaps/ingestion advice | pp. 64–66 | p. 30 |
| Recoverable original-source directory | pp. 67–77; 95 entries | Absent; p. 2 explains why |

The machine-readable `academic-source-manifest.json` captures each document's SHA-256, every register row's page, each profile/rule section's page, and the exact 95 official-source URLs from PDF link annotations. A URL's presence means the compilation cites it; it does not mean this audit checked the live page or endorses all of its content.

## 3. Source conflicts and publication blockers

| ID | Source locations | Conflict or ambiguity | Required handling |
| --- | --- | --- | --- |
| AC01 | 77-page p. 21; 30-page p. 17 | BUK has 19 faculty labels in one report and 23 in the other, with different Education, Arts, Islamic Studies and communication groupings. | Keep both dated claims. Recover current official organisation and effective dates; do not union all labels into current faculties. |
| AC02 | 77-page p. 30; 30-page p. 16 | UNIBEN 17-unit list versus an additional Computing portal label; engineering departments/programmes have unclear parentage. | Preserve programme labels and unresolved hierarchy. Confirm current Computing structure and engineering parent/award relationships. |
| AC03 | 77-page pp. 46–47; 30-page pp. 23–24 | Babcock Computing and Engineering are separate in one report and combined in the other; Environmental Sciences appears in the manual but not the web directory. | Require dated university organisational evidence; no duplicate combined/split schools. |
| AC04 | 77-page pp. 29–30; 30-page p. 21 | FUNAAB current colleges include Computing Sciences and Entrepreneurial and Development Studies; older report excerpts include a 2021 Management Sciences page and ambiguous Computer Science placement. | Version organisational relationships and confirm current title/placement before publication. |
| AC05 | 77-page pp. 27–28; 30-page p. 18 | OAU new Computing structure coexists with older Technology navigation; Nursing faculty change may still be in approval process. | Keep proposed/pending separate from active; do not duplicate computing programmes or assume approval completed. |
| AC06 | 77-page pp. 31–32; 30-page p. 15 | UI navigation count 20 versus older descriptive count 17; Computing department names differ from degree names. | Store department and award separately. “Computer Science and Artificial Intelligence” department does not prove an AI bachelor's degree. |
| AC07 | 77-page p. 26; 30-page pp. 20, 28 | NOUN Computing versus older Sciences placement; Information Technology departmental mapping varies; programme pages disagree on assignment count. | Separate faculty restructuring from assessment policy. Do not choose a universal TMA count from these excerpts. |
| AC08 | 77-page pp. 40, 71; 30-page p. 23 | DELSU current faculty labels versus January 2023 inventory and 2021 Management Sciences groups. | Preserve 2023/2021 validity and verify current mappings; no mechanical remapping of historical departments. |
| AC09 | 77-page p. 59, source FA04 | FUNAAB examination departure timing conflicts internally: first/last 30 minutes versus first hour/last 10 minutes. | Rule remains conflicting; obtain applicable session instruction. |
| AC10 | 77-page p. 63, source BE04 | Bells 100-level earned-credit progression language has conflicting consequences. Its general pass band is 45%, with no E grade. | Do not automate credit eligibility or impose a 40%/E-grade default. |
| AC11 | 77-page p. 62, sources BC02/BC03 | Babcock digest is subordinate to printed manual and the first-year academic-standing exception matters. | Preserve manual precedence, cohort/level exceptions and due process; no automatic suspension from one summary value. |
| AC12 | 30-page p. 28, section 5.11 | UI four-point scheme is tied to admission from 2016/2017 and is explicitly historical. | Recover circular and superseding decisions before selecting a student's scheme; never apply to all UI cohorts silently. |
| AC13 | 77-page p. 61; 30-page pp. 25–26 | UNIBEN PharmD 75% attendance/level-specific pass marks, Medicine 70%, part-time Computer Science 70%/45% pass. | These are differently scoped claims, not a conflict resolved by one institution-wide number. Retain programme, level, mode and cohort. |
| AC14 | 30-page pp. 26–27 | FUTA Data Science/Building show CGPA 1.50 while other programme excerpts show 1.00; credit/duration values differ by entry route. | Programme/version scope plus original-source recovery. Never assume every computing degree is four years. |
| AC15 | 77-page p. 45 | UNIMED Speech/Language Therapy and Audiology are described as awaiting resource verification. | Proposed state only; not selectable as confirmed admitting programmes based on this evidence. |
| AC16 | 77-page pp. 52–53 | Redeemer's duplicate social-science entries under Computing; Caleb Computer Science placement conflicts and generic repeated credit values are unreliable. | Flag invalid parentage; do not import duplicate degrees or generic credit requirements. |
| AC17 | Both register sections | Alternate spellings and name changes: Usumanu/Usmanu Danfodiyo; Modibbo Adama; Dennis Osadebe/Osadebay; Arthur Javis/Jarvis; Kevin Eze/Ezeh; Tonine/Tonnie; Transatlantic “Medine”/Medicine. | Preserve raw values and aliases. Confirm legal/display names; do not silently correct source text or create duplicate institutions. |
| AC18 | 77-page pp. 22–25, 31, 43–44, 51 | College/faculty overlap, legacy Science labels, and editorial subject clusters. | Academic unit type and parent are evidence-bearing fields; leave parent null/under review where not proven. |
| AC19 | 77-page p. 77, source AZ02; p. 54, source NI01 | ABU only first 20 of a reported 114 catalogue rows; Nile “load more” catalogue only first 18 entries. | Mark pagination incomplete. Absence cannot delete an existing real programme. |
| AC20 | 30-page p. 2 | Underlying citation URLs absent for additional claims. | Store compilation page and claimed issuer; source recovery required before verified publication. No invented URLs. |

Other gaps are explicitly identified in individual profiles: unreadable/empty handbook and programme links; undated institutional pages; uncertain campus allocation; historical upload dates mistaken for effective dates; incomplete current admissions/accreditation status. A newer upload path is never enough to supersede a Senate-approved rule.

## 4. Required model

Use one application PostgreSQL database with separate tables/modules, matching the lightweight blueprint's one-source-of-truth principle. Current repository inspection shows an existing `universities`/`faculties`/`departments` schema, institution configuration, and simple guideline drafts. Add compatibility mappings rather than deleting or renaming existing student records in place.

- **Institution:** stable UUID, official/display name, aliases, country, ownership, registration-supported state, source claim, review state. Website strings remain reported until validated. Service availability is separate from registration support.
- **Campus/delivery location:** institution UUID, campus/study-centre type, optional physical location, operational service flags and evidence.
- **Academic unit:** stable UUID, institution UUID, unit type (college/faculty/school/department/institute), optional parent unit, effective period, source claim, current/historical/proposed/unknown status. Use a relationship table where joint ownership requires multiple parents, not assumed duplication.
- **Programme:** distinct UUID, award/title, programme options, responsible units, supported campus/mode, UTME/direct-entry/transfer/conversion route, entry level, normal/max duration, credit requirements only if evidenced, cohort/session, source claim and approval status.
- **Academic rule/version:** topic, exact scope, institution/unit/programme, cohort/session, mode, entry route, level, course exceptions, effective dates, original source page/section, source excerpt or bounded paraphrase, interpreted value/unit, reviewer, conflict/supersession links. A rule's narrative and the calculator's configuration are separate records.
- **Source document/claim:** publisher versus compiler, immutable content hash, filename or official URL, retrieval date, claimed issue/approval date, original page number, report page number, extraction method, and quality warnings. A report page and original handbook page must be separate fields.
- **Import batch/staging candidate:** source hashes, parser version, stable report-local key, claim payload, status, errors, reviewer, published target mapping, audit history and reversal reference.
- **Provisional academic profile/submission:** user UUID, selected real institution, user-entered missing unit/programme text, original submission, review status, approved mapping. User text remains provisional until a steward reviews it.

The repository currently defines a generic A5/B4/C3/D2/E1/F0 `institution_config.grading_scale` default. That is unsupported as a national policy. New configurations should begin unknown or explicitly user-configured, and the calculator must label a custom estimate accordingly. Existing settings must be reviewed without overwriting legitimate verified configurations.

## 5. Staging and publication workflow

1. **Inventory and fingerprint:** retain both source hashes, page counts, immutable filename, compilation date and compiler. Store originals privately according to existing document/storage controls.
2. **Extract without interpretation:** retain raw institution names, IDs, page spans, source codes and exact URL annotations. Preserve manual relationships and ambiguous unit types; no model-generated departments or rules.
3. **Validate the batch:** check uniqueness within report ID, ownership counts, page bounds, hashes, all referenced document IDs, report ID ranges, review-state constraints, and URLs. Never fetch a supplied URL with privileged credentials or treat document text as executable instructions.
4. **Stage idempotently:** use content-addressed batch key and stable per-batch candidate key. A second run of identical input is a no-op; changed input creates a new version. No updates to `public.universities`, student profiles, published guidelines, grading schemes, or live service flags in the staging importer.
5. **Reconcile identity:** compare exact names, verified aliases and known mappings with current UUIDs. Normalisation may propose matches but cannot merge solely by a fuzzy score; similarly named Kano/Sokoto institutions stay distinct.
6. **Recover primary evidence:** prioritize official register identities, non-UNIBEN pilot institutions and UNIBEN academic profiles; then programme relationships needed by real users. Recover the 30-page report's missing citations before upgrading those claims.
7. **Resolve conflicts:** academic steward reviews side-by-side claims, dates, unit types, campus and cohort. Academic-source publication and financial/admin privileges remain separate capabilities. Record reason and exact chosen version.
8. **Publish approved records:** transactional, permission-checked publication creates/links target records and marks the batch mapping. Publish only reviewed catalogue entries; unsupported rules remain draft. Review UI displays source, coverage warning and change preview.
9. **Rollback safely:** staging batches may be archived. Publication rollback restores the prior approved version and mappings; it must not delete real users or erase student-entered historical labels. An existing profile referring to a superseded programme retains its history.
10. **Refresh evidence:** review reminders keyed to effective period, session and known conflict. Missing data remains unknown rather than becoming a national default.

## 6. First implementation tranche

Requirements directly covered: **146** (source ingestion/provenance/coverage), foundation for **5–6, 32, 147–151, 157, 159**. It does not by itself complete the student's registration journey (**144–145, 152–156, 158**), programme publication, a reviewed all-university catalogue, or official CGPA policies.

Repository deliverables in this tranche: a versioned staging-only manifest under `database/imports`, a deterministic validator/dry-run importer under `server/scripts/import-academic-sources.mjs`, matching additive staging tables, source conflict register, and tests of repeated ingestion and review preservation. Credentials use the already established server-only `DATABASE_URL`; no new provider secret is required just to stage academic evidence. Dry-run requires no credentials.

Admin workspaces needed next: Universities, Academic Units, Programmes, Source Documents, Import Batches, Conflict Review, Missing-data Submissions, Rule Versions, Publication History. Permissions: academic.view, academic.import, academic.review, academic.publish, academic.merge; server must enforce allowed institution scope. The global NUC identity source can be shared, but staff cannot obtain student or other-institution operational records from it.

## 7. Acceptance tests and evidence boundary

- Re-run identical manifest: same batch/candidate identities, no duplicate rows, reviewed candidates remain reviewed.
- Change one source hash/claim: new batch version, original remains recoverable.
- Inject duplicate report reference, invalid page, malformed URL or unrecognised document key: fail before database writes.
- Simulated write failure: transaction rolls back batch, sources and candidates together.
- Import a confirmed institutional alias: creates a proposed match, not a second published institution or an automatic merge.
- Stage UNIBEN Pharmacy and part-time Computer Science rules: neither becomes a university-wide threshold.
- Select a non-UNIBEN institution with incomplete cataloguing: student can save a provisional profile; unavailable map/vendors/rules are honestly unavailable.
- Missing-department submission survives steward approval and maps to the approved record without changing unrelated student data.
- Institution-specific staff cannot read/approve another institution's private submission or publish outside their scope through a modified API request.
- GPA uses the user's approved programme/cohort scheme, or asks for an explicitly labelled custom scale; never silently applies the schema's historic generic default.

No importer run is evidence that all programmes are verified, all source links are current, all degree rules are safe to calculate, or the mobile/backend journey works in production. Record local test results separately from any later deployment and real-user/device verification.

## 8. Implementation and verification checkpoint

Implemented in the repository on 21 September 2026:

- `database/imports/2026-09-21-academic-sources/manifest.json` and its README/conflict register.
- `server/scripts/import-academic-sources.mjs`, defaulting to offline dry-run and writing only the three evidence-staging tables when explicitly applied.
- `database/imports/academic-importer.test.mjs`, exercising the staging-table DDL from migration `20260921100000_operations_permissions_academic.sql` in local PGlite PostgreSQL.

Observed dry-run: 2 documents; 530 claims; zero database accesses; zero published live records. Claims are 328 institution rows, 69 profile section references, 38 rule section references and 95 cited URL records. Rule/programme values have not been normalized or published by this tranche.

Test result: 6/6 passed. Verified batch determinism, provenance rejection, idempotent repeated staging, preserved prior review decisions, preservation of an existing real university and grading configuration, new extraction-version history, and full rollback after an injected SQL failure. An initial test fixture lacked the existing institution configuration table after the shared migration gained a grading-status amendment; the fixture was corrected and the complete run passed.

No live database or deployment was accessed by this subtask. No secrets were read or printed. No new environment variable is required. The existing server-only `DATABASE_URL` is used only for a later explicit apply invocation.
