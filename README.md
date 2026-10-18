# IAM-HR recovery demo · PH3 Digital Factory

Next.js showroom and IAM-HR sandbox with a PostgreSQL operation ledger, n8n orchestration, an ERP mock and seven allowlisted synthetic GCP service accounts. The interface and handover remain in English. This is a demonstration, not a production IAM system.

## Recovery architecture

The browser calls `/api/iam-hr`. Workflow 01 returns `employees`, `cycle`, `busy`, `maintenance` and processing metrics. Workflow 02 accepts `target_email` and an optional `operation_id`, returning the operation and a confirmed dashboard snapshot. The interface updates the table, operation card and metrics through the same SWR cache mutation.

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
| [APLICAR.md](APLICAR.md)                                        | Deployment, recovery, rollback and validation instructions                |

These sources extend an existing installation. Its Compose file, production schema/seed, credentials and published handover are not supplied here. `tests/fixtures/schema-original.sql` is only an in-memory test fixture; never apply it to the demonstration database.

The separate `app/api/lead-capture/route.ts` previously provided a local proxy using `N8N_LEAD_CAPTURE_URL`. The UI previously used `/api/iam-hr?type=report`. Both that endpoint and the legacy lead route now reject public delivery with HTTP 403; neither forwards a request.

## Local development and tests

Use Node.js compatible with the committed Next.js lockfile. The local integration was validated with Node 24.16.0. Keep environment values private:

- `N8N_GET_DATA_URL`: workflow 01 production webhook.
- `N8N_OFFBOARD_URL`: workflow 02 production webhook.
- `N8N_REPORT_URL`: historical handover setting; ignored by the disabled local delivery routes.
- `N8N_WEBHOOK_KEY`: optional existing webhook header value; this alone does not add authentication to the imported demo workflows.

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

Local integration results already obtained: frontend build, lint of the four integrated files, `recovery.mjs`, and 17 frontend/API contract groups passed. The original workflow simulation passed but did not model the response-property default; its earlier success did not validate this n8n behavior. For this delivery, the corrected workflow simulation passed, including all eight `body` mappings, the default `data` behavior and missing-body regressions. The 17 frontend/API contract groups also passed again from their versioned location in `tests/`. The frontend build/lint and unchanged recovery test results were reused.

Operator-reported real-environment evidence for this delivery, recorded on 2026-09-29:

- Migration applied on Cortex-01 with `COMMIT`.
- Updated ERP returned HTTP 200 for `GET /state`.
- New workflows 01/02/03 imported into n8n **2.39.6**; the response-property correction was applied there.
- Real reset succeeded.
- John Carter offboarding succeeded: **operation 2, cycle 2, attempt 1**, one write per connector, **3335 ms** active processing.
- Frontend displayed the result and acknowledged report sending. Inbox receipt has **not** been confirmed in this round.

This publishing task does not independently inspect Cortex/n8n. Local workflow sources implement the reported correction but have not been compared byte-for-byte with current server exports.

Still pending:

- Real partial failure followed by selective resume of the same operation.
- Real concurrent requests and reset/offboarding exclusion under concurrency.
- Firefox hydration validation.
- Confirmation of report receipt in this round.
- Comparison with a fresh export of the published English handover, without changing its Gmail credentials.

The local root files `[GET] Public Dashboard Data (NO-CACHE).json` and `[POST] Execute IAM-HR Action (OPTIMIZED).json` are unverified legacy exports. They remain on the workstation, ignored and unmodified. Do not use them as deployment sources. The package's `reference/n8n-04-lead-capture-report-working.json` is not included or treated as the published handover.

## Limits and preserved local changes

Local offboarding/reset exports require Header Auth (credential binding must be configured by an operator); reset is POST and its schedule is disabled. No persistent email rate limiter or delivery deduplication exists, so public handover delivery is disabled locally. No external exactly-once guarantee is claimed. A timeout does not prove a remote operation stopped; the proxy keeps its 55-second timeout through body consumption, subject to any shorter hosting limit. These results do not constitute complete acceptance or production readiness.

The existing dependency changes and lockfile are retained separately from recovery implementation. Local global-layout hydration suppression is also retained, but it is not evidence that hydration issues are fixed. The three local SVG asset changes only alter line endings; their graphic content is unchanged. No environment files, credential material, backups, dumps or ZIP archives belong in the commits.

## SCRUM-10 local safety changes (2026-10-14)

See [local acceptance notes](docs/SCRUM-10-local-safety.md). These files are proposals for a later reviewed deployment; no n8n publication or runtime change is implied. The published SQL definition of `iam_dashboard()` and anonymous browser access at the canonical public URL remain unverified. No canonical public URL is asserted here.
