# Strict stress — 2 novel hard queries (prod)

**Date:** 2026-09-04  
**Host:** https://noted-koala-cooking.cohesivity.app  
**Health:** `ok=true` (apify/claude/openrouter configured, database=cohesivity)  
**Auth:** `x-app-token` from `.env` `APP_ACCESS_TOKEN` (not logged)  
**Flow:** `POST /api/plan` → `POST /api/queries` → poll `POST /api/queries/{id}` (~12s) until terminal  
**Raw artifact:** `evals/strict-stress-2q-raw.json` (no secrets)

## Overall VERDICT: **GREEN** (retest after batch-enum fix)

| Query | eval_strict | queryId | status | yc job itemCount | apifyRunId |
|-------|-------------|---------|--------|------------------|------------|
| Q1 climate-tech / LinkedIn | **PASS** | `cmtmnbldh459091a634a3ce34` | succeeded | 100 | `iUQOhdcrSlnmBwTJp` |
| Q2 MeridianBind competitive set | **PASS** | `cmtmnh2dba899c2f4f33707d6` | succeeded | 40 | `wFZADjLZs236R4D2T` |

**Fix commits:** `29d09e9` (haketa batch enum sanitize) + `64113d9` (TS build blockers).  
**Deploy:** `26e03ac9-8a06-474f-9e30-464237e6d08d` → SUCCESS / public_ready.

---

## Root cause (initial RED)

Orchestrator emitted YC `batches` values that Apify’s `yc-companies` actor schema **rejects** before a run starts (`apifyRunId=null`). Primary invalid value: **`Spring 2024`** (not in actor enum — enum has Winter/Summer/Fall 2024 only, no Spring 2024).

### Apify allowed batches (from error payload / haketa schema)

- **2025–2026:** Winter / Spring / Summer / Fall  
- **2024:** Winter / Summer / Fall (**no Spring**)  
- **≤2023:** Winter / Summer only  
- Plus `Summer 2005`, `Unspecified`

### Product fix

1. Hardcoded `YC_HAKETA_ALLOWED_BATCHES` from the live enum.  
2. `ycBatchesForYear` / `recentYcBatches` / `ycBatchesForMonths` / `parseYcBatch` only emit actor-valid labels (skip or coerce Spring 2024 → Winter 2024).  
3. `prepareYcActorInput` sanitizes batches as a hard safety net before Apify.  
4. Orchestrator prompts/tools warn against inventing `Spring 2024`.  
5. Unit tests cover Spring 2024 strip, coerce, and last-3-years windows.

---

## Retest — Q1 — Climate-tech carbon-accounting + LinkedIn founders

### Query text (exact)

> We are diligencing Series A climate-tech vendors that sell B2B carbon-accounting SaaS to manufacturers across India and Southeast Asia. Pull Y Combinator companies from the last three years in that space, and enrich the founders with deeper LinkedIn profiles so we can map prior operator experience.

### Plan snapshot (retest)

| Field | Value |
|-------|--------|
| HTTP | 200 |
| source | `claude` |
| connectors | `yc-companies`, `linkedin-profile-search` |
| batches | `Fall 2026` … `Winter 2024`, `Summer 2023` — **no `Spring 2024`** |

### Execution (retest)

| Field | Value |
|-------|--------|
| queryId | `cmtmnbldh459091a634a3ce34` |
| create HTTP | 201 |
| terminal status | `succeeded` |
| yc-companies | **succeeded**, itemCount **100**, apifyRunId `iUQOhdcrSlnmBwTJp` |
| linkedin-profile-search | succeeded, itemCount 0, apifyRunId `BmPZJGKCAUwxEVFzI` |

### eval_strict — **PASS**

- No batch enum rejection; Apify run started and completed.  
- No `Spring 2024` in plan batches.

---

## Retest — Q2 — MeridianBind competitive set (YC Fintech/B2B W24–S25)

### Query text (exact)

> Map the competitive set around MeridianBind — think Stripe-for-freight-invoices mixed with Flexport-lite trade-compliance tooling for mid-market logistics brokers — among YC Fintech and B2B companies from Winter 2024 through Summer 2025; skip pure crypto plays and prioritize teams building AI agents for customs or invoice reconciliation.

### Plan snapshot (retest)

| Field | Value |
|-------|--------|
| HTTP | 200 |
| source | `claude` |
| connectors | `yc-companies` only |
| batches | `Winter 2024`, `Summer 2024`, `Fall 2024`, `Winter 2025`, `Spring 2025`, `Summer 2025` — **no `Spring 2024`** |

### Execution (retest)

| Field | Value |
|-------|--------|
| queryId | `cmtmnh2dba899c2f4f33707d6` |
| create HTTP | 201 |
| terminal status | `succeeded` |
| yc-companies | **succeeded**, itemCount **40**, apifyRunId `wFZADjLZs236R4D2T` |

### eval_strict — **PASS**

- No batch enum rejection; Apify run started and completed.  
- No `Spring 2024` in plan batches.

---

## Summary table (retest)

| Metric | Q1 | Q2 |
|--------|----|----|
| plan OK | yes | yes |
| Spring 2024 in batches | **no** | **no** |
| queryId | `cmtmnbldh459091a634a3ce34` | `cmtmnh2dba899c2f4f33707d6` |
| query status | succeeded | succeeded |
| yc job itemCount | 100 | 40 |
| apifyRunId | set | set |
| batch validation error | no | no |
| eval_strict | **PASS** | **PASS** |

## VERDICT

**GREEN** — both queries **PASS** after deploy. Shared root cause fixed: orchestrator/helpers + `prepareYcActorInput` never send haketa-invalid batches (`Spring 2024` etc.), so Apify runs start and complete.
