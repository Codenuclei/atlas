# Architecture

## Shape

The app is a Next.js App Router service with SQLite (Prisma). There is no separate backend process. Route handlers call an orchestrator that talks to Claude and Apify.

```
UI → /api/plan → Claude planner → ScrapePlan
UI → /api/queries → orchestrator → Job rows
UI reads GET /api/queries/:id and polls POST /api/queries/:id
POST syncs Apify → ingests results → advances dependents → synthesizes once
```

## Connector registry

Each source is one file that exports a `Connector`:

- `id`, `label`, `kind` (`search` | `detail`), `sourceType`
- `capability` — the text Claude sees
- `inputSchema` — Zod, used both for Claude repair and for `buildRun`
- `buildRun` — actor id + input, or HTTP payload
- `normalize` — raw item → `ScrapedRecord`
- `costEstimate`

The capability catalog is generated from the registry so the planner cannot drift from code.

## Adding a source

1. Add a file under `src/lib/connectors/`.
2. Register it in `src/lib/connectors/registry.ts` and `CONNECTOR_IDS`.
3. Add a fixture + schema/normalize tests.
4. Add one planner-eval query that should select it.

## Planner

`createPlan` uses Claude structured outputs (`messages.parse` + `zodOutputFormat(scrapePlanSchema)`). The plan schema is flat: `steps[].params` is a record, not a union of every connector schema. That stays under Anthropic's structured-output complexity limits. After parse, each step is validated with `getConnector(id).inputSchema`. One repair round trip is allowed.

In `SCRAPER_TEST_MODE=1` (and Vitest/Playwright), a deterministic heuristic planner is used instead.

## Orchestrator

Jobs start when every `dependsOn` connector id has a succeeded job. A failed dependency deterministically fails its queued dependents instead of stranding the query. Detail connectors with empty URL arrays are hydrated from prior results via `extractLinkedInUrls`.

Actor starts and result synthesis use conditional database updates as claims. Concurrent sync requests therefore cannot start the same actor or Claude synthesis twice.

Apify: `start` then poll `get`. On `SUCCEEDED`, page `listItems` until `offset >= total`. YC uses the same path via `haketa/ycombinator-companies-scraper`.

Merge key: LinkedIn slug if present, otherwise normalized title. `upsert` on `(queryId, mergeKey)`.

## Test seams

`isTestMode()` swaps:

- Apify → in-memory mock runs that succeed on first poll
- YC Apify actor → mock dataset items
- Claude planner / synthesis → heuristic functions

Integration tests can also intercept HTTP with MSW when a live-shaped client is exercised.
