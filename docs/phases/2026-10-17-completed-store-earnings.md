# Reconcile historical delivered store earnings

Orders delivered before the 17 October immediate-release trigger was installed could remain `PENDING`: installing the trigger only affected future updates. Add an idempotent reconciliation for already-delivered, provider-settled inclusive orders with a completion timestamp, matching price/settlement tenant and seller net, no open dispute, and no existing release journal.

The migration requires the real earnings trigger to be enabled and changes only the earnings state. The existing trigger posts balanced, append-only pending-to-available journal entries. It never changes delivery status, closes a dispute, invents a payment, edits a balance, or calls a payment provider.

The reported ₦900 represented three ₦300 orders. One was delivered without a release journal; one has an open dispute; one is paid but remains undelivered. Production reconciliation released only the eligible ₦300. The live ledger now shows ₦300 available and ₦600 pending, with both remaining holds preserved.

Validation: 56 finance regressions passed, including an historical-state fixture, double application, active and inconsistent dispute holds, unverified payments, balanced single posting, disabled-trigger rejection, and the Earnings API projection. Server types/build and 518 mounted route policies passed. Native SQL was rehearsed with rollback on the existing rehearsal branch, then a rolled-back production dry run verified the exact current records before installation. Exact source and live verification are recorded in `database/verification/production-20261017-completed-store-earnings.json`.

No app or API changes are required. Reopening Earnings refreshes the live ledger in the existing APK.
