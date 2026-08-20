import { z } from "zod";
import { clampMaxItems } from "@/lib/utils";
import { firstText, type ScrapedRecord } from "@/lib/normalize";
import type { Connector } from "@/lib/connectors/types";

export const linkedinJobsSchema = z.object({
  jobTitles: z.array(z.string().min(1)).min(1),
  locations: z.array(z.string()).optional(),
  maxItems: z.number().optional(),
  company: z.array(z.string()).optional(),
  sortBy: z.string().optional(),
  workplaceType: z.string().optional(),
  employmentType: z.string().optional(),
  salary: z.string().optional(),
});

export type LinkedinJobsInput = z.infer<typeof linkedinJobsSchema>;

function pairCount(input: LinkedinJobsInput) {
  const titles = Math.max(input.jobTitles.length, 1);
  const locations = Math.max(input.locations?.length ?? 1, 1);
  return titles * locations;
}

export const linkedinJobsConnector: Connector<LinkedinJobsInput> = {
  id: "linkedin-jobs",
  label: "LinkedIn jobs",
  sourceType: "job",
  kind: "search",
  actorId: "harvestapi/linkedin-job-search",
  usdPerThousand: 1,
  capability:
    "Search LinkedIn job listings by title and location. maxItems applies PER jobTitle x location pair, so keep titles and locations short. Params: jobTitles[] (required), locations[], maxItems, company[], sortBy, workplaceType, employmentType, salary.",
  inputSchema: linkedinJobsSchema,
  buildRun(input) {
    const maxItems = clampMaxItems(input.maxItems, 10);
    return {
      executor: "apify",
      actorId: "harvestapi/linkedin-job-search",
      maxItems,
      input: {
        jobTitles: input.jobTitles,
        locations: input.locations ?? [],
        maxItems,
        company: input.company ?? [],
        sortBy: input.sortBy ?? "date",
        workplaceType: input.workplaceType,
        employmentType: input.employmentType,
        salary: input.salary,
      },
    };
  },
  normalize(raw): ScrapedRecord {
    const url = firstText(raw.linkedinUrl, raw.url, raw.jobUrl);
    const company =
      raw.company && typeof raw.company === "object"
        ? firstText((raw.company as { name?: string }).name)
        : firstText(raw.companyName);
    const location =
      raw.location && typeof raw.location === "object"
        ? firstText(
            (raw.location as { parsed?: { text?: string } }).parsed?.text,
            (raw.location as { text?: string }).text,
          )
        : firstText(raw.location);
    return {
      sourceType: "job",
      externalId: firstText(raw.id, url, raw.title) || "job",
      title: firstText(raw.title, raw.jobTitle) || "LinkedIn job",
      subtitle: [company, firstText(raw.employmentType, raw.workplaceType)]
        .filter(Boolean)
        .join(" · "),
      url,
      location,
      imageUrl: firstText(
        raw.company && typeof raw.company === "object"
          ? (raw.company as { logo?: string }).logo
          : "",
      ),
      raw,
    };
  },
  costEstimate(input) {
    const perPair = clampMaxItems(input.maxItems, 10);
    const itemCount = perPair * pairCount(input);
    return {
      usd: (itemCount / 1000) * 1,
      itemCount,
      note: `$1 per 1,000 jobs. maxItems is per title×location pair (${pairCount(input)} pairs).`,
    };
  },
};
