# 0001. Least-Privilege GCP IAM Synthetic Identities

Date: 2026-10-09

## Status

Accepted (permanent)

## Context

In standard enterprise cloud architectures, administrative operations across identity providers frequently fall victim to over-privileged service accounts (such as `roles/iam.serviceAccountAdmin` or `roles/editor` granted globally). In demonstration and sandbox environments, teams often rely on a single shared Service Account that possesses full create, update, and delete authority across all project identities.

For the IAM-HR Enterprise Offboarding Platform, utilizing a shared or globally privileged identity introduces significant security blast-radius risks, audit non-compliance (LGPD / SOC 2 / ISO 27001), and fails to model zero-trust enterprise boundaries. The platform requires a deterministic mechanism to inspect and disable target identities during offboarding workflows without granting permission to alter arbitrary cloud resources, delete accounts, or escalate privileges.

## Decision Drivers

- **Zero-Trust & Least-Privilege**: Limit GCP credentials strictly to the exact administrative verbs required to inspect and deactivate target identities.
- **Blast-Radius Containment**: Isolate target test identities from infrastructure, production workloads, and unrelated service accounts.
- **Deterministic Audit Trail**: Ensure that every offboarding action maps to a discrete, known synthetic identity whose lifecycle can be tracked and independently verified in GCP Cloud Audit Logs.
- **Strict Allowlisting**: Prevent execution against unauthorized, external, or mission-critical corporate accounts.

## Considered Options

1. **Shared Broad Service Account**: Use a single Service Account with `roles/iam.serviceAccountUser` and broad project-level IAM management.
2. **Dynamic Identity Creation/Deletion**: Provision and destroy real GCP Service Accounts on the fly during each test cycle.
3. **Dedicated Synthetic Identities with Custom Scoped Role (`iamHrSyntheticLifecycle`)**: Define exactly seven pre-provisioned synthetic Service Accounts (`iamhr-*`) governed by a tightly scoped custom IAM role.

## Decision Outcome

Chosen option: **Option 3 — Dedicated Synthetic Identities with Custom Scoped Role**.

We established:
1. Exactly seven synthetic allowlisted Service Accounts:
   - `iamhr-john-carter@<GCP_PROJECT_ID>.iam.gserviceaccount.com`
   - `iamhr-sarah-connor@<GCP_PROJECT_ID>.iam.gserviceaccount.com`
   - `iamhr-dana-scully@<GCP_PROJECT_ID>.iam.gserviceaccount.com`
   - `iamhr-ellen-ripley@<GCP_PROJECT_ID>.iam.gserviceaccount.com`
   - `iamhr-arthur-dent@<GCP_PROJECT_ID>.iam.gserviceaccount.com`
   - `iamhr-marty-mcfly@<GCP_PROJECT_ID>.iam.gserviceaccount.com`
   - `iamhr-tchalla-udaku@<GCP_PROJECT_ID>.iam.gserviceaccount.com`
2. A custom IAM role (`iamHrSyntheticLifecycle20261009`) restricted strictly to:
   - `iam.serviceAccounts.get`
   - `iam.serviceAccounts.disable`
   - `iam.serviceAccounts.enable`
3. Enforcement of allowlist verification at the application layer (`lib/synthetic-targets.ts`) and workflow level (n8n code nodes), rejecting any request outside the seven explicit identities with HTTP 400 (`TARGET_NOT_ALLOWED`).

### Positive Consequences

- Mitigates lateral movement risk: the administrative connector cannot delete identities, modify IAM policy bindings, or touch compute/storage assets.
- Clean audit records: GCP Cloud Audit Logs record explicit deactivations (`serviceAccounts.disable`) tied to specific synthetic identities.
- Eliminates cost and quota churn associated with constant account creation/deletion.

### Negative Consequences / Trade-offs

- Testing is bounded strictly to the pre-seeded seven identities. Any addition requires updating both the GCP role assignment, database seed, and application allowlist.
