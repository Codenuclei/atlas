# OpenRouter probe

Date: 2026-09-02

## Env keys (no secrets)

- `OPENROUTER_API_KEY`: present=yes, prefix=`sk-or-v`, length=73
- `ANTHROPIC_API_KEY`: present=yes, prefix=`sk-ant-`, length=108
- Also in `.env` (names only): `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`
- Related names checked absent: `OPENROUTER_KEY`, `OR_API_KEY`, `OPEN_ROUTER_API_KEY`

`ANTHROPIC_API_KEY` is still present alongside OpenRouter.

## Models list

`GET https://openrouter.ai/api/v1/models` — HTTP 200 (auth OK).

Sample / notable model ids observed:

- `anthropic/claude-fable-5.1`
- `anthropic/claude-fable-5.1:batch`
- `anthropic/claude-opus-5`
- `anthropic/claude-opus-5:batch`
- `anthropic/claude-sonnet-5`
- `anthropic/claude-sonnet-5:batch`
- `anthropic/claude-fable-5`
- `anthropic/claude-fable-5:batch`
- `openai/gpt-5.6-luna-pro`
- `openai/gpt-5.6-luna-pro:batch`
- `openai/gpt-5.6-luna`
- `openai/gpt-5.6-luna:batch`
- `openai/gpt-5.6-terra-pro`
- `openai/gpt-5.6-terra-pro:batch`
- sonnet-4 variants: `anthropic/claude-sonnet-4.6`, `anthropic/claude-sonnet-4.6:batch`, `anthropic/claude-sonnet-4.5`, `anthropic/claude-sonnet-4.5:batch`, `anthropic/claude-sonnet-4`

## Chat completions probe

- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions`
- Model tried: `anthropic/claude-sonnet-4`
- Request: tiny user message asking for `openrouter-ok`, `max_tokens: 50`
- HTTP: 200
- Working model id: **`anthropic/claude-sonnet-4`**
- Credits: **yes** (usage included nonzero `cost`; `is_byok: false`)

### Response shape summary

Top-level keys: `choices`, `created`, `id`, `model`, `object`, `provider`, `service_tier`, `system_fingerprint`, `usage`

- `choices[0].message.content`: `'openrouter-ok'`
- `choices[0].finish_reason`: `stop`
- `model` (echo): `anthropic/claude-sonnet-4`
- `usage`: `{"prompt_tokens": 16, "completion_tokens": 8, "total_tokens": 24, "cost": 0.000168, "is_byok": false, "prompt_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0, "audio_tokens": 0, "video_tokens": 0}, "cost_details": {"upstream_inference_cost": 0.000168, "upstream_inference_prompt_cost": 4.8e-05, "upstream_inference_completions_cost": 0.00012}, "completion_tokens_details": {"reasoning_tokens": 0, "image_tokens": 0, "audio_tokens": 0}}`
- `error`: `None`

OpenAI-compatible chat shape: `choices[].message.{role, content}` plus `usage.{prompt_tokens, completion_tokens, total_tokens, cost, ...}`.

## Verdict

| Item | Result |
|------|--------|
| `OPENROUTER_API_KEY` | present, prefix `sk-or-v`, length 73 |
| `ANTHROPIC_API_KEY` | still present |
| Auth | works |
| Working model | `anthropic/claude-sonnet-4` |
| Credits | work (paid completion succeeded) |
