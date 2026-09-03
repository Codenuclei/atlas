# YC companies scraper — Apify actor alternatives

Research date: 2026-09-03  
Scope: same purpose as our current connector (YC Startup Directory companies + optional founders/socials).  
No production code changed.

## 1. What we use today

| Field | Value |
| --- | --- |
| Actor id | `apivault_labs/yc-companies-scraper` |
| Constant | `YC_ACTOR_ID` in `src/lib/connectors/yc-companies.ts` |
| Connector | `ycCompaniesConnector` (`id: "yc-companies"`) |
| Invocation | `buildRun()` → `executor: "apify"`, `prepareYcActorInput()` |
| Cost model in app | `$5 / 1K` (`usdPerThousand: 5`) |

**How it is invoked**

1. Orchestrator / plan produces `YcCompaniesInput` (`query`, `batch`/`batches`, `industry`, `tags`, `isHiring`, `maxItems`).
2. `prepareYcActorInput()` maps that into the actor schema: `batches`, `industries[]`, `tags`, `isHiring`, `maxResults`, `fullDetails: true`, `extractFounders: true`, etc.
3. Apify run is started with that input; results are normalized via `normalizeYcCompany` / `expandYcFounders`.

**How the current actor works (from its Store README)**

1. Fetches Algolia API credentials dynamically from `ycombinator.com/companies` (keys rotate).
2. Paginated search via Algolia (`YCCompany_production`).
3. Optional per-company `/companies/{slug}` HTML for founders + socials when `fullDetails` is on.

**Current actor Store stats (public API, 2026-09-03)**

- Users: **7** total / **2** monthly  
- Runs (30d): **146** succeeded, **0** failed  
- Pricing: **$5 / 1K** companies (PPE)  
- Ratings: none  
- Last run seen on Store: 2026-09-03  

## 2. Repo mentions of other YC actors

- **Code (live):** only `apivault_labs/yc-companies-scraper` via `YC_ACTOR_ID` in `src/lib/connectors/yc-companies.ts`.
- **PRD drift:** `docs/PRD.md` FR-8 and the source matrix still specify **`haketa/ycombinator-companies-scraper`** (pricing note: “Actor compute”). That is **not** what the connector runs today — docs are stale relative to code.
- README mentions Y Combinator as a source, not Store actor ids.
- `SCRAPER_TEST_MODE=1` mocks Apify/YC locally (does not point at another Store actor).

## 3. Viable Apify alternatives (companies directory)

Sorted roughly by fit for our use case (directory filters + founders) and adoption.

| Actor | Author | Users (30d) | Rating | Pricing (FREE tier ≈) | Method | Input summary | Notes / last activity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **`michael.g/y-combinator-scraper`** | Michael G | **1,583** / 36 | **5.0** (35+) | from **~$10–150/1K** (PPE tiered; Store shows high FREE event price) | Directory scrape + enrichment (company/founder/jobs/emails) — not documented as pure Algolia-only | Filters + start URLs; companies & founders | Most popular Store YC actor; expensive; last run 2026-09-03 |
| **`memo23/y-combinator-scraper`** | Muhamed Didovic | **191** / 36 | **4.62** | **~$1/1K** + start fee | **Companies: Algolia (no proxy)**; jobs: Cheerio HTML | `mode` jobs/companies, URLs auto-route, `queries[]`, batches, industries, regions, hiring, optional founder/jobs enrich | Strong dual jobs+companies; schema differs from ours; 98.8% success; last run 2026-09-03 |
| **`clearpath/ycombinator-api-scraper`** | ClearPath | **396** / 17 | **4.34** | from **~$2.50–3.50/1K** | Fast bulk extract; **proxy recommended**; “no browser” | `scrapeAllCompanies` / `Founders` / `Jobs` booleans | Bulk dump oriented, weaker filter parity with our connector; last run 2026-09-02 |
| **`fatihtahta/y-combinator-directory-scraper`** | Fatih Tahta | **258** / 35 | **~3.4** | **~$2/1K** companies (+ optional founder/email events) | **Algolia** (+ partitioning past 1000-hit window); founder emails optional | `queries`, batches, industries, hiring, `outputMode` companies/founders | Closest “rich directory + founders” peer; last run 2026-09-03 |
| **`haketa/ycombinator-companies-scraper`** | Haketa | **118** / 26 | 1 review | **~$2.50/1K** (tiered down to $1) | **Direct Algolia** (`45BWZJ1SGC` / `YCCompany_production`); claims no browser | batch/industry/status/hiring/top company style filters | High 30d run volume (809); docs claim pure Algolia; last run 2026-09-03 |
| **`parseforge/y-combinator-scraper`** | ParseForge | **71** / 9 | — | **~$12–16/1K** | Walks directory + **detail HTML** for founders/jobs | `startUrls`, batches, industries, regions, hiring, `scrapeFounders`/`Jobs` | Expensive; free plan capped at 10 items; last run 2026-09-03 |
| **`crawlerbros/y-combinator-scraper`** | Crawler Bros | **37** / 2 | **4.47** | **~$1/1K** (+ usage) | **Algolia** list + Inertia `data-page` HTML for founders/jobs | `directoryUrl`, query, batch enum, industry, `scrapeFounders`/`OpenJobs` | Batch enum is limited/outdated vs our full season strings; last activity light |
| **`seemuapps/yc-companies-scraper`** | Andrew | **4** / 1 | — | **~$3/1K** | Directory listing (Algolia-shaped fields; no founder LinkedIn in sample output) | query, batches, industries, regions, status, hiring, maxItems | Very close input shape to ours but **no founders** in documented output; tiny usage |
| **`themineworks/y-combinator-scraper`** | The Mine Works | **2** / 1 | — | **~$2/1K** (per founder/company row) | **Algolia** for list; **HTML profile** for founders | `keyword`, `batch[]`, industries, tags, `hiringStatus`, `fetchFounders` | Good docs; one-row-per-founder billing; brand new / tiny usage |
| **`khadinakbar/ycombinator-scraper`** | (community) | (see Store) | — | PPE + residential proxy for HTML | **Algolia** + re-fetch key from `/companies`; HTML enrich via **residential proxy** | mode companies/jobs, filters, `scrapeFounders`, proxy config | Explicitly designed around 403/429 on HTML (session pool + proxy) |
| **`apivault_labs/yc-companies-scraper`** *(ours)* | Apivault Labs | **7** / 2 | — | **$5/1K** | Algolia after **fetching keys from `/companies` HTML**; optional detail HTML | Matches our `prepareYcActorInput` exactly | Small user base; 100% 30d success in Store stats; **key bootstrap depends on `/companies`** |

Jobs-only actors (e.g. `parsebird/yc-jobs-scraper`) exist but are **not** directory replacements.

## 4. Resilience to `403` on `ycombinator.com/companies`

Context: our actor (and several peers) bootstrap Algolia keys from the `/companies` HTML page, then optionally hit `/companies/{slug}` for founders.

| Risk layer | Who is exposed | Who looks better on paper |
| --- | --- | --- |
| **403 on directory HTML** (key bootstrap) | `apivault_labs`, `khadinakbar` (docs: re-acquire key from `/companies`), any actor that scrapes the grid as HTML | Actors that claim **direct Algolia** with a known public app/index (`haketa`, `memo23` companies mode, `crawlerbros`, `themineworks`, `fatihtahta`) — **if** they do not need a fresh page scrape for the secured key |
| **403 on company detail HTML** (founders) | Anyone with `fullDetails` / `fetchFounders` / Inertia parse | Company-list-only Algolia runs (skip founders); or actors with **residential proxy + session retirement** (`khadinakbar`, `mikolabs`-style, `clearpath` proxy option) |
| **Algolia itself** | All Algolia-based actors | Same dependency; usually less bot-blocked than HTML, but secured keys can expire / rotate |

**Practical takeaway**

- If the live failure is **403 fetching `/companies` before Algolia**, switching to an actor that **does not bootstrap from that HTML** (or caches/hardcodes the public Algolia path carefully) is the highest-leverage Store experiment: try **`haketa/ycombinator-companies-scraper`** or **`memo23/y-combinator-scraper`** (companies mode) first.
- If the failure is **403 only on detail pages**, keep Algolia discovery but prefer actors with **proxy/session handling** for enrichment, or run with founders off.
- **Not proven in this research:** no live A/B runs were executed against the 403. Treat resilience notes as doc-based hypotheses.

## 5. Closest drop-in vs best-of-breed

**Closest input/output to our connector**

1. Stay on **`apivault_labs/yc-companies-scraper`** (exact schema we already map).
2. Near schema: **`seemuapps/yc-companies-scraper`** (filters similar; **missing founders**).
3. Near capability: **`fatihtahta/y-combinator-directory-scraper`**, **`themineworks/y-combinator-scraper`**, **`haketa/ycombinator-companies-scraper`** — need adapter work on field names + billing rows.

**Best adoption / ops signal**

- **`michael.g/y-combinator-scraper`** — largest user base, but pricing and schema make it a poor cheap drop-in.
- **`memo23/y-combinator-scraper`** — strong recent usage, Algolia companies path, cheap; worth a spike if we accept input remapping.

**Non-Apify note (out of Store scope)**

- [yc-oss/api](https://github.com/yc-oss/api) publishes daily JSON from Algolia (no live scrape). Useful as a fallback cache, not a live Apify actor.

## 6. Suggested next experiments (no code yet)

1. Reproduce failure: is 403 on `/companies`, `/companies/{slug}`, or Algolia?
2. Smoke-test **`haketa`** and **`memo23` (companies)** with the same batch/industry filters we use in prod (small `maxItems`).
3. If founders required under 403, trial **`khadinakbar`** with residential proxy enrichment only.
4. Only then consider connector `actorId` swap + `prepareYcActorInput` adapter — not trivial for michael.g / clearpath bulk APIs.

## Sources

- Code: `src/lib/connectors/yc-companies.ts`
- Apify Store API: `GET https://api.apify.com/v2/store?search=y%20combinator`
- Actor markdown mirrors: `https://apify.com/{user}/{actor}.md`
- Web search for additional Store listings (crawlerbros, haketa, seemuapps, themineworks, khadinakbar)

`APIFY_TOKEN` was not used for authenticated API calls in this research (public Store + `.md` pages only). Secrets were not printed.
