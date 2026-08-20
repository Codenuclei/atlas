import type { AnyConnector, ConnectorId } from "@/lib/connectors/types";
import { CONNECTOR_IDS } from "@/lib/connectors/types";
import { linkedinProfileSearchConnector } from "@/lib/connectors/linkedin-profile-search";
import { linkedinProfileConnector } from "@/lib/connectors/linkedin-profile";
import { linkedinCompanySearchConnector } from "@/lib/connectors/linkedin-company-search";
import { linkedinCompanyConnector } from "@/lib/connectors/linkedin-company";
import { linkedinJobsConnector } from "@/lib/connectors/linkedin-jobs";
import { ycCompaniesConnector } from "@/lib/connectors/yc-companies";
import { AppError } from "@/lib/errors";
import { youtubeContentConnector } from "@/lib/connectors/youtube-content";
import { instagramContentConnector } from "@/lib/connectors/instagram-content";
import { youtubeContentExamplesConnector } from "@/lib/connectors/youtube-content-examples";
import { instagramContentExamplesConnector } from "@/lib/connectors/instagram-content-examples";

const connectors = {
  "linkedin-profile-search": linkedinProfileSearchConnector,
  "linkedin-profile": linkedinProfileConnector,
  "linkedin-company-search": linkedinCompanySearchConnector,
  "linkedin-company": linkedinCompanyConnector,
  "linkedin-jobs": linkedinJobsConnector,
  "yc-companies": ycCompaniesConnector,
  "youtube-content": youtubeContentConnector,
  "instagram-content": instagramContentConnector,
  "youtube-content-examples": youtubeContentExamplesConnector,
  "instagram-content-examples": instagramContentExamplesConnector,
} as const satisfies Record<ConnectorId, AnyConnector>;

export function listConnectors(): AnyConnector[] {
  return Object.values(connectors);
}

export function getConnector(id: string): AnyConnector {
  const match = CONNECTOR_IDS.find(
    (candidate) => candidate.toLowerCase() === id.toLowerCase(),
  );
  if (!match) {
    throw new AppError(
      "PLAN_INVALID",
      `Unknown connector "${id}".`,
      400,
      { allowed: CONNECTOR_IDS },
    );
  }
  return connectors[match];
}

export function buildCapabilityCatalog(): string {
  return listConnectors()
    .map((connector) => {
      return [
        `## ${connector.id}`,
        `Label: ${connector.label}`,
        `Kind: ${connector.kind}`,
        `Source type: ${connector.sourceType}`,
        `Cost: $${connector.usdPerThousand} per 1,000 results`,
        connector.capability,
      ].join("\n");
    })
    .join("\n\n");
}
