import { describe, it, expect } from "vitest";
import { DecisionProposalSchema, InvestigationResultSchema } from "./schemas.js";

describe("DecisionProposalSchema", () => {
  it("accepts a well-formed proposal", () => {
    const parsed = DecisionProposalSchema.safeParse({
      action: "RETRY_PAYMENT",
      delay_minutes: 15,
      max_attempts: 1,
      confidence: 0.91,
      reason: "Temporary failure and high recovery probability",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unsupported action (TEST 3: malformed LLM output must never validate)", () => {
    const parsed = DecisionProposalSchema.safeParse({
      action: "TRANSFER_FUNDS",
      delay_minutes: 15,
      max_attempts: 1,
      confidence: 0.91,
      reason: "not a real action",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects out-of-range confidence", () => {
    const parsed = DecisionProposalSchema.safeParse({
      action: "RETRY_PAYMENT",
      delay_minutes: 15,
      max_attempts: 1,
      confidence: 1.5,
      reason: "bad confidence",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("InvestigationResultSchema", () => {
  it("rejects an unknown cause", () => {
    const parsed = InvestigationResultSchema.safeParse({
      cause: "aliens",
      confidence: 0.9,
      evidence: ["..."],
      recovery_probability: 0.5,
    });
    expect(parsed.success).toBe(false);
  });
});
