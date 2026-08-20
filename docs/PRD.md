# Product Requirements: Query Scraper

## Problem

Researchers, operators, and recruiters need people, companies, and jobs from LinkedIn and Y Combinator. Existing scrapers force them to pick an actor, paste URLs, and interpret raw JSON. That is slow, easy to misconfigure, and expensive when pay-per-result actors are given unbounded inputs.

## Goals

- A user types one plain-English query and receives a confirmed scrape plan, then a ranked, exportable result set.
- The user never pastes a LinkedIn URL or fills an actor form.
- Claude interprets intent. Code validates, executes, and persists.
- LinkedIn and YC runs both go through Apify. Claude plans the query.

## Non-goals

- Multi-user auth, billing, or org workspaces.
- Scraping sources beyond LinkedIn and YC in v1.
- Webhooks, scheduled monitors, or a public API for third parties.
- Browser-side API keys.

## Personas

- **Operator** researching a market or hiring pipeline.
- **Founder** looking up YC peers or comparable companies.
- **Engineer** verifying the connector and planner locally.

## Query-to-plan contract

Input: `{ query: string }`

Output: a `ScrapePlan`

```
{
  interpretation: string
  intent: "people" | "companies" | "jobs" | "mixed"
  steps: [{ connectorId, params, dependsOn, purpose }]
  expectedResultType: "people" | "companies" | "jobs" | "mixed"
  clarificationNeeded: string
}
```

Rules:

- `params` is a flat record. Each connector's Zod schema validates it after Claude returns.
- Detail connectors (`linkedin-profile`, `linkedin-company`) cannot be the first step.
- The user may edit chips before run. The server re-validates the edited plan.
- If estimated USD exceeds `MAX_QUERY_COST_USD`, the server rejects the plan.

## Functional requirements

| ID | Requirement | Acceptance |
| --- | --- | --- |
| FR-1 | User submits a natural-language query and receives a validated plan | `POST /api/plan` returns `plan` + `cost` |
| FR-2 | User never supplies a raw URL | Planner and UI have no URL field; detail actors are hydrated from search results |
| FR-3 | Plan chips are editable before run | Home page updates `params` and posts the edited plan |
| FR-4 | Ambiguous queries still produce a plan | `clarificationNeeded` is shown, run is not blocked |
| FR-5 | Confirmed plans create a Query and per-step Jobs | `POST /api/queries` returns `201` with jobs |
| FR-6 | Search steps can run immediately; dependent steps wait | Orchestrator checks `dependsOn` against succeeded jobs |
| FR-7 | Apify runs are started asynchronously and polled | `POST /api/queries/:id` maps READY/RUNNING/SUCCEEDED/FAILED/ABORTING/ABORTED/TIMING-OUT/TIMED-OUT |
| FR-8 | YC queries run through Apify | `yc-companies` uses `haketa/ycombinator-companies-scraper` |
| FR-9 | Results are normalized and idempotent | Unique `(queryId, mergeKey)`; re-ingest merges |
| FR-10 | Finished queries are scored and summarized | Claude (or test heuristic) writes `score` and `summary` |
| FR-11 | User can abort in-flight runs | `POST /api/queries/:id/abort` |
| FR-12 | User can export CSV and JSON | `GET /api/queries/:id/export?format=` |
| FR-13 | Hard caps apply regardless of plan | `maxItems` clamped by `MAX_ITEMS_CAP`; cost ceiling enforced |
| FR-14 | CSV quoting is correct | Nested JSON and commas/quotes are escaped |

## Source matrix

| Connector | Kind | Backend | Actor / endpoint | Pricing |
| --- | --- | --- | --- | --- |
| linkedin-profile-search | search | Apify | harvestapi/linkedin-profile-search | $4 / 1k |
| linkedin-company-search | search | Apify | harvestapi/linkedin-company-search | $3 / 1k |
| linkedin-jobs | search | Apify | harvestapi/linkedin-job-search | $1 / 1k, maxItems per title×location |
| yc-companies | search | Apify | haketa/ycombinator-companies-scraper | Actor compute |
| linkedin-profile | detail | Apify | harvestapi/linkedin-profile-scraper | $4 / 1k |
| linkedin-company | detail | Apify | harvestapi/linkedin-company | $3 / 1k |
| youtube-content | search | Apify | streamers/youtube-scraper | Estimated actor usage |
| instagram-content | search | Apify | apify/instagram-scraper | Estimated actor usage |

## Data model

- `Query`: text, interpretation, plan JSON, status, summary, costEstimateUsd
- `Job`: connectorId, stepIndex, status, input JSON, apifyRunId, apifyDatasetId, itemCount, error
- `Result`: sourceType, externalId, mergeKey, score, data JSON, unique on `(queryId, mergeKey)`

Canonical record: `{ sourceType, externalId, title, subtitle, url, location, imageUrl, score?, raw }`

## API contract

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/plan` | Query → plan + cost |
| GET | `/api/queries` | Recent queries |
| POST | `/api/queries` | Confirm plan and start |
| GET | `/api/queries/:id` | Read current persisted state |
| POST | `/api/queries/:id` | Poll, ingest, advance steps |
| POST | `/api/queries/:id/abort` | Abort active Apify runs |
| POST | `/api/queries/:id/rerun` | Start a new run from the saved plan |
| DELETE | `/api/queries/:id` | Abort active work and delete the run |
| GET | `/api/queries/:id/export` | CSV or JSON download |
| POST | `/api/queries/:id/summary` | Cached or claimed SSE summary stream |

## Non-functional

- Node runtime only. No Edge.
- Apify client retries 429/5xx up to 8 times. App does not add another retry loop.
- Anthropic SDK retries twice. App maps `RateLimitError` / `AuthenticationError`.
- Structured-output `stop_reason` of `refusal` or `max_tokens` is treated as a plan failure.
- Tests never hit the network. `SCRAPER_TEST_MODE=1` swaps providers.

## Error taxonomy

| Code | HTTP | When |
| --- | --- | --- |
| BAD_REQUEST | 400 | Missing query or invalid body |
| PLAN_INVALID | 400 | Hallucinated connector or bad params |
| PLAN_REFUSED | 400 | Claude `stop_reason=refusal` |
| COST_CAP | 400 | Estimate exceeds ceiling |
| UNAUTHORIZED | 401 | Missing/invalid API token |
| NOT_FOUND | 404 | Query, actor, or run missing |
| RATE_LIMITED | 429 | Upstream retries exhausted |
| UPSTREAM | 502 | Apify or Claude failed |
| INTERNAL | 500 | Unexpected |

## Acceptance criteria

1. Typing "YC companies hiring in fintech" yields a `yc-companies` plan, then rows after Run.
2. Typing "senior backend roles in Berlin" yields `linkedin-jobs` with `jobTitles` and `locations`.
3. A plan that asks for 10,000 items is clamped or rejected.
4. Polling a finished query is idempotent (row count does not double).
5. Export CSV opens with the expected header and quoted fields.
6. Unit, integration, planner-eval, and e2e tests pass without live keys.

## Out of scope

Auth, sharing, CRM export, LinkedIn cookies, Crunchbase, Product Hunt.

## Open questions

- Should detail enrichment be opt-in after search, to save cost?
- Should the cost ceiling be per-user configurable in the UI?
