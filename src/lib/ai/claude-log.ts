type ClaudeLogDetails = Record<string, unknown>;

export function logClaude(event: string, details: ClaudeLogDetails = {}) {
  const payload = {
    at: new Date().toISOString(),
    ...details,
  };
  console.log(`[claude] ${event}`, JSON.stringify(payload));
}

export function logClaudeError(
  event: string,
  error: unknown,
  details: ClaudeLogDetails = {},
) {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "Error";
  logClaude(event, {
    ...details,
    errorName: name,
    errorMessage: message,
  });
}
