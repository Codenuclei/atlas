import { hasLiveAnthropicKey } from "@/lib/ai/client";
import { usesCohesivityPostgres } from "@/lib/cohesivity/postgres";
import { listConnectors } from "@/lib/connectors/registry";
import { noStoreHeaders, rateLimit } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  rateLimit(request, "health", 60);
  const apifyToken = process.env.APIFY_TOKEN?.trim() ?? "";
  const apifyConfigured =
    apifyToken.length > 20 &&
    apifyToken.startsWith("apify_") &&
    !apifyToken.includes("test-");

  const database = usesCohesivityPostgres() ? "cohesivity" : "sqlite";

  return Response.json(
    {
      ok: apifyConfigured && hasLiveAnthropicKey(),
      services: {
        apify: apifyConfigured ? "configured" : "missing",
        claude: hasLiveAnthropicKey() ? "configured" : "missing",
        database,
      },
      connectorCount: listConnectors().length,
      timestamp: new Date().toISOString(),
    },
    { headers: noStoreHeaders() },
  );
}