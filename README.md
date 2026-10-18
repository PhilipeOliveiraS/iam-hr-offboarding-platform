# IAM-HR recovery demo · PH3 Digital Factory

Next.js showroom and IAM-HR sandbox with a PostgreSQL operation ledger, n8n orchestration, an ERP mock and seven allowlisted synthetic GCP service accounts. The public documentation and interface are in English. This is a demonstration, not a production IAM system.

## Recovery architecture

The browser reads `GET /api/iam-hr` and submits offboarding to `POST /api/iam-hr/action?type=offboard`. Workflow 01 returns `employees`, `cycle`, `busy`, `maintenance` and processing metrics. Workflow 02 accepts `target_email` and an optional `operation_id`, returning the operation and a confirmed dashboard snapshot. The interface updates the table, operation card and metrics through the same SWR cache mutation.

Postgres, ERP and GCP have separate connector results. A successful connector is skipped on resume within the same demonstration cycle. ERP and GCP are inspected before a write. An uncertain write remains `unknown`; a subsequent probe does not authorize another write without operator review. A persistent global lock covers both offboarding and reset to prevent overlapping recovery operations across the demo accounts.

Offboarding updates the employee record first but exposes `RUNNING`, `PARTIAL` or `UNKNOWN` until connector outcomes are known. Reset restores ERP/GCP before marking employees active and advancing the cycle. Historical operations remain available but cannot be resumed in a newer cycle.

`Avg. Processing` is the mean active processing time of successful offboarding operations completed in the last 24 hours. It excludes human waiting, response delivery and handover generation. **“vs 48h manual” is a comparative reference, not a measured baseline.**

## Sources

| Path                                                            | Purpose                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `app/iam-hr-sandbox/page.tsx`, `components/ph3/iam-hr-demo.tsx` | Integrated interface, preserving the local layout and visual identity     |
| `app/api/iam-hr/route.ts`, `lib/iam-hr.ts`                      | Proxy, contract validation and shared types                               |
| `database/002-operation-recovery.sql`                           | Additive migration for the existing demo database                         |
| `mock-erp/main.py`                                              | ERP mock, including `GET /state`                                          |
| `automation/n8n/n8n-01-get-dashboard-data.json`                 | Dashboard workflow                                                        |
| `automation/n8n/n8n-02-execute-offboarding.json`                | Offboarding and selective resume                                          |
| `automation/n8n/n8n-03-scheduled-reset.json`                    | Scheduled/manual coordinated reset                                        |
| `tests/`                                                        | PostgreSQL-in-memory, workflow simulation and frontend/API contract tests |
| [DEPLOY-CORTEX.md](DEPLOY-CORTEX.md)                                        | Deployment, recovery, rollback and validation instructions                |

These sources extend an existing installation. The frontend Compose definition is included; the existing backend stack, production schema/seed, credentials and published handover are not supplied here. `tests/fixtures/schema-original.sql` is only an in-memory test fixture; never apply it to the demonstration database.

The separate `app/api/lead-capture/route.ts` previously provided a local proxy using `N8N_LEAD_CAPTURE_URL`. The UI previously used `/api/iam-hr?type=report`. In this checkout, `POST /api/iam-hr/action?type=report` and `POST /api/lead-capture` return HTTP 403 with `HANDOVER_DISABLED` before reading the body or forwarding upstream. The dashboard path exports GET only. These files do not establish the state of the published handover workflow.

## Local development and tests

Use Node.js compatible with the committed Next.js lockfile. The local integration was validated with Node 24.16.0. Keep environment values private:

- `N8N_GET_DATA_URL`: workflow 01 production webhook.
- `N8N_OFFBOARD_URL`: workflow 02 production webhook.
- `N8N_REPORT_URL`: historical handover setting; ignored by the disabled local delivery routes.
- `N8N_WEBHOOK_KEY`: server-side webhook header value, passed through by Compose. Bind matching Header Auth credentials in n8n; configuring this variable alone does not authenticate a webhook.

```sh
npm ci
npm run build
npm run start
```

Starting the interface will poll its configured backend. For isolated tests with **no real n8n/GCP calls**, install the test dependencies and run:

```sh
npm --prefix tests ci --ignore-scripts
npm --prefix tests test
```

The frontend contract test additionally requires the root dependencies installed by `npm ci`. Test scripts use PGlite in memory and mocked HTTP, without loading local environment files. They are not real-service acceptance tests or browser hydration tests.

For affected checks only:

```sh
npm --prefix tests run test:workflow
npm --prefix tests run test:contracts
```

## HTTP response correction

With n8n `responseFormat: "text"`, the response content defaults to `data`, but the downstream classifier nodes read `body`. Both workflows 02 and 03 explicitly set:

```text
parameters.options.response.response.outputPropertyName = "body"
```

This applies to **ERP Inspect, ERP Apply, GCP Inspect and GCP Apply** in each workflow. The simulator follows the configured output property and uses `data` when it is absent. It checks all eight mappings and reproduces the original missing-body failure in offboarding and reset.

## Validation evidence and outstanding work

The [canonical runbook](DEPLOY-CORTEX.md#confirmed-public-validation) records the confirmed public URL, HTTP checks and one Cloudflare rate-limit test round. No valid offboarding or reset action was submitted during that validation. Those checks do not establish end-to-end connector recovery, load capacity or production readiness.

Remaining acceptance work includes real partial failure and selective resume, concurrent reset/offboarding exclusion, Firefox hydration, and comparison of local sources with current published workflows. Published handover configuration and email receipt are not established by the current validation.

## Safety boundaries

The local offboarding/reset exports require Header Auth with operator-bound credentials. Reset uses POST; its Schedule Trigger is disabled in the export. Published workflow activation cannot be inferred from exports. The local handover routes reject delivery; there is no persistent email reservation, quota or delivery deduplication in this checkout. The confirmed edge action rate limit does not establish email delivery controls or prevent every possible origin bypass.

No external exactly-once guarantee is claimed. A timeout does not prove a remote operation stopped; the proxy keeps its 55-second timeout through body consumption, subject to any shorter hosting limit.

See [local safety design](docs/SCRUM-10-local-safety.md) and [HTTP abuse boundary](docs/SCRUM-10-abuse-boundary.md) for source-level controls and validation limits. Keep environment files, credentials, dumps, backups and legacy ZIP/export copies private; do not use unverified legacy exports as deployment sources.
