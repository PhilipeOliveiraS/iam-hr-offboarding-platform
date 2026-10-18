# SCRUM-10: HTTP abuse boundary

Operational instructions and confirmed public validation live in the [canonical runbook](../DEPLOY-CORTEX.md#confirmed-public-validation). This note explains the source-level boundary and the limits of that evidence.

## Confirmed edge observation

The supplied public validation records application rejection of an external target and one Cloudflare rate-limit test round. The configured limit is five requests per 10 seconds with 10 seconds of mitigation. It is not a load test or evidence of complete origin isolation. No valid offboarding or reset was sent in that validation.

The action rule should cover the public IAM-HR hostname and exact path `/api/iam-hr/action`, without splitting buckets by query string. The intended per-visitor-IP scope at Cloudflare covers all methods on this path; the application exports POST only. A path expression is:

```text
http.host eq "iam-hr.ph3digital.com.br" and http.request.uri.path eq "/api/iam-hr/action"
```

This documents the intended scope, not a fresh export or independent audit of the deployed rule. `GET /api/iam-hr` has a different path and is outside this action-specific rule.

## Trust and origin access

Compose binds `127.0.0.1:3001:3000` and joins `factory_default`. Loopback binding restricts the host port but does not authenticate visitors or exclude direct access by other containers on that network. SSH forwarding also does not establish individual HTTP visitor identity.

The Next.js Route Handler receives a `Request`, without an authenticated socket peer contract. It cannot establish that `Forwarded`, `X-Forwarded-For`, `X-Real-IP` or `CF-Connecting-IP` came from an authorized proxy merely from the header value. Selecting the first or last IP, or inventing another header name, would allow quota-key substitution if the origin is reachable directly.

Keep the quota at the trusted ingress and review alternate paths to the origin. If enforcement moves into the application, first establish authenticated proxy identity and restricted origin access, then use an atomic shared quota. There is no shared application HTTP limiter in the current source.

The operation ledger deduplicates completed operations per cycle/target and locks active operations. It does not limit parsing, HTTP calls, n8n preflight executions or partial-operation resumes. It is not an HTTP request limiter.

## Source contracts and local verification scope

- `GET /api/iam-hr` uses only the dashboard upstream; the path has no POST handler.
- `POST /api/iam-hr/action?type=offboard` retains validation, payload and the server-authenticated n8n transport. The frontend reconciles results through the dashboard cache.
- `N8N_WEBHOOK_KEY` stays in server transport. Forged identity headers are not forwarded as webhook payload or used to replace that key.
- The explicit seven-target allowlist rejects external accounts before upstream access.
- In this checkout, report POSTs on the action path and legacy lead POSTs return `403 HANDOVER_DISABLED` before body parsing or upstream access. This does not prove the published handover workflow state.

`tests/recovery.mjs` includes 16 redeliveries of a completed operation, with and without its ID, without changing runtime, operations, steps, events, employees or audit records. PGlite does not establish concurrency across real production Postgres connections.

`tests/frontend-contracts.cjs` covers forged headers, read-only GET requests even with action queries, method separation, the frontend callback using the action path, and dashboard-cache updates. Its mocked transport receives requests without pretending to enforce a quota. It also covers 32 concurrent requests to the two blocked handover routes without body reads or upstream access.

These are descriptions of local test coverage, not new test results for this documentation change. HTTP is mocked and SQL uses in-memory PGlite; the suite does not call webhooks, GCP or real reset/offboarding. Public edge observations and local contract coverage establish different properties. Real connector recovery, complete origin isolation and load capacity remain outside the confirmed validation.
