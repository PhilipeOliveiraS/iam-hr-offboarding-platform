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
| `N8N_REPORT_URL`, `N8N_LEAD_CAPTURE_URL` | Optional Compose settings; current local delivery routes do not use them |

The browser reads `GET /api/iam-hr` and submits offboarding to `POST /api/iam-hr/action?type=offboard`. There is no POST handler on the dashboard path. The action path exports POST only.

In this checkout, `POST /api/iam-hr/action?type=report` and `POST /api/lead-capture` return `403 HANDOVER_DISABLED` before body parsing or upstream access. This establishes local route behavior only. No current published handover export is included, and its activation, credentials and delivery state cannot be inferred from these files or the public checks above.

## Prepare a deliberate frontend deployment

Preserve the working tree, private configuration, current image and published workflow backups. Use a separate staging directory; transfer only the required frontend sources, Dockerfile, `.dockerignore`, Compose file and package/configuration files. Exclude `.git`, `.env*`, dependencies, ZIPs, dumps and credentials. Do not transfer or import workflow/SQL files as part of a frontend-only update.

Before starting the service, confirm the existing network, `n8n` alias, available host port, resources and dashboard/offboarding authentication. Store runtime values privately in `.env.runtime` with mode 600. Compose accepts an empty webhook key, so configuration validation alone does not prove authentication is ready. Supply the existing matching key without printing it. Report/lead URL values do not enable the blocked local routes.

From the staged frontend directory, during an authorized deployment window:

```sh
docker compose --env-file .env.runtime -f compose.iam-hr.yml config --quiet
docker compose --env-file .env.runtime -f compose.iam-hr.yml build iam-hr
docker compose --env-file .env.runtime -f compose.iam-hr.yml up -d --no-deps iam-hr
docker compose --env-file .env.runtime -f compose.iam-hr.yml ps
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

Build/lint and these tests do not establish production workflow equivalence, browser hydration, real concurrency or remote recovery. They were not rerun for this documentation-only change. Remaining acceptance includes real selective recovery, concurrent operation exclusion, Firefox hydration and comparison with fresh published exports. The public validation above did not submit valid actions or validate handover delivery.

## Rollback

For a frontend rollback, restore the preserved image/source and private runtime settings in the separate project. If stopping is necessary, target only its service:

```sh
docker compose --env-file .env.runtime -f compose.iam-hr.yml stop iam-hr
```

For a separately authorized backend rollback, unpublish replacement mutation workflows, verify no executions or requests remain in flight, and resolve uncertain writes before reactivating older workflows. Restore actual verified workflow/ERP backups, not unverified legacy exports. Additive `iam_*` tables may remain for diagnostics. Restoring a database dump requires review of newer audit data; never discard recent audits or delete volumes blindly.
