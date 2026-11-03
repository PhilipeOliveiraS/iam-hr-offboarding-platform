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
| `database/003-handover-delivery.sql` | Persistent handover admission, quota and send authorization |
| `automation/n8n/n8n-04-handover-report.json` | Sanitized handover deployment template |
| `database/002-operation-recovery.sql`                           | Additive migration for the existing demo database                         |
| `mock-erp/main.py`                                              | ERP mock, including `GET /state`                                          |
| `automation/n8n/n8n-01-get-dashboard-data.json`                 | Dashboard workflow                                                        |
| `automation/n8n/n8n-02-execute-offboarding.json`                | Offboarding and selective resume                                          |
| `automation/n8n/n8n-03-scheduled-reset.json`                    | Scheduled/manual coordinated reset                                        |
| `tests/`                                                        | PostgreSQL-in-memory, workflow simulation and frontend/API contract tests |
| [DEPLOY-CORTEX.md](DEPLOY-CORTEX.md)                                        | Deployment, recovery, rollback and validation instructions                |

These sources extend an existing installation. The frontend Compose definition is included; the existing backend stack, production schema/seed, credentials and credential-bearing production handover exports are not supplied here; workflow 04 is supplied only as a sanitized deployment template. `tests/fixtures/schema-original.sql` is only an in-memory test fixture; never apply it to the demonstration database.

Handover restoration uses `POST /api/iam-hr/action?type=report` with `operation_id`, `target_email` and `visitor_email`. The legacy `POST /api/lead-capture` remains blocked. The server requires webhook authentication and the workflow reserves delivery in Postgres before calling either provider. The reviewed workflow 04 export intentionally omits credential bindings and contains a provider URL placeholder: deploy it through `automation/deploy/publish-handover.py`, which preserves the existing Gemini/parser/Gmail nodes and reuses existing bindings. Do not import the sanitized export directly.

The approved consumption setting is **20 new reservations globally per rolling 24 hours**, configurable in Postgres. Reservations are unique per operation and normalized recipient; failed and uncertain requests count toward the limit. This is neither an exact financial ceiling nor complete abuse prevention. See the runbook for deployment status, recovery and the pending single-email acceptance test.

## Local development and tests

Use Node.js compatible with the committed Next.js lockfile. The local integration was validated with Node 24.16.0. Keep environment values private:

- `N8N_GET_DATA_URL`: workflow 01 production webhook.
- `N8N_OFFBOARD_URL`: workflow 02 production webhook.
- `N8N_REPORT_URL`: internal workflow 04 production webhook; report requests require `N8N_WEBHOOK_KEY`.
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

Operation 158 subsequently demonstrated real selective recovery without repeating Postgres/ERP writes and with independently confirmed GCP disabled=true. Remaining acceptance work includes concurrent reset/offboarding exclusion, Firefox hydration, and remaining published-workflow comparisons. The restored handover has real provider-acceptance evidence for requests 1 and 2; the user confirmed receipt of request 1. Historical prompt/template fidelity remains under review after a user-reported difference. These observations do not establish production readiness or external exactly-once delivery.

## Safety boundaries

The local offboarding/reset exports require Header Auth with operator-bound credentials. Reset uses POST; its Schedule Trigger is disabled in the export. Published workflow activation cannot be inferred from exports. The legacy handover route rejects delivery; the restored action route requires authentication and uses the persistent reservation/quota workflow. The confirmed edge action rate limit does not establish email delivery controls or prevent every possible origin bypass.

No external exactly-once guarantee is claimed. A timeout does not prove a remote operation stopped; the proxy keeps its 55-second timeout through body consumption, subject to any shorter hosting limit.

See [local safety design](docs/SCRUM-10-local-safety.md) and [HTTP abuse boundary](docs/SCRUM-10-abuse-boundary.md) for source-level controls and validation limits. Keep environment files, credentials, dumps, backups and legacy ZIP/export copies private; do not use unverified legacy exports as deployment sources.
