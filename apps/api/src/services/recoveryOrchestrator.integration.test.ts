import { describe, it, expect, vi, afterEach } from "vitest";
import type { InvestigationResult, DecisionProposal } from "@recoveros/shared";
import { prisma } from "../db/prisma.js";
import { processPaymentFailedWebhook } from "./recoveryOrchestrator.js";
import { claimAndExecuteAction } from "./actionExecutor.js";
import type { PaymentProvider } from "../integrations/payments/PaymentProvider.js";

/**
 * These exercise the real Postgres-backed guarantees (unique constraint
 * idempotency, atomic scheduler claim) that can't be faked with a mocked
 * Prisma client. They require a real DATABASE_URL and are skipped
 * otherwise — see README "Running tests" for how to point this at a local
 * or hosted (Neon/Supabase) Postgres instance.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

function fakeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    retryPayment: vi.fn().mockResolvedValue({ success: true, providerPaymentId: "pay_1", amountCaptured: 5000 }),
    sendReminder: vi.fn().mockResolvedValue({ sent: true, channel: "email" }),
    ...overrides,
  };
}

const goodInvestigation: InvestigationResult = {
  cause: "temporary_payment_failure",
  confidence: 0.94,
  evidence: ["Bank timeout", "7 of 8 previous payments succeeded"],
  recovery_probability: 0.83,
};

function fakeCallStructured(decision: DecisionProposal) {
  return vi.fn().mockImplementation(async ({ toolName }: { toolName: string }) => {
    if (toolName === "report_investigation") return goodInvestigation;
    if (toolName === "propose_recovery_action") return decision;
    throw new Error(`unexpected tool ${toolName}`);
  });
}

const createdCustomerIds: string[] = [];
const createdCaseIds: string[] = [];

afterEach(async () => {
  if (!hasDb) return;
  for (const caseId of createdCaseIds.splice(0)) {
    await prisma.recoveryOutcome.deleteMany({ where: { caseId } });
    await prisma.recoveryAuditLog.deleteMany({ where: { caseId } });
    await prisma.recoveryAction.deleteMany({ where: { caseId } });
    const c = await prisma.recoveryCase.findUnique({ where: { id: caseId } });
    await prisma.recoveryCase.deleteMany({ where: { id: caseId } });
    if (c?.paymentEventId) {
      const evt = await prisma.paymentEvent.findUnique({ where: { id: c.paymentEventId } });
      await prisma.paymentEvent.deleteMany({ where: { id: c.paymentEventId } });
      if (evt) await prisma.payment.deleteMany({ where: { id: evt.paymentId } });
    }
  }
  for (const customerId of createdCustomerIds.splice(0)) {
    const payments = await prisma.payment.findMany({ where: { customerId }, select: { id: true } });
    const paymentIds = payments.map((p) => p.id);
    if (paymentIds.length > 0) {
      await prisma.paymentEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
    }
    await prisma.payment.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
  }
});

describe.skipIf(!hasDb)("recoveryOrchestrator (integration, requires DATABASE_URL)", () => {
  it("TEST 1 — the same webhook processed twice never creates a duplicate case", async () => {
    const provider = fakeProvider();
    const decision: DecisionProposal = {
      action: "RETRY_PAYMENT",
      delay_minutes: 0,
      max_attempts: 1,
      confidence: 0.91,
      reason: "Temporary failure and high recovery probability",
    };
    const callStructured = fakeCallStructured(decision);
    const providerEventId = `evt_test1_${Date.now()}`;

    const event = {
      event_type: "payment.failed" as const,
      provider_event_id: providerEventId,
      payment_id: `pay_test1_${Date.now()}`,
      customer_id: `cus_test1_${Date.now()}`,
      amount: 5000,
      currency: "INR",
      method: "upi",
      failure_reason: "bank_timeout",
    };

    const first = await processPaymentFailedWebhook(event, { provider, callStructured });
    createdCaseIds.push(first.case.id);
    createdCustomerIds.push(first.case.customerId);

    const second = await processPaymentFailedWebhook(event, { provider, callStructured });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.case.id).toBe(first.case.id);

    const caseCount = await prisma.recoveryCase.count({ where: { id: first.case.id } });
    const eventCount = await prisma.paymentEvent.count({ where: { providerEventId } });
    expect(caseCount).toBe(1);
    expect(eventCount).toBe(1);

    // Only the first call should have driven the pipeline through to a retry.
    expect(provider.retryPayment).toHaveBeenCalledTimes(1);
  });

  it("TEST 2 — two concurrent scheduler claims on the same action execute it exactly once", async () => {
    const provider = fakeProvider();

    const customer = await prisma.customer.create({
      data: { providerCustomerId: `cus_test2_${Date.now()}`, name: "Test2", email: "test2@example.com" },
    });
    createdCustomerIds.push(customer.id);

    const payment = await prisma.payment.create({
      data: {
        providerPaymentId: `pay_test2_${Date.now()}`,
        customerId: customer.id,
        amount: 1000,
        currency: "INR",
        status: "failed",
        method: "upi",
        failureReason: "bank_timeout",
      },
    });

    const event = await prisma.paymentEvent.create({
      data: {
        providerEventId: `evt_test2_${Date.now()}`,
        eventType: "payment.failed",
        paymentId: payment.id,
        rawPayload: {},
      },
    });

    const recoveryCase = await prisma.recoveryCase.create({
      data: {
        source: "PAYMENT",
        sourceId: payment.id,
        paymentEventId: event.id,
        customerId: customer.id,
        amountAtRisk: 1000,
        currency: "INR",
        riskScore: 0.3,
        recoverabilityScore: 0.8,
        priority: "LOW",
        status: "ACTION_SCHEDULED",
      },
    });
    createdCaseIds.push(recoveryCase.id);

    const action = await prisma.recoveryAction.create({
      data: {
        caseId: recoveryCase.id,
        actionType: "RETRY_PAYMENT",
        reason: "test",
        status: "PENDING",
        scheduledFor: new Date(Date.now() - 1000),
      },
    });

    const [won1, won2] = await Promise.all([
      claimAndExecuteAction(action.id, provider),
      claimAndExecuteAction(action.id, provider),
    ]);

    // Exactly one of the two concurrent attempts should have won the claim.
    expect([won1, won2].filter(Boolean)).toHaveLength(1);
    expect(provider.retryPayment).toHaveBeenCalledTimes(1);

    const finalAction = await prisma.recoveryAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(finalAction.status).toBe("COMPLETED");
  });

  it("TEST 4 — policy rejection on a high-value case means actionEngine is never invoked", async () => {
    const provider = fakeProvider();
    const decision: DecisionProposal = {
      action: "RETRY_PAYMENT",
      delay_minutes: 0,
      max_attempts: 1,
      confidence: 0.9,
      reason: "Looks retryable",
    };
    const callStructured = fakeCallStructured(decision);

    const event = {
      event_type: "payment.failed" as const,
      provider_event_id: `evt_test4_${Date.now()}`,
      payment_id: `pay_test4_${Date.now()}`,
      customer_id: `cus_test4_${Date.now()}`,
      amount: 50000, // >= HIGH_VALUE_THRESHOLD -> policy must reject regardless of AI confidence
      currency: "INR",
      method: "card",
      failure_reason: "bank_timeout",
    };

    const result = await processPaymentFailedWebhook(event, { provider, callStructured });
    createdCaseIds.push(result.case.id);
    createdCustomerIds.push(result.case.customerId);

    expect(result.case.status).toBe("ESCALATED");
    expect(provider.retryPayment).not.toHaveBeenCalled();

    const actionCount = await prisma.recoveryAction.count({ where: { caseId: result.case.id } });
    expect(actionCount).toBe(0);
  });

  it("TEST 5 — the golden path: webhook to RECOVERED with a matching outcome row", async () => {
    const provider = fakeProvider();
    const decision: DecisionProposal = {
      action: "RETRY_PAYMENT",
      delay_minutes: 0,
      max_attempts: 1,
      confidence: 0.91,
      reason: "Temporary failure and high recovery probability",
    };
    const callStructured = fakeCallStructured(decision);

    const event = {
      event_type: "payment.failed" as const,
      provider_event_id: `evt_test5_${Date.now()}`,
      payment_id: `pay_test5_${Date.now()}`,
      customer_id: `cus_test5_${Date.now()}`,
      amount: 5000,
      currency: "INR",
      method: "upi",
      failure_reason: "bank_timeout",
    };

    const result = await processPaymentFailedWebhook(event, { provider, callStructured });
    createdCaseIds.push(result.case.id);
    createdCustomerIds.push(result.case.customerId);

    expect(result.case.status).toBe("RECOVERED");

    const outcome = await prisma.recoveryOutcome.findFirst({ where: { caseId: result.case.id } });
    expect(outcome?.success).toBe(true);
    expect(Number(outcome?.amountRecovered)).toBe(5000);

    const auditActors = (await prisma.recoveryAuditLog.findMany({ where: { caseId: result.case.id } })).map(
      (l) => l.actor
    );
    expect(auditActors).toEqual(
      expect.arrayContaining([
        "RECOVERABILITY_ENGINE",
        "INVESTIGATOR_AGENT",
        "DECISION_AGENT",
        "POLICY_ENGINE",
        "ACTION_ENGINE",
        "VERIFIER",
      ])
    );
  });
});
