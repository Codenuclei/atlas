# Query Scraper

Type a research question. Claude turns it into a controlled scrape plan. Apify collects LinkedIn, Y Combinator, YouTube, and Instagram evidence. Review the plan, monitor the source pipeline, analyze performance patterns, receive content recommendations, rerun research, and export selected data.

Brand/channel names and Instagram handles work dynamically. Explicit YouTube URLs are supported for precise channel analysis; arbitrary URLs are rejected.

Content-intelligence runs first infer audience archetypes and owned-channel pillars, then searches YouTube and Instagram for external references, surfaces five exact linked creatives per platform, and extracts reusable angles, hooks, structures, and formats.

## Setup

```bash
cp .env.example .env
# set APIFY_TOKEN and ANTHROPIC_API_KEY
npx prisma migrate dev --name init
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

| Variable | Purpose |
| --- | --- |
| `APIFY_TOKEN` | Apify API token |
| `ANTHROPIC_API_KEY` | Claude API key |
| `DATABASE_URL` | Prisma SQLite URL, default `file:./dev.db` |
| `MAX_QUERY_COST_USD` | Reject plans above this estimate (default `5`) |
| `MAX_ITEMS_CAP` | Hard cap on `maxItems` (default `100`) |
| `APP_ACCESS_TOKEN` | Enables non-localhost API access; optional bearer/x-app-token for clients |
| `SCRAPER_TEST_MODE` | `1` uses mock Apify/Claude/YC |

## Security defaults

- API access is localhost-only unless `APP_ACCESS_TOKEN` is configured (then remote/same-origin UI is enabled; a wrong bearer/x-app-token is rejected).
- Mutating routes enforce same-origin checks and per-client rate limits.
- Plans are limited to six approved connector steps and 250 total requested items.
- Detail actor targets are resolved internally; user-supplied detail URLs are discarded.
- CSV exports neutralize spreadsheet formulas and scraped links are restricted to HTTP(S).
- Status reads are side-effect free. Apify/Claude work only starts through explicit POST actions.

## Scripts

```bash
npm run dev
npm test
npm run test:e2e
npm run lint
npx prisma studio
```

## Docs

- [PRD](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)

<!-- BEGIN:cohesivity -->
If you are another agent who just picked up this project, you can get the status of its backend using the status endpoint, read more at https://cohesivity.ai/backend-for-ai-agents
<!-- END:cohesivity -->
