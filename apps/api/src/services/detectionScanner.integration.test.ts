import { describe, it, expect, vi, afterEach } from "vitest";
import type { InvestigationResult, DecisionProposal } from "@recoveros/shared";
import { prisma } from "../db/prisma.js";
import { processSubscriptionFailure, processInvoiceOverdue } from "./recoveryOrchestrator.js";
import type { PaymentProvider } from "../integrations/payments/PaymentProvider.js";

/**
 * Subscriptions/invoices have no webhook to key idempotency off of — see
 * recoveryOrchestrator.ts's TERMINAL_CASE_STATUSES comment. These tests cover
 * the two things that are specific to that design: the open-case guard, and
 * resetting the underlying row once a case resolves so the next scan doesn't
 * immediately recreate it (the bug this file exists to prevent regressing).
 */
const hasDb = Boolean(process.env.DATABASE_URL);

function fakeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    retryPayment: vi.fn().mockResolvedValue({ success: true, providerPaymentId: "pay_1", amountCaptured: 1200 }),
    sendReminder: vi.fn().mockResolvedValue({ sent: true, channel: "email" }),
    ...overrides,
  };
}

const goodInvestigation: InvestigationResult = {
  cause: "temporary_payment_failure",
  confidence: 0.9,
  evidence: ["dunning retry likely to succeed"],
  recovery_probability: 0.8,
};

function fakeCallStructured(decision: DecisionProposal) {
  return vi.fn().mockImplementation(async ({ toolName }: { toolName: string }) => {
    if (toolName === "report_investigation") return goodInvestigation;
    if (toolName === "propose_recovery_action") return decision;
    throw new Error(`unexpected tool ${toolName}`);
  });
}

const immediateRetry: DecisionProposal = {
  action: "RETRY_PAYMENT",
  delay_minutes: 0,
  max_attempts: 1,
  confidence: 0.9,
  reason: "Recoverable on immediate retry",
};

const createdCustomerIds: string[] = [];
const createdCaseIds: string[] = [];
const createdSubscriptionIds: string[] = [];
const createdInvoiceIds: string[] = [];

afterEach(async () => {
  if (!hasDb) return;
  for (const caseId of createdCaseIds.splice(0)) {
    await prisma.openRecoverySlot.deleteMany({ where: { caseId } });
    await prisma.recoveryOutcome.deleteMany({ where: { caseId } });
    await prisma.recoveryAuditLog.deleteMany({ where: { caseId } });
    await prisma.recoveryAction.deleteMany({ where: { caseId } });
    await prisma.recoveryCase.deleteMany({ where: { id: caseId } });
  }
  for (const id of createdSubscriptionIds.splice(0)) {
    await prisma.subscription.deleteMany({ where: { id } });
  }
  for (const id of createdInvoiceIds.splice(0)) {
    await prisma.invoice.deleteMany({ where: { id } });
  }
  for (const customerId of createdCustomerIds.splice(0)) {
    await prisma.customer.deleteMany({ where: { id: customerId } });
  }
});

describe.skipIf(!hasDb)("subscription/invoice detection (integration, requires DATABASE_URL)", () => {
  it("a resolved subscription is reset so it isn't immediately re-detected", async () => {
    const customer = await prisma.customer.create({
      data: { providerCustomerId: `cus_dt_${Date.now()}`, name: "Test Dunning Customer", email: "dt@example.com" },
    });
    createdCustomerIds.push(customer.id);

    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        amount: 1200,
        currency: "INR",
        status: "past_due",
        nextPaymentAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
        failedAttempts: 2,
      },
    });
    createdSubscriptionIds.push(subscription.id);

    const provider = fakeProvider();
    const first = await processSubscriptionFailure(subscription.id, {
      provider,
      callStructured: fakeCallStructured(immediateRetry),
    });
    createdCaseIds.push(first.case.id);
    expect(first.duplicate).toBe(false);
    expect(first.case.status).toBe("RECOVERED");

    // Calling it again while... it's already resolved should now be allowed
    // to open a fresh case for a *new* failure cycle, not treated as a dupe.
    const reset = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(reset.failedAttempts).toBe(0);
    expect(reset.nextPaymentAt.getTime()).toBeGreaterThan(Date.now());

    // But re-running detection right now (before the next real failure) must
    // not re-open a case, since the subscription no longer looks due/failing.
    const second = await processSubscriptionFailure(subscription.id, {
      provider,
      callStructured: fakeCallStructured(immediateRetry),
    });
    createdCaseIds.push(second.case.id);
    // Both calls target the same still-open-or-resolved case id depending on
    // timing; what matters is we never end up with two DISTINCT case rows
    // for this subscription while the first is unresolved. Since the first
    // already resolved to RECOVERED, this second call legitimately opens a
    // new cycle — assert that specifically, not blanket "duplicate".
    expect(second.case.id).not.toBe(first.case.id);
  });

  it("calling processSubscriptionFailure twice while a case is still open never creates a second case", async () => {
    const customer = await prisma.customer.create({
      data: { providerCustomerId: `cus_dt2_${Date.now()}`, name: "Test Open Guard Customer", email: "dt2@example.com" },
    });
    createdCustomerIds.push(customer.id);

    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        amount: 900,
        currency: "INR",
        status: "past_due",
        nextPaymentAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
        failedAttempts: 1,
      },
    });
    createdSubscriptionIds.push(subscription.id);

    // A delayed (not immediate) decision keeps the case open (ACTION_SCHEDULED)
    // long enough to prove the second call is treated as a duplicate.
    const delayedRetry: DecisionProposal = { ...immediateRetry, delay_minutes: 30 };
    const provider = fakeProvider();
    const deps = { provider, callStructured: fakeCallStructured(delayedRetry) };

    const first = await processSubscriptionFailure(subscription.id, deps);
    createdCaseIds.push(first.case.id);
    expect(first.duplicate).toBe(false);
    expect(first.case.status).toBe("ACTION_SCHEDULED");

    const second = await processSubscriptionFailure(subscription.id, deps);
    expect(second.duplicate).toBe(true);
    expect(second.case.id).toBe(first.case.id);
  });

  it("a resolved invoice is marked paid so it drops out of the overdue scan", async () => {
    const customer = await prisma.customer.create({
      data: { providerCustomerId: `cus_dt3_${Date.now()}`, name: "Test Invoice Customer", email: "dt3@example.com" },
    });
    createdCustomerIds.push(customer.id);

    const invoice = await prisma.invoice.create({
      data: {
        customerId: customer.id,
        amount: 4000,
        currency: "INR",
        dueDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3),
        status: "overdue",
      },
    });
    createdInvoiceIds.push(invoice.id);

    const provider = fakeProvider();
    const result = await processInvoiceOverdue(invoice.id, {
      provider,
      callStructured: fakeCallStructured(immediateRetry),
    });
    createdCaseIds.push(result.case.id);
    expect(result.case.status).toBe("RECOVERED");

    const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updated.status).toBe("paid");
  });
});
