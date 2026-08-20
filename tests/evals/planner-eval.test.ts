import { describe, expect, it } from "vitest";
import { heuristicPlan } from "@/lib/ai/heuristic-plan";
import { validatePlan } from "@/lib/ai/planner";
import type { ScrapePlan } from "@/lib/ai/plan-schema";
import recorded from "./recorded-plans.json";

type Case = {
  query: string;
  expectConnectors: string[];
  expectIntent?: string;
};

const cases: Case[] = [
  {
    query: "AI infra founders in SF who went through YC",
    expectConnectors: ["yc-companies", "linkedin-profile-search"],
    expectIntent: "mixed",
  },
  {
    query: "senior backend roles at fintechs in Berlin",
    expectConnectors: ["linkedin-jobs"],
    expectIntent: "jobs",
  },
  {
    query: "YC companies hiring in fintech",
    expectConnectors: ["yc-companies"],
  },
  {
    query: "who leads engineering at Ramp",
    expectConnectors: ["linkedin-profile-search"],
  },
  {
    query: "fintech startups in New York",
    expectConnectors: ["linkedin-company-search"],
  },
  {
    query: "product designers in London",
    expectConnectors: ["linkedin-profile-search"],
  },
  {
    query: "remote software engineer jobs",
    expectConnectors: ["linkedin-jobs"],
  },
  {
    query: "Y Combinator Winter 2024 companies",
    expectConnectors: ["yc-companies"],
  },
  {
    query: "founders at YC companies in SF",
    expectConnectors: ["yc-companies", "linkedin-profile-search"],
  },
  {
    query: "machine learning engineers in Seattle",
    expectConnectors: ["linkedin-profile-search"],
  },
  {
    query: "openings for data scientists in Austin",
    expectConnectors: ["linkedin-jobs"],
  },
  {
    query: "climate tech companies",
    expectConnectors: ["linkedin-company-search"],
  },
  {
    query: "YC batch companies in healthcare",
    expectConnectors: ["yc-companies"],
  },
  {
    query: "staff frontend roles in NYC",
    expectConnectors: ["linkedin-jobs"],
  },
  {
    query: "people named Ada Lovelace",
    expectConnectors: ["linkedin-profile-search"],
  },
];

describe("planner eval suite", () => {
  for (const testCase of cases) {
    it(testCase.query, () => {
      const recordedPlan = recorded[testCase.query as keyof typeof recorded] as
        | ScrapePlan
        | undefined;
      const plan = validatePlan(recordedPlan ?? heuristicPlan(testCase.query));
      const ids = plan.steps.map((step) => step.connectorId);
      for (const expected of testCase.expectConnectors) {
        expect(ids).toContain(expected);
      }
      if (testCase.expectIntent) {
        expect(plan.intent).toBe(testCase.expectIntent);
      }
    });
  }
});
