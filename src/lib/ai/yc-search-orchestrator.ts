import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getAnthropic, hasLiveAnthropicKey, mapAnthropicError } from "@/lib/ai/client";
import { logClaude, logClaudeError } from "@/lib/ai/claude-log";
import {
  currentYcBatch,
  parseYcBatch,
  parseYcIndustry,
  parseYcRecentBatches,
  parseYcTags,
  prepareYcActorInput,
  recentYcBatches,
  ycCompaniesSchema,
  ycKeywordsFrom,
  type YcCompaniesInput,
} from "@/lib/connectors/yc-companies";
import { AppError } from "@/lib/errors";
import { isTestMode } from "@/lib/utils";

const ORCHESTRATOR_MODEL = "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 8;

const YC_INDUSTRIES = [
  "Fintech",
  "Healthcare",
  "Education",
  "Consumer",
  "B2B",
  "Industrials",
  "Real Estate and Construction",
  "Government",
] as const;

const YC_TAGS = [
  "AI",
  "Education",
  "Developer Tools",
  "Marketplace",
  "Crypto",
] as const;

const finalizeSchema = z.object({
  query: z.string().max(80).optional().nullable(),
  batch: z.string().max(32).optional().nullable(),
  batches: z.array(z.string().max(32)).max(12).optional().nullable(),
  industry: z.string().max(64).optional().nullable(),
  tags: z.array(z.string().max(64)).max(8).optional().nullable(),
  isHiring: z.boolean().optional().nullable(),
  maxItems: z.number().int().min(1).max(100).optional().nullable(),
  rationale: z.string().max(400),
});

export type YcOrchestratorResult = {
  params: YcCompaniesInput & { _orchestrated?: boolean };
  rationale: string;
  source: "tool-orchestrator";
  toolCalls: number;
};

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_current_yc_batch",
    description:
      "Return the current Y Combinator season label (e.g. Fall 2026) based on today's date.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "resolve_yc_time_window",
    description:
      "Convert natural-language time windows into YC season labels. Use for phrases like 'past one year', 'last 12 months', 'current batch', or an explicit season like 'Summer 2025'.",
    input_schema: {
      type: "object",
      properties: {
        phrase: {
          type: "string",
          description: "Time-window phrase from the user request",
        },
      },
      required: ["phrase"],
      additionalProperties: false,
    },
  },
  {
    name: "list_yc_industries",
    description: "List allowed YC directory industry filter values.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_yc_tags",
    description: "List allowed YC directory tag filter values.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "extract_topical_keywords",
    description:
      "Extract a short topical keyword phrase from a long product pitch or research request. Never returns the full sentence.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "preview_yc_actor_input",
    description:
      "Preview the exact Apify actor payload for candidate YC filters. Call this before finalize to verify batches/industry/query look sane.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        batch: { type: "string" },
        batches: { type: "array", items: { type: "string" } },
        industry: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        isHiring: { type: "boolean" },
        maxItems: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "finalize_yc_search",
    description:
      "Commit the final yc-companies search filters. Prefer structured filters (industry + batches + tags). Keep query empty or ≤4 topical words. Never include product pitches, Scope lines, or company names the user is comparing against.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        batch: { type: "string" },
        batches: { type: "array", items: { type: "string" } },
        industry: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        isHiring: { type: "boolean" },
        maxItems: { type: "number" },
        rationale: {
          type: "string",
          description: "One sentence explaining the chosen filters",
        },
      },
      required: ["rationale"],
      additionalProperties: false,
    },
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function draftFromArgs(args: Record<string, unknown>): YcCompaniesInput {
  return {
    query: typeof args.query === "string" ? args.query : undefined,
    batch: typeof args.batch === "string" ? args.batch : undefined,
    batches: Array.isArray(args.batches) ? args.batches.map(String) : undefined,
    industry: typeof args.industry === "string" ? args.industry : undefined,
    tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
    isHiring: typeof args.isHiring === "boolean" ? args.isHiring : undefined,
    maxItems: typeof args.maxItems === "number" ? args.maxItems : 50,
  };
}

function runTool(name: string, input: unknown): unknown {
  const args = asRecord(input);
  switch (name) {
    case "get_current_yc_batch":
      return { batch: currentYcBatch(), today: new Date().toISOString().slice(0, 10) };
    case "resolve_yc_time_window": {
      const phrase = String(args.phrase ?? "");
      const recent = parseYcRecentBatches(phrase);
      if (recent?.length) {
        return { batches: recent, matched: "recent_window" };
      }
      const single = parseYcBatch(phrase);
      if (single) {
        return { batches: [single], matched: "single_batch" };
      }
      if (/\bcurrent\b|\blatest\b/i.test(phrase)) {
        return { batches: [currentYcBatch()], matched: "current" };
      }
      return {
        batches: [],
        matched: "none",
        hint: "No season matched. Call get_current_yc_batch or pass an explicit season like 'Summer 2025'.",
        examples: recentYcBatches(4),
      };
    }
    case "list_yc_industries":
      return { industries: YC_INDUSTRIES };
    case "list_yc_tags":
      return { tags: YC_TAGS };
    case "extract_topical_keywords": {
      const text = String(args.text ?? "");
      const keywords = ycKeywordsFrom(text);
      const industry = parseYcIndustry(text);
      const tags = parseYcTags(text);
      return {
        keywords: keywords || null,
        inferredIndustry: industry ?? null,
        inferredTags: tags,
        guidance:
          "If industry/tags already capture the niche, prefer empty keywords. Never keep brand/product names from the pitch.",
      };
    }
    case "preview_yc_actor_input": {
      const draft = draftFromArgs(args);
      const actor = prepareYcActorInput(draft);
      const warnings: string[] = [];
      if ((actor.query?.split(/\s+/).filter(Boolean).length ?? 0) > 4) {
        warnings.push("query is too long — shorten to ≤4 topical words or clear it");
      }
      if (!actor.batches.length && !actor.industries.length && !actor.query) {
        warnings.push("filters are empty — set industry and/or batches");
      }
      if (/is an? |scope:|similar companies/i.test(actor.query ?? "")) {
        warnings.push("query still looks like a sentence/pitch");
      }
      return { actorInput: actor, warnings, ok: warnings.length === 0 };
    }
    case "finalize_yc_search": {
      const parsed = finalizeSchema.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          errors: parsed.error.issues.map((issue) => issue.message),
        };
      }
      const draft: YcCompaniesInput = {
        query: parsed.data.query?.trim() || undefined,
        batch: parsed.data.batch?.trim() || undefined,
        batches: parsed.data.batches?.filter(Boolean).length
          ? parsed.data.batches.filter(Boolean)
          : undefined,
        industry: parsed.data.industry?.trim() || undefined,
        tags: parsed.data.tags?.filter(Boolean).length
          ? parsed.data.tags.filter(Boolean)
          : undefined,
        isHiring: parsed.data.isHiring ?? false,
        maxItems: parsed.data.maxItems ?? 50,
      };
      if (
        draft.industry &&
        !YC_INDUSTRIES.some(
          (item) => item.toLowerCase() === draft.industry!.toLowerCase(),
        )
      ) {
        return {
          ok: false,
          errors: [`industry must be one of: ${YC_INDUSTRIES.join(", ")}`],
        };
      }
      if (draft.tags && draft.industry) {
        draft.tags = draft.tags.filter(
          (tag) => tag.toLowerCase() !== draft.industry!.toLowerCase(),
        );
        if (!draft.tags.length) draft.tags = undefined;
      }
      if ((draft.query?.split(/\s+/).filter(Boolean).length ?? 0) > 4) {
        return {
          ok: false,
          errors: ["query must be empty or at most 4 topical words"],
        };
      }
      if (!draft.batches?.length && !draft.batch && !draft.industry && !draft.query) {
        return {
          ok: false,
          errors: ["set at least one of batches, industry, or a short query"],
        };
      }
      const validated = ycCompaniesSchema.parse(draft);
      const preview = prepareYcActorInput(validated);
      return {
        ok: true,
        params: validated,
        actorPreview: {
          query: preview.query,
          batches: preview.batches,
          industries: preview.industries,
          tags: preview.tags,
          isHiring: preview.isHiring,
          maxResults: preview.maxResults,
        },
        rationale: parsed.data.rationale,
      };
    }
    default:
      return { ok: false, errors: [`Unknown tool: ${name}`] };
  }
}

function systemPrompt(mode: "initial" | "broaden") {
  const shared = [
    "You are the YC search orchestrator for Atlas Research.",
    "Your job: turn a natural-language research request into correct yc-companies directory filters.",
    "",
    "RULES",
    "- Always use tools. Do not invent season labels — call resolve_yc_time_window or get_current_yc_batch.",
    "- Prefer structured filters: industry + batches + tags. Keep free-text query empty when possible.",
    "- If the user pastes a product pitch and asks for similar YC companies, map the niche to industry/tags (e.g. teaching/lesson plans → Education, AI-powered → tag AI) and do NOT put the pitch or brand name into query.",
    "- Do not set a tag that duplicates the industry name (e.g. industry Education + tag Education).",
    "- 'Past one year' / 'last 12 months' → resolve_yc_time_window, then put ALL returned seasons into batches.",
    "- isHiring only when the user asks about hiring/open roles.",
    "- maxItems defaults to 50.",
    "- Call preview_yc_actor_input before finalize_yc_search. Fix warnings.",
    "- Finish by calling finalize_yc_search exactly once with the final filters.",
  ];
  if (mode === "broaden") {
    return [
      ...shared,
      "",
      "BROADEN MODE",
      "The previous filter set returned ZERO companies from the YC directory.",
      "Propose a broader but still relevant filter set.",
      "Preferred order: drop tags → drop hiring-only → widen/remove batch window → keep industry if possible.",
      "Never finalize with completely empty filters (that scrapes the whole directory).",
    ].join("\n");
  }
  return shared.join("\n");
}

export async function orchestrateYcSearch(
  userQuery: string,
  draft?: YcCompaniesInput,
  options?: { mode?: "initial" | "broaden"; previousFilters?: YcCompaniesInput },
): Promise<YcOrchestratorResult> {
  if (isTestMode()) {
    throw new AppError(
      "INTERNAL",
      "YC tool orchestrator is disabled in test mode.",
      500,
    );
  }
  if (!hasLiveAnthropicKey()) {
    throw new AppError(
      "UNAUTHORIZED",
      "ANTHROPIC_API_KEY is required to build YC search filters. Heuristic query building is disabled.",
      401,
    );
  }

  const mode = options?.mode ?? "initial";
  const client = getAnthropic();
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        mode === "broaden"
          ? "Previous YC filters returned zero companies. Broaden them with tools, then finalize_yc_search."
          : "Resolve YC directory search filters for this research request.",
        "",
        `USER REQUEST:\n${userQuery}`,
        draft && Object.keys(draft).length
          ? `\nDRAFT PARAMS:\n${JSON.stringify(draft)}`
          : "",
        options?.previousFilters
          ? `\nPREVIOUS FILTERS (0 RESULTS):\n${JSON.stringify(options.previousFilters)}`
          : "",
        "",
        "Use tools, then finalize_yc_search.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  let toolCalls = 0;
  let finalized: YcOrchestratorResult | null = null;

  logClaude("yc_orchestrator.start", {
    mode,
    queryPreview: userQuery.slice(0, 160),
    draft,
    previousFilters: options?.previousFilters,
  });

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await client.messages.create({
        model: ORCHESTRATOR_MODEL,
        max_tokens: 1600,
        system: systemPrompt(mode),
        tools: TOOLS,
        tool_choice: { type: "auto" },
        messages,
      });

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (toolUses.length === 0) {
        logClaude("yc_orchestrator.no_tools", {
          stopReason: response.stop_reason,
          round,
        });
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        toolCalls += 1;
        const result = runTool(use.name, use.input);
        logClaude("yc_orchestrator.tool", {
          name: use.name,
          input: use.input,
          ok: asRecord(result).ok !== false,
        });

        if (use.name === "finalize_yc_search" && asRecord(result).ok === true) {
          const params = ycCompaniesSchema.parse(asRecord(result).params);
          finalized = {
            params: { ...params, _orchestrated: true },
            rationale: String(asRecord(result).rationale ?? ""),
            source: "tool-orchestrator",
            toolCalls,
          };
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(result),
          is_error: asRecord(result).ok === false,
        });
      }

      messages.push({ role: "user", content: toolResults });

      if (finalized) {
        logClaude("yc_orchestrator.done", {
          source: finalized.source,
          toolCalls,
          params: finalized.params,
          rationale: finalized.rationale,
        });
        return finalized;
      }

      if (response.stop_reason === "end_turn") break;
    }
  } catch (error) {
    logClaudeError("yc_orchestrator.error", error, {
      queryPreview: userQuery.slice(0, 160),
    });
    if (error instanceof AppError) throw error;
    mapAnthropicError(error);
  }

  throw new AppError(
    "PLAN_INVALID",
    "Claude did not finalize YC search filters via tools. Retry the query.",
    400,
    { toolCalls },
  );
}

/** Refine every yc-companies step in a plan via the tool-calling orchestrator. */
export async function refineYcPlanWithOrchestrator(
  plan: {
    interpretation: string;
    steps: Array<{
      connectorId: string;
      params: Record<string, unknown>;
      purpose: string;
      dependsOn: string[];
    }>;
  },
  userQuery: string,
) {
  const steps = [];
  let interpretation = plan.interpretation;
  for (const step of plan.steps) {
    if (step.connectorId !== "yc-companies") {
      steps.push(step);
      continue;
    }
    const result = await orchestrateYcSearch(
      userQuery,
      step.params as YcCompaniesInput,
    );
    steps.push({
      ...step,
      params: result.params as Record<string, unknown>,
      purpose: step.purpose || "Find matching YC companies",
    });
    if (result.rationale && !interpretation.includes(result.rationale)) {
      interpretation = `${interpretation}\n\nYC filters: ${result.rationale}`;
    }
  }
  return { ...plan, interpretation, steps };
}
