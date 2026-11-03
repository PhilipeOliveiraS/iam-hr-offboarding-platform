# 0004. Bare-Metal Cortex-01 Hosting & Cloudflare WAF Bot Mitigation

Date: 2026-10-25

## Status

Accepted (permanent)

## Context

The initial frontend deployment for the IAM-HR demonstration was hosted on Vercel Preview environments. However, automated webhook callbacks, simulated agent traffic, and automated integration checks connecting back through Cloudflare repeatedly encountered HTTP 403 Forbidden errors triggered by Cloudflare's Bot Fight Mode and Vercel edge IP reputation filters.

Furthermore, running the Next.js frontend externally required exposing internal homelab database and n8n webhook ports to the public internet, complicating ingress security and increasing the attack surface.

## Decision Drivers

- **Perimeter Security & Ingress Hardening**: Avoid opening inbound firewall ports on the homelab router.
- **Bot Mitigation & Cloudflare Compatibility**: Eliminate HTTP 403 blocks caused by automated testing and API proxies while keeping aggressive edge rate-limiting active.
- **Zero-Trust Network Isolation**: Colocate the presentation tier, orchestration engine (n8n), ERP simulator, and PostgreSQL ledger within a private container network.
- **Cost & Sovereignty (FinOps)**: Leverage existing bare-metal infrastructure (Cortex-01, Debian 12) rather than paying recurring cloud hosting or edge serverless egress fees.

## Considered Options

1. **Vercel Serverless Hosting with Custom Proxies**: Keep Vercel and establish complex IP bypass rules in Cloudflare.
2. **Public Cloud VM (GCP Compute Engine / AWS EC2)**: Migrate full stack to an enterprise cloud VM.
3. **Bare-Metal Containerization on Cortex-01 with Cloudflare Tunnel**: Package Next.js as a Docker container, deploy to Cortex-01 alongside n8n and PostgreSQL on the isolated `factory_default` Docker network, and expose via Cloudflare Zero Trust Tunnel.

## Decision Outcome

Chosen option: **Option 3 — Bare-Metal Containerization on Cortex-01 with Cloudflare Tunnel**.

We implemented:
1. **Next.js Standalone Containerization**:
   Multi-stage Docker build producing a minimal standalone Next.js 16 container (`compose.iam-hr.yml`) exposed on internal host port `127.0.0.1:3001`.
2. **Docker Network Colocation**:
   All core services (`iam-hr-preview`, `n8n`, `postgres`, `mock-erp`) communicate over the isolated internal Docker bridge network (`factory_default`), resolving internal hostnames directly (e.g. `http://n8n:5678`, `http://mock-erp:8000`).
3. **Cloudflare Zero Trust & WAF Hardening**:
   Ingress is routed through a Cloudflare Tunnel directly to `127.0.0.1:3001`. Edge WAF rules enforce rate limits (5 requests per 10 seconds per IP with a 10-second mitigation block), mitigating DDoS and unauthorized brute-force execution while resolving false-positive bot fight mode blocks.

### Positive Consequences

- Ingress ports 80/443/5678/5432 remain completely closed to the internet.
- Eliminates cloud hosting charges for frontend serverless execution.
- Internal microservice traffic between Next.js, n8n, Postgres, and Mock ERP remains zero-latency and unexposed to public transit.

### Negative Consequences / Trade-offs

- Uptime and availability are dependent on the Cortex-01 bare-metal host and local uplink connectivity.
- Requires local container lifecycle management and host resource monitoring.
