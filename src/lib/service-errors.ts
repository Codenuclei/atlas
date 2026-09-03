import { classifyAnthropicFailure } from "@/lib/ai/synthesize";

export type ServiceName = "Apify" | "OpenRouter" | "Anthropic" | "Cohesivity";

export type ServiceAlert = {
  service: ServiceName;
  title: string;
  message: string;
  tone: "warning" | "danger";
};

const APIFY_PATTERNS =
  /apify|Maximum charged results must be greater than zero|exceed your remaining usage|purchase credits|console\.apify\.com|monthly usage|upgrade to a paid plan/i;

const OPENROUTER_PATTERNS = /openrouter|sk-or-|openrouter\.ai/i;

const COHESIVITY_PATTERNS =
  /cohesivity|COH_APPLICATION_KEY|SQL budget|ephemeral Postgres|429|Too Many/i;

function alertForService(
  service: ServiceName,
  title: string,
  message: string,
  tone: "warning" | "danger",
): ServiceAlert {
  return { service, title, message, tone };
}

/** Map a single error string to a service alert, if recognized. */
export function classifyServiceError(text: string): ServiceAlert | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (APIFY_PATTERNS.test(trimmed)) {
    return alertForService(
      "Apify",
      "Apify",
      "Apify usage or credits are exhausted (or too low to charge results). Top up at console.apify.com/billing, then retry the scrape.",
      "danger",
    );
  }

  if (OPENROUTER_PATTERNS.test(trimmed)) {
    return alertForService(
      "OpenRouter",
      "OpenRouter",
      "OpenRouter rejected the request — check API key, model availability, or account credits at openrouter.ai.",
      "danger",
    );
  }

  const anthropicKind = classifyAnthropicFailure(new Error(trimmed));
  if (anthropicKind === "credits" || anthropicKind === "rate_limit") {
    return alertForService(
      "Anthropic",
      "Anthropic / Claude",
      anthropicKind === "credits"
        ? "Claude billing blocked synthesis. Verify Anthropic/OpenRouter credits and retry."
        : "Claude rate limits blocked synthesis. Wait a moment and retry.",
      "warning",
    );
  }
  if (
    /anthropic|claude|credit balance is too low|purchase credits|rate[_ ]?limit/i.test(
      trimmed,
    )
  ) {
    return alertForService(
      "Anthropic",
      "Anthropic / Claude",
      "Claude billing or rate limits blocked synthesis. Verify Anthropic/OpenRouter credits and retry.",
      "warning",
    );
  }

  if (COHESIVITY_PATTERNS.test(trimmed)) {
    return alertForService(
      "Cohesivity",
      "Cohesivity",
      "Database or hosting limits were hit on Cohesivity. Wait a moment and refresh — partial results may still be saved.",
      "warning",
    );
  }

  return null;
}

/** Turn raw job/query error strings into named service alerts (deduped). */
export function classifyServiceAlerts(errors: string[]): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  const seen = new Set<ServiceName>();
  for (const raw of errors) {
    const alert = classifyServiceError(raw);
    if (!alert || seen.has(alert.service)) continue;
    seen.add(alert.service);
    alerts.push(alert);
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
