import { ApifyClient, ApifyApiError } from "apify-client";
import { AppError } from "@/lib/errors";
import { isTestMode } from "@/lib/utils";
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
    options?: { timeout?: number; memory?: number; maxItems?: number },
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
    throw new AppError("UPSTREAM", error.message || "Apify request failed.", status, {
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
        return (await client.actor(actorId).start(input, options)) as ActorRunLike;
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
