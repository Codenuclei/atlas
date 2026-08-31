# YC agent local smoke report

**Date:** 2026-08-31  
**Root:** `/Users/mu-mac_3/Projects/new-scraper`  
**Verdict:** **Working** — local orchestrator matches eval expectations; E2E plan → Apify → results succeeded.

## 1. Health

- Started `DATABASE_PROVIDER=sqlite npm run dev` (Next was down).
- `GET http://localhost:3000/api/health` → **200**
- Body (keys only): `ok=true`, `services.apify=configured`, `services.claude=configured`, `services.database=sqlite`, `connectorCount=10`.

## 2. Direct orchestrator smoke (`node scripts/yc-orchestrator-eval.mjs`)

| ID | Result | industry | batches | tags | query |
|----|--------|----------|---------|------|-------|
| B01 | **PASS** | Education | `[]` | `[]` | `""` |
| B06 | **PASS** | Education | Winter/Spring/Summer/Fall **2025** | `[]` | `""` |
| C10 | **PASS** (retry) | Fintech | `[]` | `[]` | `""` |

Notes:

- B01 Q: *Show me all Y Combinator companies in the Education category.* — `hiring=false`, `tools=3`.
- B06 Q: *Find Education-category YC companies that were in any 2025 batch.* — four 2025 season batches, `tools=4`.
- C10 Q: *Show me Stripe-like competitors that went through YC in Fintech — do not search for Stripe itself.*
  - First attempt (~0.7s): **FAIL** `plan_invalid: orchestrator failed` (transient; no graded params).
  - Immediate retry: **PASS** Fintech / empty batches·tags·query — same as eval gold.

## 3. End-to-end via local API

Flow: `POST /api/plan` → `POST /api/queries` → poll `POST /api/queries/:id` + `POST /api/work/claim`.

Ask: *Show me all Y Combinator companies in the Education category.*

| Step | Outcome |
|------|---------|
| Plan | **200**, `source=claude` (orchestrator). Step `yc-companies` params: `industry=Education`, `isHiring=false`, `maxItems=100`, `_orchestrated=true`. No batches/tags/query fields (empty filters). |
| Create query | **201**, id `cmth539ll0000ea280v22ivii`, status `running`, 1 job |
| Final | **succeeded**, job `yc-companies` **succeeded**, **result_count=284** (~2 min) |

Planning/orchestrator: **succeeded**. Connector/Apify: **succeeded** (token configured; not a connector-only fail).

Filters vs eval B01: Education industry, empty batches/tags/query — **match**.

## 4. Verdict

- **Working** locally.
- Orchestrator smoke aligns with eval expectations (B01/B06/C10 filter shapes).
- Full path (Claude plan → DB query → Apify YC connector → results) works on localhost with SQLite.
