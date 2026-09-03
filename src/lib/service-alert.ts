export type ServiceName = "Apify" | "OpenRouter" | "Anthropic" | "Cohesivity";

export type ServiceAlert = {
  service: ServiceName;
  title: string;
  message: string;
  tone: "warning" | "danger";
};

const SERVICE_PATTERNS: Array<{
  service: ServiceName;
  test: RegExp;
  title: string;
  message: string;
  tone: "warning" | "danger";
}> = [
  {
    service: "Apify",
    test: /apify|Maximum charged results must be greater than zero|exceed your remaining usage|purchase credits|console\.apify\.com/i,
    title: "Apify",
    message:
      "Apify usage or credits are exhausted (or too low to charge results). Top up at console.apify.com/billing, then retry the scrape.",
    tone: "danger",
  },
  {
    service: "OpenRouter",
    test: /openrouter|sk-or-|openrouter\.ai/i,
    title: "OpenRouter",
    message:
      "OpenRouter rejected the request — check API key, model availability, or account credits at openrouter.ai.",
    tone: "danger",
  },
  {
    service: "Anthropic",
    test: /anthropic|claude|credit balance is too low|purchase credits|rate[_ ]?limit/i,
    title: "Anthropic / Claude",
    message:
      "Claude billing or rate limits blocked synthesis. Verify Anthropic/OpenRouter credits and retry.",
    tone: "warning",
  },
  {
    service: "Cohesivity",
    test: /cohesivity|COH_APPLICATION_KEY|SQL budget|ephemeral Postgres|429|Too Many/i,
    title: "Cohesivity",
    message:
      "Database or hosting limits were hit on Cohesivity. Wait a moment and refresh — partial results may still be saved.",
    tone: "warning",
  },
];

/** Turn raw job/query error strings into named service alerts (deduped). */
export function classifyServiceAlerts(errors: string[]): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  const seen = new Set<ServiceName>();
  for (const raw of errors) {
    const text = raw.trim();
    if (!text) continue;
    for (const pattern of SERVICE_PATTERNS) {
      if (!pattern.test.test(text) || seen.has(pattern.service)) continue;
      seen.add(pattern.service);
      alerts.push({
        service: pattern.service,
        title: pattern.title,
        message: pattern.message,
        tone: pattern.tone,
      });
      break;
    }
  }
  return alerts;
}

/** Fallback alert when no known service matched. */
export function genericServiceAlert(message: string): ServiceAlert {
  return {
    service: "Cohesivity",
    title: "Something went wrong",
    message,
    tone: "danger",
  };
}
