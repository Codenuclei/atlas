import { describe, expect, it } from "vitest";
import {
  deriveQueryStatus,
  jobNeedsDatasetIngest,
  reconcileQueryStatus,
} from "@/lib/status";
import { defaultWorkspaceTab } from "@/lib/view-model";

describe("jobNeedsDatasetIngest", () => {
  it("ingests succeeded jobs with a dataset and no counted items", () => {
    expect(
      jobNeedsDatasetIngest({
        status: "succeeded",
        itemCount: 0,
        apifyDatasetId: "ds_1",
        input: {},
      }),
    ).toBe(true);
  });

  it("skips jobs already marked ingested", () => {
    expect(
      jobNeedsDatasetIngest({
        status: "succeeded",
        itemCount: 0,
        apifyDatasetId: "ds_1",
        input: { _ingested: true },
      }),
    ).toBe(false);
  });

  it("skips running or empty-dataset jobs", () => {
    expect(
      jobNeedsDatasetIngest({
        status: "running",
        itemCount: 0,
        apifyDatasetId: "ds_1",
        input: {},
      }),
    ).toBe(false);
    expect(
      jobNeedsDatasetIngest({
        status: "succeeded",
        itemCount: 0,
        apifyDatasetId: null,
        input: {},
      }),
    ).toBe(false);
  });

  it("skips jobs that already counted items", () => {
    expect(
      jobNeedsDatasetIngest({
        status: "succeeded",
        itemCount: 12,
        apifyDatasetId: "ds_1",
        input: {},
      }),
    ).toBe(false);
  });
});

describe("stale query status edge cases", () => {
  it("does not leave a finished YC job as queued at the query level", () => {
    expect(reconcileQueryStatus("queued", ["succeeded"])).toBe("succeeded");
    expect(deriveQueryStatus(["succeeded"])).toBe("succeeded");
  });

  it("keeps partial failure visible when mixed terminals finish", () => {
    expect(reconcileQueryStatus("running", ["succeeded", "failed"])).toBe(
      "failed",
    );
  });

  it("does not rewrite an already terminal stored status", () => {
    expect(reconcileQueryStatus("aborted", ["succeeded"])).toBe("aborted");
  });
});

describe("YC vs creatives landing", () => {
  it("never defaults a YC evidence run onto creatives empty state", () => {
    expect(
      defaultWorkspaceTab({
        hasContentRecords: false,
        hasEvidence: true,
        hasContentJobs: false,
        running: false,
      }),
    ).toBe("evidence");
  });
});
