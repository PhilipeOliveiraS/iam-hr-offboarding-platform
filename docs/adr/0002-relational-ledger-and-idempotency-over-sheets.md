# 0002. Relational Ledger & Idempotent Resumption over Sheets

Date: 2026-10-15

## Status

Accepted (permanent)

## Context

Early iterations of the offboarding prototype stored state in Google Sheets and stateless memory dictionaries. In high-concurrency or distributed environments, spreadsheet-backed systems suffer from race conditions, lack of row-level transactional locking, lack of idempotency guarantees ($f(f(x)) = f(x)$), and vulnerability to partial failures (e.g. ERP revoked, but GCP call timed out, leading to duplicate execution or inconsistent ledger states).

To meet SOC 2, LGPD, and enterprise resilience standards, the orchestration engine (n8n) requires an immutable, relational audit ledger and a deterministic state machine capable of selective recovery without duplicate writes.

## Decision Drivers

- **ACID Transactions & Row-Level Locking**: Guarantee single-operator mutual exclusion across offboarding cycles and scheduled resets.
- **Idempotency & Selective Resumption**: Allow recovering failed or interrupted operations (e.g., connector timeout) without re-executing steps that previously succeeded.
- **State Transparency**: Provide deterministic status tracking (`pending`, `running`, `succeeded`, `failed`, `unknown`) across every discrete connector (`postgres`, `erp`, `gcp`).
- **Quota & Admission Control**: Control cognitive agent invocations and email deliveries via persistent database reservations.

## Considered Options

1. **Google Sheets / Airtable API**: Continue using low-code spreadsheet backends with API polling.
2. **Document Store (MongoDB / DynamoDB)**: Use NoSQL for unstructured document storage.
3. **Relational PostgreSQL 16 Ledger (Migrations `002` and `003`)**: Deploy PostgreSQL 16 with a singleton lock table (`iam_runtime`), relational step ledger (`iam_operations`, `iam_steps`), and handover quota tracker (`iam_handover_requests`).

## Decision Outcome

Chosen option: **Option 3 — Relational PostgreSQL 16 Ledger**.

We implemented:
1. **Singleton Mutual Exclusion (`iam_runtime`)**:
   A table constrained to a single row (`singleton boolean PRIMARY KEY CHECK (singleton)`) maintaining `cycle`, `owner`, `operation_id`, and `reset_pending`. Concurrent workflows must acquire this row via `SELECT ... FOR UPDATE` before executing state transitions.
2. **Operation Ledger (`iam_operations` & `iam_steps`)**:
   Every offboarding request creates or retrieves a scoped operation record constrained by `UNIQUE(cycle, kind, target_email)`. Each connector (`postgres`, `erp`, `gcp`) receives an isolated `iam_steps` row.
3. **Selective Resumption Logic**:
   Before initiating an external write, the engine inspects the current state. Connectors that previously reached `succeeded` are safely bypassed. If an operation was marked `unknown` due to downstream timeout, the engine inspects state without repeating side-effecting writes.
4. **Handover Delivery Governance (`iam_handover_requests`)**:
   Migration `003` introduced an atomic admission and reservation system enforcing a strict rolling 24-hour global limit of 20 reservations (`iam_handover_config`), preventing token burnout and unauthorized email loops.

### Positive Consequences

- Idempotency proof: Re-running offboarding against an employee whose license or account is already disabled does not perform unnecessary duplicate writes.
- Deterministic recovery: Network dropouts during workflow execution can be safely resumed by referencing the persistent `operation_id`.
- Complete auditability: Every state transition is recorded with timestamped entries in `iam_operations` and `audit_log`.

### Negative Consequences / Trade-offs

- Requires hosting and maintaining a PostgreSQL 16 instance.
- Workflows must handle explicit lock acquisition and release error paths.
