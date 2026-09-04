import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "./policyEngine.js";
import type { DecisionProposal, InvestigationResult } from "@recoveros/shared";

const highConfidenceInvestigation: InvestigationResult = {
  cause: "temporary_payment_failure",
  confidence: 0.94,
  evidence: ["Bank timeout", "7 of 8 previous payments succeeded"],
  recovery_probability: 0.83,
};

const solidRetryProposal: DecisionProposal = {
  action: "RETRY_PAYMENT",
  delay_minutes: 15,
  max_attempts: 1,
  confidence: 0.91,
  reason: "Temporary failure and high recovery probability",
};

describe("policyEngine", () => {
  it("approves a well-formed, low-value, high-confidence retry (TEST 5 path)", () => {
    const verdict = evaluatePolicy({
      proposal: solidRetryProposal,
      investigation: highConfidenceInvestigation,
      amount: 5000,
      retryAttemptsSoFar: 0,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.escalate).toBe(false);
  });

  it("rejects a retry once the max-retries-per-case limit is reached", () => {
    const verdict = evaluatePolicy({
      proposal: solidRetryProposal,
      investigation: highConfidenceInvestigation,
      amount: 5000,
      retryAttemptsSoFar: 2, // POLICY_LIMITS.MAX_RETRIES_PER_CASE
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.escalate).toBe(true);
    expect(verdict.reasons.join(" ")).toMatch(/max retries/i);
  });

  it("rejects (and escalates) a high-value transaction that isn't ESCALATE_HUMAN (TEST 4)", () => {
    const verdict = evaluatePolicy({
      proposal: solidRetryProposal,
      investigation: highConfidenceInvestigation,
      amount: 50000, // >= POLICY_LIMITS.HIGH_VALUE_THRESHOLD
      retryAttemptsSoFar: 0,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.escalate).toBe(true);
    expect(verdict.reasons.join(" ")).toMatch(/high-value/i);
  });

  it("rejects a low-confidence decision even if everything else looks fine", () => {
    const verdict = evaluatePolicy({
      proposal: { ...solidRetryProposal, confidence: 0.2 },
      investigation: highConfidenceInvestigation,
      amount: 5000,
      retryAttemptsSoFar: 0,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.escalate).toBe(true);
  });

  it("rejects an out-of-range delay", () => {
    const verdict = evaluatePolicy({
      proposal: { ...solidRetryProposal, delay_minutes: 10000 },
      investigation: highConfidenceInvestigation,
      amount: 5000,
      retryAttemptsSoFar: 0,
    });
    expect(verdict.allowed).toBe(false);
  });

  it("defensively rejects an unsupported action even if it somehow bypassed the Zod enum", () => {
    const verdict = evaluatePolicy({
      proposal: { ...solidRetryProposal, action: "TRANSFER_FUNDS" as DecisionProposal["action"] },
      investigation: highConfidenceInvestigation,
      amount: 5000,
      retryAttemptsSoFar: 0,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.escalate).toBe(true);
  });
});
