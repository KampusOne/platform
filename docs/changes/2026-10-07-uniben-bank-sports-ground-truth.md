# UNIBEN Ugbowo ground-truth correction — 2026-10-07

## Why this correction exists

A student on Ugbowo Campus reported two concrete placement errors in the current KampusOne map:

- the **UNIBEN Sports Complex** marker was shown in the auditorium / central academic block even though the sports complex is not there;
- the visible **bank branches** were rendered too far south instead of inside the bank block marked in the supplied KampusOne screenshot.

This patch treats the on-campus report as a correction to the earlier screenshot reconstruction, not as a UI-only adjustment.

## Sports correction

- UNIBEN Sports Complex is removed from the stale point at 6.399763, 5.613578.
- It now resolves to the already-mapped **Main Bowl** sports cluster at 6.399200, 5.612950.
- Main Bowl itself is **not moved** by this correction.
- The Sports Complex verification timestamp is cleared because the corrected point is a cluster anchor, not a surveyed entrance.

## Bank correction

The six campus bank records visible in this map area are moved into the user-marked bank block:

- Wema Bank
- Zenith Bank
- Guaranty Trust Bank
- Stanbic IBTC Bank
- First Bank
- Fidelity Bank

Their previous relative ordering is retained while the group is translated and compressed into the marked block so the map no longer shows the banks in the known-wrong southern area.

The individual bank points are deliberately **unverified** and use reduced confidence (0.45) until a field walk confirms each exact entrance/building centroid.

## Data flow covered

The correction is applied consistently to:

- the live-database migration path;
- the server fallback directory;
- the mobile/offline fallback directory;
- the fallback generator;
- regression tests.

The original 2026-10-06 review artifact remains intact as historical provenance. A separate 2026-10-07 correction overlay records the newer ground-truth report instead of rewriting the old review history.
