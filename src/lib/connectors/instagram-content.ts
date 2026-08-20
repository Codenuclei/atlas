import { z } from "zod";
import { clampMaxItems } from "@/lib/utils";
import { firstText, type ScrapedRecord } from "@/lib/normalize";
import type { Connector } from "@/lib/connectors/types";

const profile = z
  .string()
  .trim()
  .min(2)
  .max(300)
  .transform((value) => value.replace(/^@/, ""));

export const instagramContentSchema = z
  .object({
    profiles: z.array(profile).max(10).default([]),
    search: z.string().trim().max(120).default(""),
    maxItems: z.number().int().min(1).max(100).default(30),
    newerThan: z.string().trim().max(40).default("6 months"),
  })
  .refine(
    (input) => input.profiles.length > 0 || input.search.length > 0,
    "Provide an Instagram profile or brand search",
  );

export type InstagramContentInput = z.infer<typeof instagramContentSchema>;

function postTitle(raw: Record<string, unknown>, owner: string) {
  const caption = firstText(raw.caption, raw.text, raw.alt);
  if (caption) return caption.length > 110 ? `${caption.slice(0, 107)}…` : caption;
  return `Instagram content${owner ? ` by @${owner}` : ""}`;
}

function metric(value: unknown, label: string) {
  const text = firstText(value);
  return text ? `${text} ${label}` : "";
}

export const instagramContentConnector: Connector<InstagramContentInput> = {
  id: "instagram-content",
  label: "Instagram channel content",
  sourceType: "instagram",
  kind: "search",
  actorId: "apify/instagram-scraper",
  usdPerThousand: 3,
  capability:
    "Collect public Instagram posts and Reels from profile handles/URLs or discover profiles from a brand search. Params: profiles[], search, maxItems, newerThan. Use bare handles when known.",
  inputSchema: instagramContentSchema,
  buildRun(input) {
    const maxItems = clampMaxItems(input.maxItems, 30);
    return {
      executor: "apify",
      actorId: "apify/instagram-scraper",
      maxItems,
      input: {
        directUrls: input.profiles,
        resultsType: "posts",
        resultsLimit: maxItems,
        onlyPostsNewerThan: input.newerThan,
        search: input.profiles.length ? "" : input.search,
        searchType: "user",
        searchLimit: 10,
        addParentData: true,
      },
    };
  },
  normalize(raw): ScrapedRecord {
    const owner = firstText(
      raw.ownerUsername,
      raw.username,
      raw.owner && typeof raw.owner === "object"
        ? (raw.owner as { username?: string }).username
        : "",
    );
    const shortcode = firstText(raw.shortCode, raw.shortcode, raw.code);
    const url = firstText(
      raw.url,
      raw.postUrl,
      shortcode ? `https://www.instagram.com/p/${shortcode}/` : "",
    );
    const likes = metric(raw.likesCount ?? raw.likes, "likes");
    const comments = metric(raw.commentsCount ?? raw.comments, "comments");
    const views = metric(raw.videoViewCount ?? raw.videoPlayCount, "views");
    return {
      sourceType: "instagram",
      externalId: firstText(raw.id, shortcode, url) || "instagram-content",
      title: postTitle(raw, owner),
      subtitle: [owner ? `@${owner}` : "", views, likes, comments]
        .filter(Boolean)
        .join(" · "),
      url,
      location: firstText(raw.timestamp, raw.takenAt, raw.type, raw.productType),
      imageUrl: firstText(raw.displayUrl, raw.imageUrl, raw.thumbnailUrl),
      raw: { ...raw, researchRole: "owned" },
    };
  },
  costEstimate(input) {
    const itemCount = clampMaxItems(input.maxItems, 30);
    return {
      usd: Math.max(0.05, (itemCount / 1000) * 3),
      itemCount,
      note: "Estimated Instagram actor usage; final Apify compute can vary.",
    };
  },
};