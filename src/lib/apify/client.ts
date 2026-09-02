import { ApifyClient, ApifyApiError } from "apify-client";
import { AppError } from "@/lib/errors";
import { isTestMode, maxQueryCostUsd } from "@/lib/utils";
import { getMockApify } from "@/lib/apify/mock";

export type ActorRunLike = {
  id: string;
  status: string;
  defaultDatasetId?: string | null;
  statusMessage?: string | null;
};

export type DatasetPage = {
  items: Record<string, unknown>[];
  total: number;
  offset: number;
  count: number;
  limit: number;
};

export type ApifyProvider = {
  startActor: (
    actorId: string,
    input: Record<string, unknown>,
    options?: {
      timeout?: number;
      memory?: number;
      /** Soft result cap for the actor input path — prefer putting maxItems in input. */
      maxItems?: number;
      /**
       * Pay-per-event actors reject runs when computed charge is below ~$0.10.
       * Pass a generous ceiling so platform cost limits never abort research.
       */
      maxTotalChargeUsd?: number;
    },
  ) => Promise<ActorRunLike>;
  getRun: (runId: string) => Promise<ActorRunLike>;
  abortRun: (runId: string) => Promise<ActorRunLike>;
  listDatasetItems: (
    datasetId: string,
    options?: { limit?: number; offset?: number },
  ) => Promise<DatasetPage>;
};

function mapApifyError(error: unknown): never {
  if (error instanceof ApifyApiError) {
    const status = error.statusCode ?? 500;
    const message = error.message || "Apify request failed.";
    if (status === 401) {
      throw new AppError("UNAUTHORIZED", "Apify rejected the API token.", 401);
    }
    if (status === 404) {
      throw new AppError("NOT_FOUND", "Apify actor or run was not found.", 404);
    }
    if (status === 429) {
      throw new AppError(
        "RATE_LIMITED",
        "Apify rate limit exceeded after retries.",
        429,
      );
    }
    // Near-zero Apify balance often surfaces as "Maximum charged results must be
    // greater than zero" (computed allowance = 0) or an explicit usage exceed.
    if (
      /exceed your remaining usage|monthly usage|purchase credits|upgrade to a paid plan|Maximum charged results must be greater than zero/i.test(
        message,
      )
    ) {
      throw new AppError(
        "UPSTREAM",
        "Apify usage/credits are exhausted (or too low to charge any results). Top up or upgrade at https://console.apify.com/billing/subscription, then retry the scrape.",
        status >= 400 ? status : 402,
        { type: error.type, upstream: message },
      );
    }
    throw new AppError("UPSTREAM", message, status, {
      type: error.type,
    });
  }
  throw error;
}

function createLiveApify(): ApifyProvider {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new AppError(
      "UNAUTHORIZED",
      "APIFY_TOKEN is not set. Add it to .env before running scrapes.",
      401,
    );
  }

  const client = new ApifyClient({
    token,
    maxRetries: 8,
    minDelayBetweenRetriesMillis: 500,
  });

  return {
    async startActor(actorId, input, options) {
      try {
        // Pass platform maxItems (>=1) for pay-per-result actors; keep a high
        // maxTotalChargeUsd ceiling for pay-per-event actors. Result caps also
        // live in actor input (maxItems / maxResults).
        const startOptions: Record<string, unknown> = {};
        if (options?.timeout != null) startOptions.timeout = options.timeout;
        if (options?.memory != null) startOptions.memory = options.memory;
        const ceiling = maxQueryCostUsd();
        startOptions.maxTotalChargeUsd =
          options?.maxTotalChargeUsd ??
          (Number.isFinite(ceiling) && ceiling > 0 ? Math.max(ceiling, 1) : 50);
        // Pay-per-result actors require platform maxItems > 0 ("Maximum charged results…").
        // Prefer the connector's prepared cap; never send 0.
        const charged =
          options?.maxItems != null && options.maxItems > 0
            ? Math.floor(options.maxItems)
            : typeof input.maxResults === "number" && input.maxResults > 0
              ? Math.floor(input.maxResults)
              : typeof input.maxItems === "number" && input.maxItems > 0
                ? Math.floor(input.maxItems)
                : 100;
        startOptions.maxItems = Math.max(1, charged);
        return (await client.actor(actorId).start(input, startOptions)) as ActorRunLike;
      } catch (error) {
        mapApifyError(error);
      }
    },
    async getRun(runId) {
      try {
        const run = await client.run(runId).get();
        if (!run) {
          throw new AppError("NOT_FOUND", `Apify run ${runId} was not found.`, 404);
        }
        return run as ActorRunLike;
      } catch (error) {
        mapApifyError(error);
      }
    },
    async abortRun(runId) {
      try {
        return (await client.run(runId).abort({ gracefully: true })) as ActorRunLike;
      } catch (error) {
        mapApifyError(error);
      }
    },
    async listDatasetItems(datasetId, options) {
      try {
        const page = await client.dataset(datasetId).listItems({
          limit: options?.limit ?? 100,
          offset: options?.offset ?? 0,
        });
        return {
          items: (page.items ?? []) as Record<string, unknown>[],
          total: page.total ?? page.items?.length ?? 0,
          offset: page.offset ?? options?.offset ?? 0,
          count: page.count ?? page.items?.length ?? 0,
          limit: page.limit ?? options?.limit ?? 100,
        };
      } catch (error) {
        mapApifyError(error);
      }
    },
  };
}

let cached: ApifyProvider | undefined;

export function getApify(): ApifyProvider {
  if (isTestMode()) return getMockApify();
  if (!cached) cached = createLiveApify();
  return cached;
}

export function resetApifyClient() {
  cached = undefined;
}
