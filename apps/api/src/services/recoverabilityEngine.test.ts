import { describe, it, expect } from "vitest";
import { evaluateRecoverability } from "./recoverabilityEngine.js";

describe("recoverabilityEngine", () => {
  it("scores a transient failure with strong history as high recoverability", () => {
    const result = evaluateRecoverability({
      sourceType: "PAYMENT",
      amount: 5000,
      failureReason: "bank_timeout",
      history: { totalPayments: 8, successfulPayments: 7, previousRecoveryAttempts: 0 },
    });
    expect(result.recoverabilityScore).toBeGreaterThan(0.7);
    expect(result.signals).toContain("bank_timeout");
  });

  it("flags a high-value transaction as HIGH priority regardless of recoverability", () => {
    const result = evaluateRecoverability({
      sourceType: "INVOICE",
      amount: 50000,
      failureReason: null,
      history: { totalPayments: 3, successfulPayments: 1, previousRecoveryAttempts: 0 },
    });
    expect(result.priority).toBe("HIGH");
    expect(result.signals).toContain("high_value_transaction");
  });

  it("lowers recoverability as previous recovery attempts pile up", () => {
    const fresh = evaluateRecoverability({
      sourceType: "PAYMENT",
      amount: 1000,
      failureReason: "bank_timeout",
      history: { totalPayments: 4, successfulPayments: 4, previousRecoveryAttempts: 0 },
    });
    const retried = evaluateRecoverability({
      sourceType: "PAYMENT",
      amount: 1000,
      failureReason: "bank_timeout",
      history: { totalPayments: 4, successfulPayments: 4, previousRecoveryAttempts: 3 },
    });
    expect(retried.recoverabilityScore).toBeLessThan(fresh.recoverabilityScore);
  });
});
