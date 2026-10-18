# SCRUM-10: local safety controls

Use the [canonical runbook](../DEPLOY-CORTEX.md) for deployment, recovery, rollback and confirmed public validation. See the [HTTP abuse boundary](SCRUM-10-abuse-boundary.md) for edge enforcement and identity assumptions. This note describes the checked-in implementation; it does not establish equivalence with currently published workflows.

## Synthetic targets and reset

`lib/synthetic-targets.ts` and workflow exports 02/03 contain an explicit mapping for John Carter, Sarah Connor, T'Challa Udaku, Ellen Ripley, Arthur Dent, Marty McFly and Dana Scully. The application rejects emails outside this list. Code nodes validate seven entries and seven distinct IDs before GCP calls, without deriving IDs from email or using fallback accounts.

Reset also requires the database to contain exactly the seven distinct allowlisted emails. Extra, missing or duplicate rows block the workflow before operation acquisition. Inspect compares `body.email === expected_email`, including the account, validated `GCP_PROJECT_ID` and `iam.gserviceaccount.com` domain.

Reset inspects seven accounts, aggregates results, authorizes once, expands only necessary writes and records once. The ledger's `writes` count represents batch authorization, not necessarily the number of modified accounts. Prior `unknown` results, missing responses or uncertain probes block writes. The lock has no automatic expiration.

Local offboarding/reset exports require Header Auth; operators must bind actual credentials during a deliberate deployment. Reset uses POST and its Schedule Trigger is disabled in the export. These source settings do not prove published activation or credential configuration.

## Local handover behavior

The UI previously submitted reports through `POST /api/iam-hr?type=report`; the dashboard path now exports GET only. In the current checkout, `POST /api/iam-hr/action?type=report` and `POST /api/lead-capture` return `403 HANDOVER_DISABLED` before reading bodies or calling upstream, regardless of environment values. No environment flag reactivates these routes without a code change.

The operation ledger covers offboarding/reset, not email reservations, quotas or delivery deduplication. `automation/sql/handover-eligible.sql` is a local query contract accepting an exact allowlisted email with an OFFBOARDED employee. It is not a published workflow or delivery pipeline. Local route rejection does not protect a separate direct published endpoint or establish whether that endpoint is active.

A future delivery design would need an atomic reservation by operation/cycle and recipient, a persistent quota with a defined window, conservative handling of uncertain sends, server-only webhook authentication, prevention of direct bypass, and exact-email eligibility for a completed operation. An uncertain reservation must not be resent automatically. Concurrent tests and published configuration review are needed before reintroducing delivery. The confirmed edge action limit alone does not establish these email controls.

## Verification limits

The isolated suite uses in-memory PGlite, Code/SQL/HTTP workflow simulation, mocked fetch and static React rendering. Negative cases cover allowlists, missing/colliding/repeated IDs, incorrect project/domain/account, batches and unknown results. Handover queries reject ACTIVE/external targets; repeated route requests are rejected without upstream calls.

This coverage does not establish real-service recovery, published SQL equivalence, direct-webhook protection, browser hydration or email delivery. Refer to the runbook for the supplied public observations; no valid offboarding or reset was submitted in that validation. No external execution is required for documentation maintenance.
