# SCRUM-10: local safety controls

Use the [canonical runbook](../DEPLOY-CORTEX.md) for deployment, recovery, rollback and confirmed public validation. See the [HTTP abuse boundary](SCRUM-10-abuse-boundary.md) for edge enforcement and identity assumptions. This note describes the checked-in implementation; it does not establish equivalence with currently published workflows.

## Synthetic targets and reset

`lib/synthetic-targets.ts` and workflow exports 02/03 contain an explicit mapping for John Carter, Sarah Connor, T'Challa Udaku, Ellen Ripley, Arthur Dent, Marty McFly and Dana Scully. The application rejects emails outside this list. Code nodes validate seven entries and seven distinct IDs before GCP calls, without deriving IDs from email or using fallback accounts.

Reset also requires the database to contain exactly the seven distinct allowlisted emails. Extra, missing or duplicate rows block the workflow before operation acquisition. Inspect compares `body.email === expected_email`, including the account, validated `GCP_PROJECT_ID` and `iam.gserviceaccount.com` domain.

Reset inspects seven accounts, aggregates results, authorizes once, expands only necessary writes and records once. The ledger's `writes` count represents batch authorization, not necessarily the number of modified accounts. Prior `unknown` results, missing responses or uncertain probes block writes. The lock has no automatic expiration.

Local offboarding/reset exports require Header Auth; operators must bind actual credentials during a deliberate deployment. Reset uses POST and its Schedule Trigger is disabled in the export. These source settings do not prove published activation or credential configuration.

## Handover restoration

The original handover is being restored with the approved persistent controls; its prior disablement was temporary. The action route now validates `operation_id`, `target_email` and `visitor_email`, requires server webhook configuration and returns sanitized results. The legacy route stays disabled. Workflow 04 preserves the previous Gemini/parser/Gmail configuration through the deployment publisher, which refuses incompatible provider changes and unexpected revisions.

Migration 003 reserves before providers, atomically enforces the approved configurable global 20-reservation rolling-24-hour limit and deduplicates by operation/normalized recipient. Failed and uncertain reservations count. Only a completed current-cycle synthetic operation with all connectors succeeded is eligible. A single owning execution can authorize Gmail once; `sending` and `unknown` never expire into permission to resend. Acceptance/audit commit together; failure leaves the sending fence. This does not promise external exactly-once delivery. See the runbook for rollout status, abandoned-request review, rollback and the pending real email test.

## Verification limits

The isolated suite uses in-memory PGlite, Code/SQL/HTTP workflow simulation, mocked fetch and static React rendering. Negative cases cover allowlists, missing/colliding/repeated IDs, incorrect project/domain/account, batches and unknown results. Handover queries reject ACTIVE/external targets; repeated route requests are rejected without upstream calls.

This coverage does not establish real-service recovery, published SQL equivalence, direct-webhook protection, browser hydration or email delivery. Refer to the runbook for the supplied public observations; no valid offboarding or reset was submitted in that validation. No external execution is required for documentation maintenance.
