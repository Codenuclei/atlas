# YC company evidence shape

## Problem (Education brief)

Research NOTES reported founder profiles instead of company records: missing websites / YC directory URLs, and one-liners reconstructed from founder bios.

## Root cause

1. `expandYcFounders` correctly **adds** founder rows alongside companies, but founder `raw` lacked `companyOneLiner` / `companyWebsite` / `companyYcUrl`.
2. `ycSignals` only forwarded `url` + thin `oneLiner` fields — **not** `website`, distinct YC URL, `longDescription`, `teamSize`, or `status`.
3. Synthesis took the first N records without preferring `sourceType: "yc"`, so founder profiles could crowd company rows out of the Claude payload.

## Expected evidence shape

**Company (primary):**

```json
{
  "recordKind": "company",
  "name": "Stripe",
  "batch": "Summer 2009",
  "industry": "Fintech",
  "oneLiner": "Payments infrastructure",
  "website": "https://stripe.com",
  "ycUrl": "https://www.ycombinator.com/companies/stripe",
  "teamSize": 8000,
  "status": "Public",
  "founders": [{ "name": "…", "title": "…", "linkedinUrl": "…" }]
}
```

**Founder (linked, never a substitute for the company row):**

```json
{
  "recordKind": "founder",
  "name": "Patrick Collison",
  "companyName": "Stripe",
  "companyOneLiner": "Payments infrastructure",
  "companyWebsite": "https://stripe.com",
  "companyYcUrl": "https://www.ycombinator.com/companies/stripe"
}
```

## Budget

`BRIEF_MAX_TOKENS = 32768`; scored summary zod max `20000` chars so denser company+founder briefs fit.
