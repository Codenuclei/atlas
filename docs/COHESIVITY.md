# Deploy with Cohesivity

Host this scraper on Cohesivity Railway hosting (`*.cohesivity.app`).

## 1. Init (creates `.cohesivity`)

From the project root:

```bash
npx @cohesivity/init
```

If Node is unavailable:

```bash
curl -fsSL https://cohesivity.ai/quickstart.sh | bash
```

Optional flags from the docs: `--no-plugin` (skill only), `--dry-run` (no changes).

Init writes `.cohesivity` (gitignored) with `tenant_id`, `coh_management_key`, `coh_application_key`, and claim instructions. Reuse that file across sessions; do not re-run init unless missing.

## 2. Claim URL (keep the project)

Ephemeral tenants expire in 72 hours. Mint a one-click claim link:

```bash
curl -s -X POST https://cohesivity.ai/api/claim/url \
  -H "Authorization: Bearer <coh_management_key>"
```

Open the returned `approval_url` (`https://cohesivity.ai/c/...`) in a browser. Poll `/api/wait` with the wait blob if you need to block until claimed.

## 3. Provision Railway hosting

```bash
curl -s -X POST https://cohesivity.ai/api/resources/railway-hosting \
  -H "Authorization: Bearer <coh_management_key>"
```

Response includes `deployment_url` like `https://<tenant_id>.cohesivity.app`.

## 4. Set env vars

Ensure these are in `.env` / the environment before deploy (the deploy script upserts them via `/api/railway/env`):

| Key | Notes |
| --- | --- |
| `APIFY_TOKEN` | Required for live scrapes |
| `ANTHROPIC_API_KEY` | Required for planning/synthesis |
| `APP_ACCESS_TOKEN` | Required for non-localhost API access |
| `DATABASE_URL` | Defaults to `file:./prod.db` on deploy |
| `SCRAPER_TEST_MODE` | Defaults to `0` |
| `NODE_ENV` | Defaults to `production` |

## 5. Deploy

```bash
npm run deploy:cohesivity
```

This provisions `railway-hosting` if needed, sets env vars, packs source (excludes `node_modules`, `.next`, `.env`, `.cohesivity`, `*.db`), and POSTs multipart to `/api/railway/deploy?wait=ready`.

## Expected URL

`https://<tenant_id>.cohesivity.app` (or a claimed vanity like `https://<vanity>.cohesivity.app`).

Use `APP_ACCESS_TOKEN` as `x-app-token` or `Authorization: Bearer …` for remote API clients. Same-origin browser UI works once the token is configured on the server. Localhost remains open without a token.

## Commands if init was never run

```bash
cd /Users/mu-mac_3/Projects/new-scraper
npx @cohesivity/init
# or: npx @cohesivity/init --no-plugin
npm run deploy:cohesivity
```

Claim (after init) to keep the 72h ephemeral tenant:

```bash
curl -s -X POST https://cohesivity.ai/api/claim/url \
  -H "Authorization: Bearer $(grep -oE 'coh_man_[a-z0-9]+' .cohesivity | head -1)"
```

