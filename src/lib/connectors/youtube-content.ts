import { z } from "zod";
import { clampMaxItems } from "@/lib/utils";
import { firstText, type ScrapedRecord } from "@/lib/normalize";
import type { Connector } from "@/lib/connectors/types";

const youtubeUrl = z
  .string()
  .url()
  .max(300)
  .refine(
    (value) => ["youtube.com", "www.youtube.com", "youtu.be"].includes(new URL(value).hostname),
    "Must be a YouTube URL",
  );

export const youtubeContentSchema = z
  .object({
    channelUrls: z.array(youtubeUrl).max(10).default([]),
    searchQueries: z.array(z.string().trim().min(2).max(120)).max(10).default([]),
    maxItems: z.number().int().min(1).max(100).default(30),
    includeShorts: z.boolean().default(true),
  })
  .refine(
    (input) => input.channelUrls.length > 0 || input.searchQueries.length > 0,
    "Provide a channel URL or search query",
  );

export type YoutubeContentInput = z.infer<typeof youtubeContentSchema>;

function compactMetric(value: unknown, label: string) {
  const text = firstText(value);
  return text ? `${text} ${label}` : "";
}

export const youtubeContentConnector: Connector<YoutubeContentInput> = {
  id: "youtube-content",
  label: "YouTube channel content",
  sourceType: "youtube",
  kind: "search",
  actorId: "streamers/youtube-scraper",
  usdPerThousand: 2,
  capability:
    "Collect recent videos and Shorts from YouTube channels or brand searches for content-performance analysis. Params: channelUrls[] for explicit channel/video URLs, searchQueries[] for dynamic brand/topic discovery, maxItems, includeShorts.",
  inputSchema: youtubeContentSchema,
  buildRun(input) {
    const maxItems = clampMaxItems(input.maxItems, 30);
    const regular = input.includeShorts ? Math.ceil(maxItems * 0.65) : maxItems;
    const shorts = input.includeShorts ? maxItems - regular : 0;
    return {
      executor: "apify",
      actorId: "streamers/youtube-scraper",
      maxItems,
      input: {
        startUrls: input.channelUrls.map((url) => ({ url })),
        searchQueries: input.channelUrls.length ? [] : input.searchQueries,
        maxResults: regular,
        maxResultsShorts: shorts,
        maxResultStreams: 0,
        sortVideosBy: "NEWEST",
      },
    };
  },
  normalize(raw): ScrapedRecord {
    const url = firstText(raw.url, raw.videoUrl, raw.link);
    const channel = firstText(raw.channelName, raw.channelTitle, raw.channel);
    const views = compactMetric(raw.viewCount ?? raw.views, "views");
    const likes = compactMetric(raw.likes ?? raw.likeCount, "likes");
    const comments = compactMetric(raw.commentsCount ?? raw.commentCount, "comments");
    return {
      sourceType: "youtube",
      externalId: firstText(raw.videoId, raw.id, url) || "youtube-content",
      title: firstText(raw.title, raw.name) || "YouTube video",
      subtitle: [channel, views, likes, comments].filter(Boolean).join(" · "),
      url,
      location: firstText(raw.date, raw.publishedAt, raw.uploadDate, raw.duration),
      imageUrl: firstText(raw.thumbnailUrl, raw.thumbnail, raw.thumbnailImageUrl),
      raw: { ...raw, researchRole: "owned" },
    };
  },
  costEstimate(input) {
    const itemCount = clampMaxItems(input.maxItems, 30);
    return {
      usd: Math.max(0.05, (itemCount / 1000) * 2),
      itemCount,
      note: "Estimated YouTube actor usage; final Apify compute can vary.",
    };
  },
};