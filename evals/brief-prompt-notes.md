# YC research brief prompt — before / after

## Before

`YC_BRIEF_INSTRUCTIONS` asked for strategic depth but treated companies like a filtered directory:

- Group by industry; cite batch, one-liner, URL; “explain why relevant”
- Batch snapshot = which batches + themes
- Founders to contact = name/title/company/LinkedIn + ~2 sentences why
- Research notes = caveats/gaps

Missing in practice: explicit **why this company for this query**, **who does what** on the founding team, **founder↔thesis linkage** from prior experience, **path/how** (batch, wedge, GTM, exits, distribution), and dedicated **repeating vs emerging** pattern sections. Summaries often read as lists with a relevance clause bolted on.

Scored `summary` was capped at **6000** chars (too tight for dense research).

## After

Same four core sections, plus two pattern sections, with harder per-company requirements:

1. **COMPANIES BY INDUSTRY** — each bullet must cover: why included (tied to user ask) · what it does (evidence-only) · founder linkage (name + role + prior experience, or “evidence missing”) · how they got here when evidence supports it · URLs/batch when present · label founder-profile-only data
2. **BATCH SNAPSHOT** — cohort mix and themes, not a re-list
3. **REPEATING PATTERNS** — 3–6 cross-cutting patterns with ≥2 company examples each
4. **EMERGING / NEW PATTERNS** — what’s different in recent vs older cohorts (or say the set is too thin)
5. **FOUNDERS TO CONTACT** — outreach rationale tied to query fit, role split, and clearest founder↔thesis linkage
6. **RESEARCH NOTES** — evidence gaps; never invent URLs/metrics

Length: prefer dense bullets; scored summary budget raised **6000 → 12000** chars so denser briefs stay parseable.

## Files

- `src/lib/ai/synthesize.ts` — prompt + schema max + model cascade
- `src/lib/ai/yc-fallback-brief.ts` — research-quality deterministic fallback
- `tests/unit/synthesize-brief-prompt.test.ts` — locks required phrases
- `tests/unit/yc-fallback-brief.test.ts` — India heuristics + section coverage
- `evals/brief-prompt-notes.md` — this note

## Follow-up (truncation)

Dense briefs hit `max_tokens: 8192` on stream (`stop_reason=max_tokens`) and truncated the structured `scoreResults` JSON (`Unterminated string`). Raised `BRIEF_MAX_TOKENS` to **16384** for both score + stream (models support 128k output). Added LENGTH/COMPLETION: always finish all six section headers; RESEARCH NOTES must appear.

## Robust fallback (Claude unavailable)

When Claude fails (especially **credit/billing** exhaustion), briefs no longer collapse to a flat company dump. `buildYcFallbackBrief` (`src/lib/ai/yc-fallback-brief.ts`) produces the same six section headers with:

- Query-relevance ranking (incl. soft India name/location heuristics — never asserted as nationality)
- Industry grouping + why-included / founder linkage / path clauses
- Computed repeating patterns and recent-vs-older emerging notes from evidence
- Model cascade before fallback: stream `opus → sonnet → haiku`; score `sonnet → haiku`; **credits skip the rest** and go straight to this digest

Tests: `tests/unit/yc-fallback-brief.test.ts`

