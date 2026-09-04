import { describe, it, expect, vi, afterEach } from "vitest";
import type { CaseStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { escalateCase, retryCaseNow, OperatorActionError } from "./operatorActions.js";
import type { PaymentProvider } from "../integrations/payments/PaymentProvider.js";

const hasDb = Boolean(process.env.DATABASE_URL);

function fakeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    retryPayment: vi.fn().mockResolvedValue({ success: true, providerPaymentId: "pay_1", amountCaptured: 1000 }),
    sendReminder: vi.fn().mockResolvedValue({ sent: true, channel: "email" }),
    ...overrides,
  };
}

const createdCaseIds: string[] = [];
const createdCustomerIds: string[] = [];

afterEach(async () => {
  if (!hasDb) return;
  for (const caseId of createdCaseIds.splice(0)) {
    await prisma.openRecoverySlot.deleteMany({ where: { caseId } });
    await prisma.recoveryOutcome.deleteMany({ where: { caseId } });
    await prisma.recoveryAuditLog.deleteMany({ where: { caseId } });
    await prisma.recoveryAction.deleteMany({ where: { caseId } });
    await prisma.recoveryCase.deleteMany({ where: { id: caseId } });
  }
  for (const customerId of createdCustomerIds.splice(0)) {
    await prisma.customer.deleteMany({ where: { id: customerId } });
  }
});

async function makeCase(overrides: { status?: CaseStatus } = {}) {
  const customer = await prisma.customer.create({
    data: { providerCustomerId: `cus_op_${Date.now()}_${Math.random()}`, name: "Operator Test Customer", email: "op@example.com" },
  });
  createdCustomerIds.push(customer.id);

  const recoveryCase = await prisma.recoveryCase.create({
    data: {
      source: "PAYMENT",
      sourceId: `src_${Date.now()}`,
      customerId: customer.id,
      amountAtRisk: 1000,
      currency: "INR",
      riskScore: 0.5,
      recoverabilityScore: 0.5,
      priority: "MEDIUM",
      status: overrides.status ?? "ESCALATED",
    },
  });
  createdCaseIds.push(recoveryCase.id);
  return recoveryCase;
}

describe.skipIf(!hasDb)("operatorActions (integration, requires DATABASE_URL)", () => {
  it("escalateCase moves a non-terminal case to ESCALATED and logs an OPERATOR audit entry", async () => {
    const c = await makeCase({ status: "ACTION_IN_PROGRESS" });

    const updated = await escalateCase(c.id, "judge asked us to skip ahead");
    expect(updated.status).toBe("ESCALATED");
    expect(updated.reason).toContain("judge asked us to skip ahead");

    const logs = await prisma.recoveryAuditLog.findMany({ where: { caseId: c.id } });
    expect(logs.some((l) => l.actor === "OPERATOR")).toBe(true);
  });

  it("escalateCase refuses a case that's already RECOVERED", async () => {
    const c = await makeCase({ status: "RECOVERED" });
    await expect(escalateCase(c.id)).rejects.toThrow(OperatorActionError);
  });

  it("retryCaseNow creates and executes a retry immediately, same as an AI-approved one", async () => {
    const c = await makeCase({ status: "ESCALATED" });
    const provider = fakeProvider();

    const updated = await retryCaseNow(c.id, { provider });
    expect(updated.status).toBe("RECOVERED");
    expect(provider.retryPayment).toHaveBeenCalledTimes(1);

    const logs = await prisma.recoveryAuditLog.findMany({ where: { caseId: c.id } });
    expect(logs.some((l) => l.actor === "OPERATOR" && l.summary.includes("Manual retry"))).toBe(true);
  });

  it("retryCaseNow refuses once MAX_RETRIES_PER_CASE is already reached", async () => {
    const c = await makeCase({ status: "ESCALATED" });
    // Pre-populate two prior RETRY_PAYMENT actions to hit the cap (POLICY_LIMITS.MAX_RETRIES_PER_CASE = 2).
    for (let i = 0; i < 2; i++) {
      await prisma.recoveryAction.create({
        data: {
          caseId: c.id,
          actionType: "RETRY_PAYMENT",
          reason: "prior attempt",
          attemptNumber: i + 1,
          status: "FAILED",
          scheduledFor: new Date(Date.now() - 1000 * 60),
          executedAt: new Date(Date.now() - 1000 * 60),
        },
      });
    }

    await expect(retryCaseNow(c.id, { provider: fakeProvider() })).rejects.toThrow(OperatorActionError);
  });
});
