# 21 September 2026 academic evidence snapshot

This snapshot stages the supplied university research as **unreviewed source claims**. It does not publish institutions, official academic rules, degree durations, grading scales, or student profile changes.

| Claim kind | First report | Conversation conversion | Total |
| --- | ---: | ---: | ---: |
| Institution register entries | 328 | 0 duplicate inventory imports | 328 |
| Profile section references | 47 | 22 | 69 |
| Rule section references | 18 | 20 | 38 |
| Cited primary-source URLs | 95 | 0 recoverable | 95 |
| All claims | 488 | 42 | 530 |

There are 51 distinct profiled institutions after overlap. Profile and rule claims here identify source sections; they are **not a normalized import of all the departments, programmes or rule values**. Those need typed extraction, source recovery and institutional review. The second report explicitly lost the original chat citation URLs during PDF conversion. Neither PDF is an institution-issued rulebook.

`manifest.json` preserves file SHA-256, page counts, report-local identifiers, raw names and named websites, ownership, coverage code, profile/rule page references and the 95 original hyperlink destinations. Full copyrighted primary handbooks are not included. Research dates in the file are source claims; original URLs have not been freshly verified by this importer.

## Run

From the repository root:

```sh
node server/scripts/import-academic-sources.mjs --dry-run
node --test database/imports/academic-importer.test.mjs
```

Dry-run is the default. It validates local input and previews immutable batch hashes without loading credentials or accessing the database.

Apply the reviewed additive migration `database/neon/migrations/20260921100000_operations_permissions_academic.sql` to the intended database through the established migration process first. With the existing server `DATABASE_URL` supplied securely to the current process:

```sh
node server/scripts/import-academic-sources.mjs --apply --environment staging
```

`--environment` records the intended target in the batch log; it does not change or verify which database the connection string selects. Do not paste the URL in a terminal command argument, commit an env file, or copy a production value into a preview deployment. No new environment variable is introduced.

For a reviewed alternative manifest, pass `--manifest path/to/manifest.json`. An updated extraction must increment `extraction_version`. A source-file revision must have its actual new SHA-256 and page metadata. The script validates the manifest but does not have or re-hash the supplied PDF files during each import.

## Invariants

- Only `academic_source_documents`, `academic_import_batches` and `academic_source_claims` are written.
- Parameterized statements are submitted in one transaction. Failure rolls back the import.
- Document keys include the content hash; batch hashes include extraction version and sorted claims.
- Identical re-imports use `ON CONFLICT DO NOTHING`: review decisions, rejected records, and prior batch metadata are preserved.
- Changed sources or extraction versions create new evidence versions. They do not supersede published rules automatically.
- All candidate rows enter `PENDING`; coverage/citation metadata remains explicit. A reviewer approving a claim is not itself implementation of a production publication workflow.
- Real institutions, student profiles, academic relationships, guidelines, grading scales and campus services are never replaced by this script.

## Next review and rollback

Read [source-audit.md](source-audit.md) and [source-conflicts.md](source-conflicts.md) before creating published catalogue changes. Resolve raw-name aliases against existing university UUIDs and check the applicable primary documents. Do not turn report-local F/S/P identifiers into regulator IDs, assume all computing degrees last four years, or use one institution's attendance/pass threshold for another.

A staging batch can be retained and marked archived/rejected by the eventual authorized review workflow. Reversal of published catalogue changes requires separate versioned publication mappings; this importer cannot reverse or delete live data because it never writes it. Record the batch hash, environment, executor and review decision in the normal operations handoff.

Requirement links: source ingestion foundation for 32, 146, 157 and 159; supports later 5–6 and 147–151. This snapshot alone does not complete multi-university onboarding or nationwide academic-rule coverage.
