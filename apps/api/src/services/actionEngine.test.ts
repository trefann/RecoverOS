import { describe, it, expect, vi } from "vitest";
import { ActionEngine } from "./actionEngine.js";
import type { PaymentProvider } from "../integrations/payments/PaymentProvider.js";

function fakeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    retryPayment: vi.fn().mockResolvedValue({ success: true, providerPaymentId: "pay_1", amountCaptured: 5000 }),
    sendReminder: vi.fn().mockResolvedValue({ sent: true, channel: "email" }),
    ...overrides,
  };
}

const baseInput = {
  amount: 5000,
  currency: "INR",
  method: "upi",
  providerPaymentId: "pay_1",
  customerEmail: "a@b.com",
  customerName: "A",
  reason: "test",
};

describe("actionEngine", () => {
  it("RETRY_PAYMENT calls the provider and reports SUCCESS on a successful retry", async () => {
    const provider = fakeProvider();
    const engine = new ActionEngine(provider);
    const result = await engine.execute({ ...baseInput, actionType: "RETRY_PAYMENT" });
    expect(provider.retryPayment).toHaveBeenCalledOnce();
    expect(provider.sendReminder).not.toHaveBeenCalled();
    expect(result.outcome).toBe("SUCCESS");
    expect(result.amountRecovered).toBe(5000);
  });

  it("SEND_REMINDER calls the provider's reminder path only", async () => {
    const provider = fakeProvider();
    const engine = new ActionEngine(provider);
    const result = await engine.execute({ ...baseInput, actionType: "SEND_REMINDER" });
    expect(provider.sendReminder).toHaveBeenCalledOnce();
    expect(provider.retryPayment).not.toHaveBeenCalled();
    expect(result.outcome).toBe("SUCCESS");
    expect(result.amountRecovered).toBe(0);
  });

  it("WAIT and ESCALATE_HUMAN never touch the payment provider", async () => {
    const provider = fakeProvider();
    const engine = new ActionEngine(provider);

    const waitResult = await engine.execute({ ...baseInput, actionType: "WAIT" });
    const escalateResult = await engine.execute({ ...baseInput, actionType: "ESCALATE_HUMAN" });

    expect(provider.retryPayment).not.toHaveBeenCalled();
    expect(provider.sendReminder).not.toHaveBeenCalled();
    expect(waitResult.outcome).toBe("NO_OP");
    expect(escalateResult.outcome).toBe("NO_OP");
  });

  it("reports FAILURE when the provider's retry fails", async () => {
    const provider = fakeProvider({
      retryPayment: vi.fn().mockResolvedValue({ success: false, providerPaymentId: "pay_1", amountCaptured: 0 }),
    });
    const engine = new ActionEngine(provider);
    const result = await engine.execute({ ...baseInput, actionType: "RETRY_PAYMENT" });
    expect(result.outcome).toBe("FAILURE");
    expect(result.amountRecovered).toBe(0);
  });
});
