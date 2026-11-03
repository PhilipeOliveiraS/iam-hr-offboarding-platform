# 0003. Unified FastAPI ERP Simulator

Date: 2026-10-20

## Status

Accepted (permanent)

## Context

Enterprise offboarding requires revoking SaaS and on-premises legacy software seats (e.g., SAP, Totvs, Workday, Salesforce). In sandbox and demo environments, integrating live third-party enterprise billing systems is cost-prohibitive, introduces external credential vulnerabilities, and creates data contamination risks.

Early mock approaches used static JSON files served via disparate mock endpoints or inline script logic within n8n workflows. This created tight coupling, prevented independent contract testing, lacked HTTP semantics (proper 404s, 400s, 500s), and made it impossible to simulate connector timeouts, state inspections, and batch resets accurately.

## Decision Drivers

- **Realistic Legacy Enterprise Behavior**: Accurately simulate an internal license manager ("the on-prem system nobody remembers to turn off").
- **KISS (Keep It Simple, Stupid) & Zero External Overhead**: Lightweight implementation that does not require an independent database engine.
- **Idempotent Probing & Revocation**: Support distinct inspection endpoints (`/licenses/{email}`), revocation endpoints (`/licenses/{email}/revoke`), and reset baseline verification (`/state`).
- **Container Isolation**: Run as a self-contained microservice within the Docker bridge network.

## Considered Options

1. **Inline Workflow Logic in n8n**: Mock responses using n8n JavaScript Function nodes.
2. **Third-Party Mocking Services (Mockoon / WireMock / Postman Server)**: Heavyweight or closed tooling requiring external configuration sync.
3. **Dedicated FastAPI Microservice (`mock-erp/`)**: Python 3.11 + FastAPI microservice with persistent JSON seed storage, typed Pydantic models, and clean RESTful endpoints.

## Decision Outcome

Chosen option: **Option 3 — Dedicated FastAPI Microservice (`mock-erp/`)**.

We established:
1. A lightweight Python FastAPI service located in `mock-erp/`:
   - `GET /health`: Microservice liveness check.
   - `GET /licenses/{email}`: License inspection probe returning 200 with `LicenseRecord` or 404 for unknown targets.
   - `POST /licenses/{email}/revoke`: Idempotent revocation setting `license_status = "REVOKED"` and stamping `revoked_at` with UTC timestamp.
   - `GET /state`: Idempotent state inspection endpoint returning `{"reset_baseline": boolean}` used by n8n before applying batch resets.
   - `POST /reset`: Coordinated reset restoring all pre-seeded licenses to `ACTIVE`.
2. Seed isolation: Persisted in local JSON (`seed.json`) mapped via volume, enabling instant reset during scheduled cycles.

### Positive Consequences

- Decoupled testing: Can be executed independently in CI/CD and integration suites.
- Realistic HTTP contract testing: n8n workflow nodes interact over real HTTP connections, verifying status codes, response parsing, and error-handling branches.
- Low footprint: Negligible RAM/CPU consumption on the bare-metal Cortex-01 host.

### Negative Consequences / Trade-offs

- State is stored in a local JSON file (`seed.json`), which is not designed for multi-replica scaling (acceptable for this single-node demo environment).
