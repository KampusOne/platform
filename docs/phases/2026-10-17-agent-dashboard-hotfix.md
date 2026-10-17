# Agent dashboard and discovery hotfix — Android 0.3.38 / 68

This patch addresses the reported seller analytics failure, store-profile save rejection, slow agent screens, and tutor dashboard/search changes. It extends the existing campus release; it does not change payment providers, ledger accounting, delivery prices, or installed migrations.

## Corrections

- Seller analytics used `day` as an invalid unqualified SQL alias. The replacement returns fourteen ordered calendar dates in Africa/Lagos, bounds the order scan to that interval, and retains paid-order visibility and each vendor’s combined-order allocation. Loading and errors no longer display an invented zero sales total. Refresh cancellation prevents a late response from replacing a newer read.
- A blank opening-hours field previously became `{schedule: ""}`, which the API correctly rejected. Saving now omits the empty schedule, normalizes Nigerian mobile numbers, validates each field visibly, and preserves preparation minutes and every saved pickup location. The API returns field-specific validation details. Older nested opening-hours records display readable text. Already approved stores do not offer an invalid review submission.
- The store screen reuses the pickup points returned with its profile instead of downloading the entire profile a second time. Store pickup and rider delivery are the displayed options; the unused vendor-delivery switch is removed. A failed second save stage explicitly distinguishes saved details from unsaved delivery settings.
- The tutor dashboard retains the uncircled summary and shortcut row, followed by one primary **Upload** button. Role switching, the public tutor profile, trial and booking settings are in its menu. Upload opens the existing learning publisher. Material rows no longer link to a session-only management screen.
- Tutor discovery searches the database before result limits. The same query searches tutor names/specialties and material titles, descriptions, course codes, subjects, formats and playlist part titles. PDF/video/audio/material and playbook/playlist vocabulary is shared by the client and API. Superseded searches are cancelled. Existing block, active-role, tenant and paid-access constraints remain authoritative.

## Loading work removed

These counts concern route queries; the independent live session check remains in place.

| Path | Before | After |
| --- | --- | --- |
| Agent role check | Two sequential database requests | One statement restoring expired holds and reading the role |
| Seller analytics | Four route database requests | Two; the validated role is reused only inside the same request |
| Account capabilities | Three sequential database requests | One statement returning roles and communities |
| Store profile UI | Two full profile HTTP requests | One; map choices reuse its response |
| Store profile ancillary reads | Three sequential reads | Three independent reads started together |
| Tutorial catalog pricing | Repeated policy lookup for sessions and materials | One shared policy lookup, with independent readiness checks started together |
| Empty material search | Also waited for pricing readiness | Two catalog queries, then immediate empty response |

Authorization is not cached across requests, and financial data is not made persistently cacheable. Query-count regression assertions cover analytics, capabilities and empty discovery. These counts are not a measured promise about every phone or network.

## Verification and release

Focused API tests execute real PostgreSQL queries against the schema-only PostGIS fixture and current campus migration. They cover empty and combined sales, Lagos date boundaries, unpaid/foreign exclusion, complete store save/reload, temporary/permanent role suspension and restoration, tutor search, literal search wildcards, and blocked tutor exclusion. Seven stateful UI regressions cover form errors/recovery, duplicate location reads, analytics retry and the tutor Upload action.

The full Node regression suite passed (371 tests). Contracts checks and tests passed (10). Mobile and server TypeScript checks and server production compilation passed. Expo web export passed (109 routes). The full server suite passed (133 files, 1,141 tests), followed by the focused recovery suite after the final search/form refinements. Release workflows repeat the exact-source checks and verify the signed receipts before distribution.

The repaired analytics statement also executed successfully on the live database with synthetic nonexistent tenant/vendor filters, returning fourteen aggregate rows. Schema inspection confirmed the referenced columns already exist. No database migration is required. This is not an authenticated physical-phone performance benchmark.

The generated cache-route inventory is refreshed for changed source line locations; its 518 route policies remain unchanged. Worker deployment also checks this inventory before publication.

The versioned APK workflow checks source/main identity, the matching Worker deployment, package `app.kampusone.mobile`, version code 68, ARM64, target SDK and the existing signing certificate. Website download publication additionally requires matching web deployments. The previous versioned APK remains available for rollback. Bachs Connect payout activation remains the existing external dependency.
