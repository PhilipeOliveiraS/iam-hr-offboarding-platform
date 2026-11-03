# IAM-HR deployment and recovery runbook

This is the canonical operational runbook for the integrated IAM-HR demo. It consolidates the valid deployment, selective recovery and rollback guidance from the retired duplicate guide. Use the frontend in `app/`, `components/` and `lib/`; do not overwrite it with a legacy ZIP.

## Confirmed public validation

Operator-provided evidence for one validation round:

- [Public IAM-HR site](https://iam-hr.ph3digital.com.br/) returned HTTP 200.
- Public `GET /api/iam-hr` returned HTTP 200 with JSON.
- An action POST targeting an external account was rejected with HTTP 400 and `TARGET_NOT_ALLOWED`.
- In one rate-limit test round, five attempts received application HTTP 400 responses and the next three received Cloudflare HTTP 429 responses. The configured limit is five requests per 10 seconds with a 10-second mitigation period.
- No valid offboarding or reset action was submitted during this validation.

This was one test round, not a load test. It does not establish sustained capacity, connector success, selective recovery, complete origin isolation or production readiness. These observations were supplied for documentation; no external checks were repeated for this change.

## Current source configuration

`compose.iam-hr.yml` defines a separate `iam-hr-preview` project, binds `127.0.0.1:3001:3000`, and joins the external `factory_default` network. The image uses Node 24 and Next.js standalone output. The existing backend stack and production seed are not provisioned by this repository.

| Setting | Current source behavior |
| --- | --- |
| `N8N_GET_DATA_URL` | Compose uses `http://n8n:5678/webhook/iam-hr-data` |
| `N8N_OFFBOARD_URL` | Compose uses `http://n8n:5678/webhook/iam-hr-action` |
| `N8N_WEBHOOK_KEY` | Compose passes the private runtime value; the IAM proxy sends `X-N8N-Webhook-Secret` when present |
| `N8N_REPORT_URL`, `N8N_LEAD_CAPTURE_URL` | Report URL selects protected workflow 04; the legacy lead setting does not enable its blocked route |

The browser reads `GET /api/iam-hr` and submits offboarding to `POST /api/iam-hr/action?type=offboard`. There is no POST handler on the dashboard path. The action path exports POST only.

The restored local report action requires a completed synthetic operation and server-side webhook authentication. `POST /api/lead-capture` remains blocked. The old unauthenticated handover workflow must not be reactivated. The sanitized workflow 04 source is a deployment template, not a directly importable production export; its existing provider URL/authentication and credential bindings must be preserved by the publisher.

## Prepare a deliberate frontend deployment

Preserve the working tree, private configuration, current image and published workflow backups. Use a separate staging directory; transfer only the required frontend sources, Dockerfile, `.dockerignore`, Compose file and package/configuration files. Exclude `.git`, `.env*`, dependencies, ZIPs, dumps and credentials. Do not transfer or import workflow/SQL files as part of a frontend-only update.

Before starting the service, confirm the existing network, `n8n` alias, available host port, resources and dashboard/offboarding authentication. Use the existing canonical private environment file `~/.config/iam-hr-preview.env` with mode 600; do not duplicate its secrets into `.env.runtime`. Compose accepts an empty webhook key, so configuration validation alone does not prove authentication is ready. Supply the existing matching key without printing it. Report delivery also requires the protected published workflow and migration 003; the lead route remains blocked.

From the staged frontend directory, during an authorized deployment window:

```sh
docker compose --env-file "$HOME/.config/iam-hr-preview.env" -f compose.iam-hr.yml config --quiet
docker compose --env-file "$HOME/.config/iam-hr-preview.env" -f compose.iam-hr.yml build iam-hr
docker compose --env-file "$HOME/.config/iam-hr-preview.env" -f compose.iam-hr.yml up -d --no-deps iam-hr
docker compose --env-file "$HOME/.config/iam-hr-preview.env" -f compose.iam-hr.yml ps
```

Use this separate Compose project; do not run `down` or `--remove-orphans` against the shared backend stack. Keep previous images and source artifacts for rollback. Avoid printing resolved environment values or unrestricted container inspection output. Building requires access to package/image registries and Google Fonts.

The healthcheck requests the local page only. Opening the sandbox polls its configured dashboard backend. Any valid action, reset or migration requires a separate deliberate operational validation window; none is needed to publish documentation.

## Edge action limit

The confirmed Cloudflare limit is five requests per 10 seconds, with 10 seconds of mitigation. The action boundary is the dedicated public hostname and exact path `/api/iam-hr/action`; query strings must not create separate buckets. The dashboard path `/api/iam-hr` is separate. See [abuse boundary](docs/SCRUM-10-abuse-boundary.md) for the rule scope and limits of the evidence.

The application does not authenticate a client identity from forwarded IP headers or implement a shared HTTP quota. A loopback port binding does not exclude access from containers on the shared network. Preserve webhook Header Auth and review alternate origin paths independently of the successful edge test.

## Backend recovery installation prerequisites

The recovery sources extend an existing installation. Before any separately authorized backend update, back up the database, ERP source/state and currently published workflows. The migration requires existing `employees` and `audit_log` tables. The ERP requires its existing FastAPI/Pydantic environment and JSON seed (`MOCK_ERP_SEED`, default `./seed.json`). A rebuild may restore seed state if it lives in the container writable layer.

Apply `database/002-operation-recovery.sql` only after checking the current schema and a valid database backup. It is additive and transactional; `IF NOT EXISTS` does not repair incompatible existing tables. Never apply `tests/fixtures/schema-original.sql` to the demo database, replace the production schema/seed or delete volumes. Backend service names, users and paths must be verified against the actual stack; the frontend Compose file is not a backend migration environment.

Import workflows 01/02/03 from `automation/n8n/` as inactive workflows for review, rather than automatically replacing runtime:

- Bind the existing Postgres credential to every Postgres node and the GCP credential to GCP Inspect/Apply in 02/03.
- Configure matching Header Auth on the offboarding/reset webhooks. GCP inspection also needs `iam.serviceAccounts.get`; verify `GCP_PROJECT_ID` and the explicit seven-account mapping.
- In both 02 and 03, ERP Inspect/Apply and GCP Inspect/Apply require `parameters.options.response.response` with `responseFormat: "text"`, `fullResponse: true`, `neverError: true` and `outputPropertyName: "body"`. Without the last setting, text defaults to `data` while classifiers read `body`.
- The exported paths are GET `/webhook/iam-hr-data`, POST `/webhook/iam-hr-action` and POST `/webhook/reset-system`. Reset's Schedule Trigger is disabled in the local export; this does not establish published activation state.

Drain running executions and unpublish older mutation workflows before deliberately publishing replacements: older versions may bypass the persistent lock. Do not overlap webhooks with identical methods/paths. Preserve the published handover separately; no handover export in this repository establishes its current configuration. Do not automatically invoke reset after an import. Plan any valid-action acceptance checks separately and inspect operation/connector results; a green n8n execution or HTTP 200 alone is insufficient.

## Selective recovery and diagnostics

The global lock does not expire automatically and also protects reset. Resume a partial operation with the same `operation_id` in the same cycle. Successful connectors are skipped. Explicit write rejection can be retried; uncertain transport, timeout, 5xx or inconclusive writes may remain `unknown`. A later read does not prove the previous write finished. HTTP 200 with `success: false` or a `partial`/`unknown` operation is incomplete business execution.

For authorized database diagnostics:

```sql
SELECT * FROM iam_runtime;
SELECT id, cycle, kind, target_email, status, attempts, processing_ms
FROM iam_operations ORDER BY id DESC LIMIT 10;
SELECT operation_id, connector, status, checks, writes, detail
FROM iam_steps ORDER BY operation_id DESC, ordinal LIMIT 30;
```

If an execution stopped, identify `iam_runtime.owner` and confirm that the execution and all earlier requests have ended before releasing it:

```sql
SELECT iam_release_stopped('EXACT_STOPPED_EXECUTION_ID');
```

A step whose write began remains `unknown`. Only after confirming request termination and inspecting the target, record concrete evidence before allowing a new attempt:

```sql
SELECT iam_resolve_unknown(OPERATION_ID, 'gcp', 'Actual evidence of request termination and observed state.');
```

Replace `OPERATION_ID` with the actual numeric ID. The function changes `unknown` to `failed`; resume inspects again and skips a write if the desired state is confirmed. Never edit statuses directly to force success. These administrative functions have no public authorization endpoint.

`processing_ms` counts active attempt time; `elapsed_ms` includes waiting between attempts. Successful offboarding averages use a 24-hour window. The UI's “vs 48h manual” is a comparison reference, not a measured baseline.

## Local checks and remaining acceptance

For isolated checks with mocked HTTP and in-memory PGlite:

```sh
npm ci
npm --prefix tests ci --ignore-scripts
npm --prefix tests test
```

Local checks do not establish browser hydration or complete production workflow equivalence. Operation 158 later confirmed selective recovery, preserving Postgres/ERP writes and independently verifying the exact GCP account disabled. Concurrent reset/offboarding exclusion, Firefox hydration and remaining workflow comparisons are separate acceptance items. The historical public validation above did not submit valid actions or validate handover delivery. Handover-specific isolated concurrency and build evidence appears below.

## Rollback

For a frontend rollback, restore the preserved image/source and private runtime settings in the separate project. If stopping is necessary, target only its service:

```sh
docker compose --env-file "$HOME/.config/iam-hr-preview.env" -f compose.iam-hr.yml stop iam-hr
```

For a separately authorized backend rollback, unpublish replacement mutation workflows, verify no executions or requests remain in flight, and resolve uncertain writes before reactivating older workflows. Restore actual verified workflow/ERP backups, not unverified legacy exports. Additive `iam_*` tables may remain for diagnostics. Restoring a database dump requires review of newer audit data; never discard recent audits or delete volumes blindly.

## Handover restoration — approved 29 October 2026

The restoration was based on workflow 04 version `a410bcaa-5512-4e33-8226-6fb4628ae299`. Parameter comparisons against that selected baseline do not establish complete historical prompt/template fidelity: the user perceived a report difference, and comparison of earlier prompt/model/subject/body versions remains pending. The client supplies only `operation_id`, `target_email`, and `visitor_email`; employee data comes from Postgres. Address validation checks format, not mailbox ownership.

The approved policy is **20 new reservations globally per rolling 24 hours**, checked atomically before Gemini/Gmail. `iam_handover_config.max_reservations` stores the configurable limit. A short row lock serializes admission and the quota check; a unique constraint on `(operation_id, recipient)` deduplicates normalized recipients. Failed/unknown reservations consume quota. Existing requests return their state without another generation/send or quota charge. There is no additional IP/recipient quota, CAPTCHA, cache or new service.

Eligibility requires the exact allowlisted synthetic employee, `offboard/succeeded`, current cycle and all three successful connectors. Reservation and send authorization recheck eligibility under a short runtime-row lock. No database transaction remains open during a provider call. A later reset does not retroactively change the report's operation/cycle snapshot; the email remains a draft rather than current revocation evidence.

`reserved` precedes generation. Only the owning execution can atomically transition once to `sending`. Gmail retries remain disabled. Provider acceptance with a nonempty message ID transitions to `sent` and writes audit in one transaction. A transport error, missing receipt or possible send becomes `unknown`. If completion/audit fails after Gmail acceptance, `sending` remains fenced. No expiration permits automatic resend; even a confirmed pre-send failure retains its reservation.

### Rollout and current checkpoint

- Migration `database/003-handover-delivery.sql` has been applied on cortex-01 with limit 20 and zero reservations at verification.
- Operation 158 and its connector/event/audit evidence were compared with the restricted pre-change snapshot and remain unchanged.
- Workflow 04 is active at `ae07ae23-a418-4255-a3bd-3548ff59988d`. Its protected graph, Header Auth bindings and unchanged provider nodes were verified. The complete image `iam-hr:handover-20261029` is now active and healthy (image ID starts `530f11bc994a`), using the canonical private environment file `~/.config/iam-hr-preview.env`. The key is present in the container; dashboard/sandbox GET returned 200 and the restored form is present in served client assets. No report POST or provider call was made.
- Historical intermediate step: `iam-hr:handover-legacy-block-20261029` closed the legacy bypass while the report form remained blocked. It has been superseded by the complete image above. The legacy route remains disabled.
- Subsequent real evidence: request 1 was accepted during controlled recovery (execution 15130), and the user confirmed receipt. A separate public round completed operation 159/request 2 (executions 15134/15141) with provider acceptance. Historical prompt/template comparison remains pending; do not claim full fidelity.

Use the validated API procedure through `python3 automation/deploy/publish-handover.py` with `N8N_API_KEY` and `N8N_API_BASE_URL` loaded securely in the terminal. The script confirms cortex-01, checks migration/configuration, refuses unexpected versions or concurrent edits, backs up restricted workflow snapshots, saves using `publishIfActive=false`, verifies the draft and publishes the explicit revision. It preserves the original provider nodes and binds the existing Header Auth/Postgres credentials. It never invokes a webhook or provider. Inspect state after a partial API failure before repeating.

The preview already points `N8N_REPORT_URL` to the internal workflow 04 webhook and has a server webhook key. Verify binding compatibility without printing values. Build the candidate image separately, then deploy only the three changed frontend sources (action route, blocked legacy route and form), preserving runtime settings and unrelated source. Verify Header Auth and the absence of legacy bypass before activating the form. Do not test a valid report as a deployment healthcheck.

Restricted remote rollback directory for this rollout: `~/.local/state/iam-hr-handover-backups/20261030T004405Z/` (directory 0700, files 0600). It contains the database dump, functional workflow snapshot, protected operation/workflow snapshots, frontend sources and previous image ID. API publishing makes a separate restricted backup and verification manifest. Never put these backups in Git.

### Reviewing abandoned reservations

Read-only inspection:

```sql
BEGIN READ ONLY;
SELECT id, operation_id, cycle, owner, status, created_at, authorized_at, finished_at, result_code
FROM iam_handover_requests ORDER BY id DESC;
SELECT max_reservations,
 (SELECT count(*) FROM iam_handover_requests WHERE created_at > clock_timestamp()-interval '24 hours') AS used
FROM iam_handover_config WHERE singleton;
COMMIT;
```

Inspect only the corresponding n8n execution. Establish that it and its outstanding requests have ended before any administrative classification. A stopped `reserved` request with evidence that send authorization never occurred may be classified `failed_before_send`; an authorized `sending` request without reliable acceptance evidence must be classified `unknown`. Do not infer non-delivery from timeout or from the recipient not seeing an email. Store the evidence in `review_note` in a restricted operator transaction, then use `iam_handover_finish(id, owner, outcome, NULL)` for the conservative outcome. Neither outcome releases the unique reservation or permits resend. `sent` requires provider acceptance evidence and a message ID. Never edit offboarding status or delete a reservation to retry.

### Verification and one real submission

Local checks: `npm --prefix tests run test:handover`, `npm --prefix tests run test:contracts`, targeted lint, production build and `git diff --check`. `tests/handover-concurrency.py` requires an explicitly disposable, network-isolated Postgres container; it uses synthetic fixtures, never the demo database. Mock checks cover invalid/partial/stale targets, server authentication, quota, repeats and uncertainty. Real isolated-Postgres checks cover concurrent admission/authorization, final-slot contention and transaction rollback when audit INSERT fails.

After deployment verification, recheck operation 158 is eligible and no reservation exists for the operator-authorized recipient. In the browser select Dana, enter that one recipient and submit once. Collect request/execution IDs, operation/cycle linkage, reservation and authorization transitions, one generation and one Gmail attempt, provider acceptance ID and audit. Confirm receipt and original English plain-text content independently. Compare operation 158 and its connector counters afterward. Stop on uncertainty; do not resubmit. Acceptance by Gmail is not proof of inbox delivery or external exactly-once behavior.

### Reversal

Disable workflow 04 first using the established API and hide/block the report action/form if rollback is needed. Keep the legacy route blocked. Keep the additive handover ledger and uncertain reservations; do not restore the whole database dump over newer audits. The previous frontend image is available by its recorded image ID, but it contains the old legacy forwarding route, so keep workflow 04 disabled during such a rollback and reapply the legacy block before reactivation. Do not reactivate the old unauthenticated workflow or alter offboarding/reset.

The reservation ceiling controls admissions and helps bound consumption; it is not an exact currency budget, a zero-cost guarantee, or comprehensive protection against abuse. A single reservation's provider cost may vary.

## Checkout: 29 October session continued into 30 October (Recife)

Operation 158 recovered selectively without repeated Postgres/ERP writes. Request 1 recovery finished at 2026-10-30T03:32:44.168522Z (30 October 00:32:44.168522 Recife): one existing reservation, no new Gemini generation, provider acceptance and user-confirmed receipt. Audits 178–181 preserve the original uncertainty, review, one-use recovery authorization and success.

A separate user-operated public round completed operation 159 at 2026-10-30T03:45:11.832643Z and request 2 at 2026-10-30T03:45:42.650426Z (00:45 Recife): one generation, one authorization and one accepted Gmail node execution. Two reservations occupy the rolling 24-hour window, with limit 20. Runtime is free in cycle 118 and reset_pending=false. Receipt for request 2 was not independently established by this verification.

Temporary workflow IamHrRecovery1Once is archived, not deleted; its recovery function was removed. Restricted snapshots/logs/start marker and executions/audits remain. The old run-once command is retired and must not be run again. SCRUM-10 remains in progress. Next session starts with complete diff review and historical prompt/template comparison, then reviewed commits/push; none were performed during this checkout.
