import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "../db/prisma.js";
import { computeLearningInsights, successRateForCause, successRateForPriority } from "./learningInsights.js";

const hasDb = Boolean(process.env.DATABASE_URL);

const createdCaseIds: string[] = [];
const createdCustomerIds: string[] = [];

afterEach(async () => {
  if (!hasDb) return;
  for (const caseId of createdCaseIds.splice(0)) {
    await prisma.recoveryCase.deleteMany({ where: { id: caseId } });
  }
  for (const customerId of createdCustomerIds.splice(0)) {
    await prisma.customer.deleteMany({ where: { id: customerId } });
  }
});

async function makeResolvedCase(opts: {
  cause: string;
  action: "RETRY_PAYMENT" | "SEND_REMINDER";
  priority: "LOW" | "MEDIUM" | "HIGH";
  recovered: boolean;
}) {
  const customer = await prisma.customer.create({
    data: { providerCustomerId: `cus_li_${Date.now()}_${Math.random()}`, name: "Insights Test Customer", email: "li@example.com" },
  });
  createdCustomerIds.push(customer.id);

  const c = await prisma.recoveryCase.create({
    data: {
      source: "PAYMENT",
      sourceId: `src_${Date.now()}_${Math.random()}`,
      customerId: customer.id,
      amountAtRisk: 1000,
      currency: "INR",
      riskScore: 0.5,
      recoverabilityScore: 0.5,
      priority: opts.priority,
      investigatedCause: opts.cause,
      recommendedAction: opts.action,
      status: opts.recovered ? "RECOVERED" : "ESCALATED",
    },
  });
  createdCaseIds.push(c.id);
  return c;
}

describe.skipIf(!hasDb)("learningInsights (integration, requires DATABASE_URL)", () => {
  it("computes success rate by cause, action, and priority from resolved cases only", async () => {
    const cause = `test_cause_${Date.now()}`;
    await makeResolvedCase({ cause, action: "RETRY_PAYMENT", priority: "HIGH", recovered: true });
    await makeResolvedCase({ cause, action: "RETRY_PAYMENT", priority: "HIGH", recovered: true });
    await makeResolvedCase({ cause, action: "RETRY_PAYMENT", priority: "HIGH", recovered: false });

    const causeBucket = await successRateForCause(cause);
    expect(causeBucket).not.toBeNull();
    expect(causeBucket?.attempts).toBe(3);
    expect(causeBucket?.recovered).toBe(2);
    expect(causeBucket?.successRatePct).toBeCloseTo(66.7, 1);

    const priorityBucket = await successRateForPriority("HIGH");
    expect(priorityBucket).not.toBeNull();
    expect(priorityBucket!.attempts).toBeGreaterThanOrEqual(3);

    const insights = await computeLearningInsights();
    const foundCause = insights.byCause.find((b) => b.key === cause);
    expect(foundCause?.attempts).toBe(3);
    const foundAction = insights.byAction.find((b) => b.key === "RETRY_PAYMENT");
    expect(foundAction).toBeTruthy();
  });

  it("returns null for a cause with no resolved history yet", async () => {
    const bucket = await successRateForCause(`never_seen_cause_${Date.now()}`);
    expect(bucket).toBeNull();
  });

  it("excludes still-open (unresolved) cases from the aggregation", async () => {
    const cause = `open_cause_${Date.now()}`;
    const customer = await prisma.customer.create({
      data: { providerCustomerId: `cus_li2_${Date.now()}`, name: "Open Case Customer", email: "li2@example.com" },
    });
    createdCustomerIds.push(customer.id);
    const openCase = await prisma.recoveryCase.create({
      data: {
        source: "PAYMENT",
        sourceId: `src_open_${Date.now()}`,
        customerId: customer.id,
        amountAtRisk: 1000,
        currency: "INR",
        riskScore: 0.5,
        recoverabilityScore: 0.5,
        priority: "MEDIUM",
        investigatedCause: cause,
        status: "ACTION_SCHEDULED",
      },
    });
    createdCaseIds.push(openCase.id);

    const bucket = await successRateForCause(cause);
    expect(bucket).toBeNull();
  });
});
