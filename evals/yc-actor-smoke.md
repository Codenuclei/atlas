# YC actor smoke — 2026-09-03

Scope: compare `apivault_labs/yc-companies-scraper` vs `haketa/ycombinator-companies-scraper` vs `memo23/y-combinator-scraper` (companies mode) for Savra-like filters (Education / AI, past ~2 years batches). Small caps (~20–25). Secrets not printed.

## Summary verdict

| Actor | Savra-like result | Path | Notes |
| --- | --- | --- | --- |
| **apivault** | Unreliable / often **FAILED 403** on `/companies` | HTML key bootstrap before Algolia | Empty query still 403s when blocked; intermittent Algolia when bootstrap lucks out |
| **haketa** | **SUCCEEDED** — **11** Education cos (past 2y) | **Direct Algolia** | No founders; closest schema to ours; **chosen for prod** |
| **memo23** | **SUCCEEDED** — Algolia nbHits=11 (same set) | **Direct Algolia** | Different input (`mode`/`batch`/`queries`); optional HTML founder enrich worked on a 5-item smoke |

**Product fix:** switch `YC_ACTOR_ID` → `haketa/ycombinator-companies-scraper` + remap `prepareYcActorInput` (`maxRecords`, `hiringOnly`, fold tags→query). Keep free-text query short/empty.

## Root cause (why Education succeeded earlier, Savra failed)

### What apivault always does

From actor README + run logs:

1. **Fetch Algolia credentials from HTML** `https://www.ycombinator.com/companies` (keys rotate).
2. Paginated Algolia search (`YCCompany_production`).
3. If `fullDetails: true`, hit `/companies/{slug}` for founders/socials.

The fatal error on Savra was step **1**, not free-text vs filters:

```
Failed: 403 Client Error: Forbidden for url: https://www.ycombinator.com/companies
```

### Evidence from prior + this smoke

| Run | Time (approx) | Input highlight | Result |
| --- | --- | --- | --- |
| Education smoke `AY9Eu8ejW96WWi7Bu` | 2026-09-02 | `query:""` industries Education, `fullDetails:true` | SUCCEEDED — Algolia then detail HTML |
| Empty-query control `CRytcZL4VmYbNh6mu` | 2026-09-03 ~16:43 | `query:""` recent batches | SUCCEEDED — Algolia |
| query=AI `pWvU3NMtWJWHwEmed` | same minute | `query:"AI"` | FAILED 403 bootstrap |
| Savra `odLAbvAYNq91nXWaa` / `kSn7NY0aROtsevLIt` | later 09-03 | **`query:""`** + Education + past-2y (+ AI tag once) | FAILED 403 bootstrap |
| Smoke `L13NT46fxxtZrbvYE` | this session | empty query, recent batches, `fullDetails:false` | FAILED 403 |
| Smoke `ICsejMIfc3IWKwVjd` | this session | `query:"AI teaching"` + Education + tags | SUCCEEDED Algolia but **0 items** (over-filtered) |

**Conclusion:** Failure is **not** “free-text triggers an HTML search path instead of Algolia.” Apivault **always** bootstraps keys from HTML `/companies`. YC bot-blocking of that URL from Apify IPs became **intermittent then common on 2026-09-03**. Earlier Education smokes succeeded because bootstrap still worked that day. Savra already sent empty query + directory filters — hardening query alone would **not** have fixed it.

The earlier note “empty query succeeds / query AI → 403” was **timing coincidence** under flaky 403s, not a deterministic HTML-fallback branch for non-empty query.

## Smoke results (this session)

### apivault_labs/yc-companies-scraper

#### apivault_empty_query_recent_batches
- **status:** FAILED — Failed: 403 Client Error: Forbidden for url: https://www.ycombinator.com/companies
- **items:** 0
- **path:** HTML_403
- **usd / ms:** 0 / ~4712
- **runId:** `L13NT46fxxtZrbvYE`

#### apivault_query_teaching_AI
- **status:** SUCCEEDED — Scraped 0 YC companies
- **items:** 0
- **path:** ALGOLIA (bootstrap lucked out; query+filters returned nothing)
- **usd / ms:** 0.00005 / ~6848
- **runId:** `ICsejMIfc3IWKwVjd`
- **algolia:** `AI teaching` + batch OR past-2y AND Education AND tags AI

### haketa/ycombinator-companies-scraper

#### haketa_savra_like (`query:""`, Education, past 2y, maxRecords 25)
- **status:** SUCCEEDED — Done — 11 companies saved.
- **items:** 11
- **path:** ALGOLIA (`Proxy: disabled (Algolia public API)`)
- **usd / ms:** 0.00005 / ~9687
- **runId:** `YLzeWk2V1EwwrUmOF`
- **sample:** Bloomy (Summer 2026) — https://bloomylearning.com/; Risely AI (Summer 2025) — https://www.risely.ai/
- **founders:** none in Algolia output
- **fields:** name, batch, website, ycProfileUrl, oneLiner, longDescription, industry, tags, teamSize, logoUrl, …

#### haketa_AI_query_past2y (`query:"AI"`, Education, past 2y)
- **status:** SUCCEEDED — 11 companies
- **path:** ALGOLIA
- **runId:** `mPt8lfCkJVdr14G0c`
- Same Education cohort (AI free-text still returned Bloomy / Risely / …)

### memo23/y-combinator-scraper (companies)

#### memo23_savra_like
- **status:** SUCCEEDED
- **algolia:** `no query nbHits=11`
- **usd / ms:** 0.008 / ~18795
- **runId:** `4C3d3DLQePEwmyqtV`
- **sample:** Bloomy, Risely AI, Frizzle (Education, past 2y)
- **founders:** off

#### memo23_AI_query
- **status:** SUCCEEDED
- **algolia:** `query="AI" nbHits=11`
- **runId:** `YPXgYOAxeLVUFAtFw`
- **sample:** Risely AI, Excellence Learning, Bloomy

#### memo23_founders_enrich_small (`scrapeFounderDetails:true`, maxItems 5)
- **status:** SUCCEEDED
- **runId:** `4arZrGDcOtOIImsQ1`
- **sample:** Bloomy with `founders:1` + socials (HTML enrich worked here)

## Input schema vs `prepareYcActorInput`

| Field (ours) | apivault (old) | haketa (new) | memo23 companies |
| --- | --- | --- | --- |
| query | `query` | `query` | `queries[]` |
| batches | `batches` | `batches` | `batch` |
| industry | `industries[]` | `industries[]` | `industries[]` |
| tags | `tags[]` | **no facet** → fold into `query` | n/a (use queries) |
| isHiring | `isHiring` | `hiringOnly` | `isHiring` |
| maxItems | `maxResults` | `maxRecords` | `maxItems` |
| founders | `fullDetails` + extract* | not available | `scrapeFounderDetails` (HTML) |
| mode | n/a | n/a | `mode:"companies"` required |

## Code change

- `YC_ACTOR_ID = "haketa/ycombinator-companies-scraper"`
- `prepareYcActorInput` emits haketa schema; orthogonal tags fold into `query`
- Orchestrator prompts / unit tests / mock / Apify `maxRecords` charged-cap updated
- Cost model `usdPerThousand: 2.5`

## Follow-up prod check

Redeployed Cohesivity (`0a06e197-c121-44b0-80b0-c959faedbdf2`, `SUCCESS`, `public_ready`).

### Savra NL rerun (plan → queries)

Query text (unchanged): SAVRA AI teaching companion / YC past 2 years.

| Field | Value |
| --- | --- |
| Query id | `cmtlj58k7fcf32677759fae7d` (clean plan→queries; also `cmtlj1nk1e259f9c2cb04dff8`) |
| Query / job status | **succeeded** |
| itemCount | **11** (> 0) |
| Actor | haketa (`actId` `FDxNNYMbDP9atAJed`) |
| Apify run | `QsdE9EUZ0S9oMSYkb` — “Done — 11 companies saved.” (~$0.022) |
| Path | Direct Algolia — **no 403** |
| Actor input | `query:"AI"` (tag fold), `industries:["Education"]`, 8 past-2y batches, `maxRecords:100` |

**Verdict:** Savra-class ask now succeeds end-to-end on prod after the haketa switch.

Raw JSON: `evals/yc-actor-smoke-raw.json`, `evals/yc-actor-smoke-memo23.json`, `evals/savra-rerun-after-haketa.json`.
