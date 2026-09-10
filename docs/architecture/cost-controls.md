# Cost and provider controls

The default failure mode for a metered dependency is **break before billing**.

Every paid-provider adapter must define:

- a global enable switch and a per-feature switch;
- per-user, per-institution, and global quotas where relevant;
- a hard timeout and bounded retry policy;
- an idempotency key for externally visible mutations;
- a free or degraded fallback when product-safe;
- structured usage records with units, outcome, latency, and provider;
- an alert threshold before the hard cap;
- an operator runbook for disabling and restoring the path.

Push is the default notification channel. Email is reserved for verification, recovery, receipts, and other critical messages. SMS remains disabled until an explicit business and cost decision is approved.
