import { z } from "zod";
import { clampMaxItems } from "@/lib/utils";
import type { Connector } from "@/lib/connectors/types";
import { instagramContentConnector } from "@/lib/connectors/instagram-content";

export const instagramContentExamplesSchema = z.object({
  hashtags: z
    .array(z.string().trim().min(2).max(50).regex(/^[a-zA-Z0-9_]+$/))
    .max(8)
    .default([]),
  maxItems: z.number().int().min(1).max(100).default(40),
  newerThan: z.string().trim().max(40).default("6 months"),
});

export type InstagramContentExamplesInput = z.infer<
  typeof instagramContentExamplesSchema
>;

export const instagramContentExamplesConnector: Connector<InstagramContentExamplesInput> =
  {
    id: "instagram-content-examples",
    label: "Aligned Instagram creatives",
    sourceType: "instagram",
    kind: "search",
    actorId: "apify/instagram-scraper",
    usdPerThousand: 3,
    capability:
      "Internal research step. Search Instagram hashtag feeds for exact external posts and Reels aligned with the audience and content pillars identified from owned-channel research. hashtags[] is hydrated internally.",
    inputSchema: instagramContentExamplesSchema,
    buildRun(input) {
      const maxItems = clampMaxItems(input.maxItems, 40);
      return {
        executor: "apify",
        actorId: "apify/instagram-scraper",
        maxItems,
        input: {
          directUrls: input.hashtags.map(
            (hashtag) =>
              `https://www.instagram.com/explore/tags/${hashtag.toLowerCase()}/`,
          ),
          resultsType: "posts",
          resultsLimit: maxItems,
          onlyPostsNewerThan: input.newerThan,
          addParentData: true,
        },
      };
    },
    normalize(raw) {
      const record = instagramContentConnector.normalize(raw);
      return {
        ...record,
        subtitle: `Reference creative · ${record.subtitle}`,
        raw: { ...raw, researchRole: "reference" },
      };
    },
    costEstimate(input) {
      const itemCount = clampMaxItems(input.maxItems, 40);
      return {
        usd: Math.max(0.05, (itemCount / 1000) * 3),
        itemCount,
        note: "Estimated Instagram creative-reference actor usage.",
      };
    },
  };