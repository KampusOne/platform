# Onboarding academic-structure import — 2026-09-28

## Why this exists

The 2026-09-27 onboarding catalogue intentionally published Nigerian university identities only. That made the University selector broad, but left most Faculty and Department selectors empty. UNIBEN also continued to expose its older tiny seed.

This import fixes the data layer without inventing academic structure.

## Source precedence

1. **First-party university sources** — used for University of Benin.
   - https://waeup.uniben.edu/faculties
   - https://news.uniben.edu/advertisement-for-teaching-and-non-teaching-staff-positions-university-of-benin-2/
   - https://educ.uniben.edu/
   - https://arts.uniben.edu/
2. **Researched 2026 Nigerian-university baseline** — used only when a university can be matched safely by official website domain or an exact/prefix-equivalent institution name.
   - https://github.com/reality-farouqk/nigeria-tertiary-institutions-api
   - MIT-licensed dataset; its methodology explicitly preserves unknown structure rather than fabricating it.
3. **Manual/provisional onboarding fallback** — remains the safe path when an institution/faculty does not publish enough structure yet.

## Import rules

- Never fuzzy-match a school merely because the names look similar.
- Never convert acronym-only parentheses such as `(SAAT)` into a department.
- Never infer a department or programme from a faculty name.
- Do not infer degree programmes in this migration.
- Prefer first-party current data when it conflicts with the researched baseline.
- Bind to the existing university **name/ID**, not the proposed slug, so legacy rows (notably UNIBEN) are supported.

## Current generated coverage

- 308 safely matched catalogue rows against the external 2026 university snapshot.
- 236 non-UNIBEN universities contribute at least one parseable faculty/school/college row.
- UNIBEN is overridden separately with 21 current faculty/school-level units and 148 department rows.
- The migration contains 1,434 distinct faculty/school entries and 577 department rows in total.
- Seed generation found zero faculty-slug collisions and zero department-slug collisions.

These counts are a **coverage baseline, not a claim that every Nigerian university has a complete public department directory**. See `coverage.json` for the explicit research queue.

## Regression guard

The migration aborts if University of Benin is missing, has fewer than 20 active faculty/school units, or fewer than 100 active departments after import. This prevents the two-faculty regression from silently returning.

## Deployment note

Adding this file to the repository does **not** deploy it. Production/staging should run the normal Neon migration process only after review.
