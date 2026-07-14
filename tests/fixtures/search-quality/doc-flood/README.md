---
purpose: repository-entrypoint
canonical_for: [project-overview, setup-entrypoint, key-documentation-links]
not_for: [full-product-concepts, api-reference, deployment-runbook]
update_when: project overview, setup flow, or documentation map changes
---

# Partsy

Partsy is an internal tool for hardware teams to manage parts, bills of
materials, and inventory in one place. It supports manual and bulk part entry,
multi-level BOM structures, an append-only inventory ledger, and build-readiness
checking across assemblies.

**Stack:** Next.js · NestJS · PostgreSQL

## Architecture

The frontend is a Next.js app; the backend is a NestJS REST API. See the
frontend components for routes, and the PRD for product concepts.

## How to install

```
npm install
npm run dev
```
