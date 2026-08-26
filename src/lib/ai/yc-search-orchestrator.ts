import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getAnthropic, hasLiveAnthropicKey, mapAnthropicError } from "@/lib/ai/client";
import { logClaude, logClaudeError } from "@/lib/ai/claude-log";
import {
  currentYcBatch,
  parseYcBatch,
  parseYcIndustry,
  parseYcTags,
  prepareYcActorInput,
  recentYcBatches,
  ycBatchesForYear,
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
  batches: z.array(z.string().max(32)).max(16).optional().nullable(),
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
      "Return today's date and the current Y Combinator season label (e.g. Summer 2026).",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_recent_yc_batches",
    description:
      "Return the N most recent YC seasons ending at the current batch. YOU choose N from the user's time window (past year, 18 months, 2 years, etc.).",
    input_schema: {
      type: "object",
      properties: {
        count: {
          type: "number",
          description: "How many seasons to include (1–16).",
        },
      },
      required: ["count"],
      additionalProperties: false,
    },
  },
  {
    name: "list_yc_batches_for_year",
    description:
      "Return all four YC seasons for a calendar year. Use when the user names a year like 2025.",
    input_schema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Four-digit year, e.g. 2025" },
      },
      required: ["year"],
      additionalProperties: false,
    },
  },
  {
    name: "parse_explicit_yc_batch",
    description:
      "Parse an explicit season phrase like 'Summer 2025', 'W24', or 'current batch'.",
    input_schema: {
      type: "object",
      properties: {
        phrase: { type: "string" },
      },
      required: ["phrase"],
      additionalProperties: false,
    },
  },
  {
    name: "list_yc_industries",
    description:
      "List allowed YC directory industry values. You choose which industry fits.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_yc_tags",
    description:
      "List allowed YC directory tag values. You decide whether tags help or over-filter.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "extract_topical_keywords",
    description:
      "Strip boilerplate from long text and return optional suggestions. You decide what to keep.",
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
      "Preview the Apify actor payload for candidate filters before finalize.",
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
      "Commit the final yc-companies filters YOU chose. Keep query empty or ≤4 topical words. Never put product pitches or brand names in query.",
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
          description: "One sentence explaining your chosen filters",
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
      return {
        batch: currentYcBatch(),
        today: new Date().toISOString().slice(0, 10),
        note: "Call list_recent_yc_batches or list_yc_batches_for_year to build a window — you choose how wide.",
      };
    case "list_recent_yc_batches": {
      const batches = recentYcBatches(Number(args.count));
      return {
        count: batches.length,
        batches,
        currentBatch: currentYcBatch(),
      };
    }
    case "list_yc_batches_for_year": {
      const year = Number(args.year);
      if (!Number.isFinite(year) || year < 2005 || year > 2100) {
        return { ok: false, errors: ["year must be a four-digit YC-era year"] };
      }
      return { year, batches: ycBatchesForYear(year) };
    }
    case "parse_explicit_yc_batch": {
      const phrase = String(args.phrase ?? "");
      const batch = parseYcBatch(phrase);
      return batch
        ? { batch, matched: true }
        : {
            matched: false,
            hint: "No explicit season found. Try list_recent_yc_batches or list_yc_batches_for_year.",
          };
    }
    case "list_yc_industries":
      return { industries: YC_INDUSTRIES };
    case "list_yc_tags":
      return { tags: YC_TAGS };
    case "extract_topical_keywords": {
      const text = String(args.text ?? "");
      return {
        keywords: ycKeywordsFrom(text) || null,
        suggestedIndustry: parseYcIndustry(text) ?? null,
        suggestedTags: parseYcTags(text),
        note: "Suggestions only — decide what to keep, drop, or ignore.",
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
      if (
        !draft.batches?.length &&
        !draft.batch &&
        !draft.industry &&
        !draft.query
      ) {
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
    "Convert the user research request into yc-companies directory filters.",
    "",
    "You decide industry, tags, batch-window width, hiring flag, and keywords.",
    "Tools only provide facts (current season, season lists, allowed industries/tags, previews).",
    "Do not invent season labels — request them via tools.",
    "Do not put product pitches, Scope lines, or the user's brand name into query.",
    "Prefer structured filters over free-text when they express the ask.",
    "Call preview_yc_actor_input before finalize_yc_search, then finalize exactly once.",
  ];
  if (mode === "broaden") {
    return [
      ...shared,
      "",
      "BROADEN MODE: previous filters returned zero companies.",
      "Choose a broader filter set that still matches user intent.",
      "Do not finalize with completely empty filters.",
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
