# YC Orchestrator Eval Iteration Log

| id | result | change |
|----|--------|--------|
| B01 | PASS | no change |
| B02 | PASS | no change |
| B03 | PASS | no change |
| B04 | PASS | no change |
| B05 | PASS | no change |
| B06 | PASS | no change |
| B07 | PASS | no change |
| B08 | PASS | no change |
| B09 | PASS | no change |
| B10 | PASS | no change |
| B11 | PASS | no change |
| B12 | PASS | no change |
| C01 | PASS | no change |
| C02 | PASS | no change |
| C03 | PASS | no change |
| C04 | PASS | no change |
| C05 | PASS | no change |
| C06 | PASS | no change |
| C07 | PASS | no change |
| C08 | PASS | no change |
| C09 | PASS | no change |
| C10 | PASS (retest after full-suite grade_fail) | Tightened rule 5 + Example 6 BAD: brand analogies (Stripe-like) → industry only, query empty — never invent payments/brand query |
| A01 | PASS | no change |
| A02 | PASS | no change |
| A03 | PASS | no change |
| A04 | PASS (retest after full-suite plan_invalid) | Added Example 8 + QUALITY rule: always finalize_yc_search; on overstacked AND-asks pick primary industry, ≤1 orthogonal tag, one time strategy, drop extras |
| A05 | PASS | no change |
| A06 | PASS | no change |
| A07 | PASS | no change |
| A08 | PASS | no change |
| A09 | PASS | no change |
| A10 | PASS | no change |

## Notes
- Smoke B01 OK (API key present via .env).
- A01/A05: grader PASS with current-batch default (Summer 2026); empty tags/query; no PLAN_INVALID. No prompt change (not inventing industry/tags).
- No grade_fail or plan_invalid during per-id loop → zero prompt edits.
- Full suite run follows.

## Full suite
- First full run: 31/32 — A04 `plan_invalid` (Claude did not finalize). Prompt: Example 8 + always-finalize / drop-extras rule.
- A04 retest: PASS.
- Second full run: follows.

- Second full run: 31/32 — C10 grade_fail (query=\"payments infrastructure\"). Prompt: rule 5 + Example 6 brand-analogy BAD.
- C10 retest: PASS. A04 recheck next; third full suite follows.

- Third full run: **32/32 PASS**, 0 failed, 0 code failures.
