import { describe, expect, it } from "vitest";
import { ApifyApiError } from "apify-client";
import { AppError } from "@/lib/errors";
import { resetApifyClient } from "@/lib/apify/client";

describe("error mapping", () => {
  it("exposes ApifyApiError as the client error type", () => {
    expect(ApifyApiError.name).toBe("ApifyApiError");
  });

  it("creates AppError cost cap codes", () => {
    const error = new AppError("COST_CAP", "too expensive", 400);
    expect(error.status).toBe(400);
    expect(error.code).toBe("COST_CAP");
  });

  it("resets the live apify cache without throwing in test mode", () => {
    resetApifyClient();
  });
});
