# Profile saved-learning refinement — Android 0.3.39 / build 69

The profile previously displayed saved learning as an uncontained text link against the screen edge. Replace it with one full-width library card aligned to the profile gutters: a warm icon tile, “Saved learning” title, format description, and trailing navigation chevron. The complete card opens the existing `/saved-learning` route.

The card uses existing theme tokens and icon assets, adapts to light/dark appearance, allows text to wrap at narrow widths and large font settings, exposes a screen-reader label and hint, and provides keyboard-focus and pressed feedback without animation. It adds no requests, image downloads, dependencies, or saved-item counts.

Validation: mobile TypeScript check, 39 existing workspace/performance/release regressions, 518 mounted route-policy checks, and the production mobile web export (109 routes). No API, schema, or payment changes; no migration is required. Native signing and publication remain subject to the existing exact-source release workflow and its artifact receipts. A physical-device visual test has not been performed in this environment.
