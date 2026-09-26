# Nigerian university catalogue: checked source snapshot

Snapshot retrieved 26 September 2026. This directory fixes a publication gap: the older 328-institution compilation was imported into evidence staging only. `/v1/student/catalog` already read every published university; there was no UNIBEN-only filter to remove. Staging those claims did not create selectable universities.

## Exact coverage

| Data | This snapshot | Boundary |
| --- | ---: | --- |
| Federal universities | 77 | Names exactly as listed by NUC at retrieval |
| State universities | 69 | Names exactly as listed by NUC at retrieval |
| Private universities | 182 | Names exactly as listed by NUC at retrieval |
| Total university identities | 328 | Institution listing, not programme accreditation |
| ABU faculties | 18 | Main university faculty directory |
| ABU department/faculty relationships | 67 | Relationships appearing in the retrieved undergraduate catalogue |
| ABU selectable programmes | 101 | Unique, mapped records from 114 source rows |
| Withheld programme rows | 11 | Pharmaceutical Sciences and ABU Business School do not match main faculty-directory labels |
| Duplicate source programme rows | 2 | Preserved as source gaps; not duplicated in selectable data |

The snapshot preserves source URL, retrieval date, raw-response SHA-256, publisher, source row and original label. Six undergraduate catalogue pages were fetched, rather than stopping at the first 20 rows. Numeric duration values remain source evidence; the importer does not infer entry-route-specific graduation years from them.

Primary sources:

- https://www.nuc.edu.ng/nigerian-univerisities/federal-univeristies/
- https://www.nuc.edu.ng/nigerian-univerisities/state-univerisity/
- https://www.nuc.edu.ng/nigerian-univerisities/private-univeristies/
- https://abu.edu.ng/faculties/
- https://programmes.abu.edu.ng/programmes_list.php?tab=6&goto=1 (pages 1 through 6)

The NUC overview and cached search renderings did not consistently show the same category counts. These counts come from the three actual directory tables retrieved in this snapshot, not the home-page counter or an older compilation. No claim is made that every listed institution is currently accepting admissions or has live KampusOne services.

## Remaining gaps

This is **not a complete nationwide faculty/department dataset**. Other institutions remain selectable, with a provisional academic-profile path where their reviewed directory is incomplete. The source compilation's 530 claims remain separate and unverified; none is silently upgraded by this import.

Direct retrieval of UNIBEN's main, faculty and registration-portal pages failed with HTTP 403/502. Indexed official pages disagree on engineering programme/department structure and use both legacy and newer faculty labels. Existing UNIBEN IDs, student profiles and labels are preserved pending a reviewed mapping. This tranche does not silently relocate a student's Computer Engineering department or pretend a legacy combined faculty label is correct.

No institution-specific dress codes, attendance percentages, academic progression rules or grading schemes were generated. The guidelines screen offers useful general study guidance, explicitly labelled as KampusOne advice, alongside any reviewed official rules.

## Safe publication

Apply additive migration `20260926170000_academic_catalogue_provenance.sql` after the existing academic/programme migrations. Then run from the repository root:

```sh
node server/scripts/import-primary-catalogue.mjs --dry-run
node --test database/imports/primary-catalogue.test.mjs
```

Default dry-run reads no database and uses no credentials. To reconcile against a saved catalogue fixture without a database, add `--existing fixture.json` with `universities`, `faculties`, `departments` and `programmes` arrays.

A later authorized publication uses the existing server-only `DATABASE_URL`:

```sh
node server/scripts/import-primary-catalogue.mjs --apply --environment staging
```

Use the actual target environment explicitly. **`--apply` adds real live catalogue entries**, unlike the older staging importer. It matches exact names, explicit aliases and parent-scoped slugs; ambiguous and archived identities fail for review. Stable IDs, uniqueness constraints, a transaction, catalogue locks and stale-match checks prevent partial or stale publication. Existing names, student IDs, profiles, institution service status and grading settings are not overwritten. New institutions receive `CATALOGUED` service status and an empty/unverified grading scale, not a claimed universal policy. The import records its source manifest and hash; rerunning is idempotent.

Rollback means reviewing the added record IDs from the snapshot against usage, not deleting institutions now referenced by real students. Revoke/repair cataloguing through the reviewed administrative workflow while preserving user history.

## Application behavior

- Onboarding loads the small university list first, then the selected university's hierarchy. Older clients retain the unfiltered catalogue contract.
- Search matches names, slugs, explicit aliases and multiple search words. Switching institutions clears dependent selections and ignores stale network responses.
- Deleted university/faculty/department ancestry is excluded from descendants.
- Empty faculty lists lead into clearly provisional manual entry rather than disabled pickers. A missing department can be submitted for staff review even when part of a faculty's directory exists.
- General guidance remains available if no official guideline is published or the guideline service is temporarily unavailable.

Local verification: importer PostgreSQL tests passed (4/4), scoped catalogue route tests passed (2/2), and server/mobile TypeScript checks passed. Tests cover preservation of a live institution's IDs/status/grading, idempotence, rollback, invalid/ambiguous provenance, archived records, scoping and deleted ancestry. No production database, publication or deployment was performed by this subtask. Native visual review and live importer application remain release tasks.
