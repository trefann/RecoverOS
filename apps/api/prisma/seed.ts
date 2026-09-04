import "dotenv/config";
import { PrismaClient, type AuditActor, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * seed.ts is run repeatedly across a dev session (re-seeding after a schema
 * change, demoing a fresh scan, etc). Every other write here is upserted by
 * a stable id for exactly that reason — audit logs need the same treatment,
 * or every re-run silently duplicates a case's history via createMany/create
 * (this bit us once already: Neha's and Priya's seed cases each accumulated
 * 3-4x their real audit trail before this got noticed).
 */
async function upsertAuditLogs(
  logs: Array<{ id: string; caseId: string; actor: AuditActor; summary: string; payload: Prisma.InputJsonValue }>
) {
  for (const log of logs) {
    await prisma.recoveryAuditLog.upsert({ where: { id: log.id }, update: {}, create: log });
  }
}

async function main() {
  console.log("Seeding demo data...");

  // --- Customer with a strong payment history (this is who the live demo
  // webhook should reference — see scripts/simulate-webhook.ts) -------------
  const priya = await prisma.customer.upsert({
    where: { providerCustomerId: "cus_456" },
    update: {},
    create: {
      providerCustomerId: "cus_456",
      name: "Priya Sharma",
      email: "priya.sharma@example.com",
      phone: "+91 98765 43210",
    },
  });

  // 7 of 8 previous payments succeeded, matching the architecture's worked example.
  const priyaPaymentStatuses = ["captured", "captured", "captured", "captured", "captured", "captured", "captured", "failed"];
  for (let i = 0; i < priyaPaymentStatuses.length; i++) {
    await prisma.payment.upsert({
      where: { providerPaymentId: `pay_seed_priya_${i}` },
      update: {},
      create: {
        providerPaymentId: `pay_seed_priya_${i}`,
        customerId: priya.id,
        amount: 5000,
        currency: "INR",
        status: priyaPaymentStatuses[i],
        method: "upi",
        failureReason: priyaPaymentStatuses[i] === "failed" ? "bank_timeout" : null,
      },
    });
  }

  // --- A weaker-history customer, used for the seeded "escalated" example --
  const arjun = await prisma.customer.upsert({
    where: { providerCustomerId: "cus_789" },
    update: {},
    create: {
      providerCustomerId: "cus_789",
      name: "Arjun Mehta",
      email: "arjun.mehta@example.com",
    },
  });
  for (let i = 0; i < 3; i++) {
    await prisma.payment.upsert({
      where: { providerPaymentId: `pay_seed_arjun_${i}` },
      update: {},
      create: {
        providerPaymentId: `pay_seed_arjun_${i}`,
        customerId: arjun.id,
        amount: 50000,
        currency: "INR",
        status: i === 0 ? "captured" : "failed",
        method: "card",
        failureReason: i === 0 ? null : "insufficient_funds",
      },
    });
  }

  // --- A customer for the checkout-abandoned example -----------------------
  const neha = await prisma.customer.upsert({
    where: { providerCustomerId: "cus_321" },
    update: {},
    create: {
      providerCustomerId: "cus_321",
      name: "Neha Kapoor",
      email: "neha.kapoor@example.com",
    },
  });

  // --- A resolved/recovered case so Overview + Analytics aren't all zero ---
  const recoveredPayment = await prisma.payment.upsert({
    where: { providerPaymentId: "pay_seed_recovered" },
    update: {},
    create: {
      providerPaymentId: "pay_seed_recovered",
      customerId: priya.id,
      amount: 3200,
      currency: "INR",
      status: "captured",
      method: "upi",
      failureReason: "bank_timeout",
    },
  });
  const recoveredEvent = await prisma.paymentEvent.upsert({
    where: { providerEventId: "evt_seed_recovered" },
    update: {},
    create: {
      providerEventId: "evt_seed_recovered",
      eventType: "payment.failed",
      paymentId: recoveredPayment.id,
      rawPayload: { seeded: true },
    },
  });
  const recoveredCase = await prisma.recoveryCase.upsert({
    where: { paymentEventId: recoveredEvent.id },
    update: {},
    create: {
      source: "PAYMENT",
      sourceId: recoveredPayment.id,
      paymentEventId: recoveredEvent.id,
      customerId: priya.id,
      amountAtRisk: 3200,
      currency: "INR",
      riskScore: 0.3,
      recoverabilityScore: 0.88,
      priority: "MEDIUM",
      reason: "Temporary failure and high recovery probability",
      recommendedAction: "RETRY_PAYMENT",
      status: "RECOVERED",
    },
  });
  const recoveredAction = await prisma.recoveryAction.upsert({
    where: { id: "seed-action-priya-recovered" },
    update: {},
    create: {
      id: "seed-action-priya-recovered",
      caseId: recoveredCase.id,
      actionType: "RETRY_PAYMENT",
      reason: "Temporary failure and high recovery probability",
      status: "COMPLETED",
      scheduledFor: new Date(Date.now() - 1000 * 60 * 10),
      claimedAt: new Date(Date.now() - 1000 * 60 * 9),
      executedAt: new Date(Date.now() - 1000 * 60 * 9),
      result: { simulated: true, success: true },
    },
  });
  await prisma.recoveryOutcome.upsert({
    where: { id: "seed-outcome-priya-recovered" },
    update: {},
    create: {
      id: "seed-outcome-priya-recovered",
      caseId: recoveredCase.id,
      actionId: recoveredAction.id,
      amountRecovered: 3200,
      success: true,
      recoveredAt: new Date(Date.now() - 1000 * 60 * 9),
    },
  });
  await upsertAuditLogs([
    { id: "seed-audit-priya-recoverability", caseId: recoveredCase.id, actor: "RECOVERABILITY_ENGINE", summary: "Recoverability 88%, priority MEDIUM", payload: { recoverabilityScore: 0.88, riskScore: 0.3 } },
    { id: "seed-audit-priya-investigator", caseId: recoveredCase.id, actor: "INVESTIGATOR_AGENT", summary: "Cause: temporary_payment_failure (confidence 0.94)", payload: { cause: "temporary_payment_failure", confidence: 0.94 } },
    { id: "seed-audit-priya-decision", caseId: recoveredCase.id, actor: "DECISION_AGENT", summary: "Proposed RETRY_PAYMENT (confidence 0.91)", payload: { action: "RETRY_PAYMENT", confidence: 0.91 } },
    { id: "seed-audit-priya-policy", caseId: recoveredCase.id, actor: "POLICY_ENGINE", summary: "Approved", payload: { allowed: true } },
    { id: "seed-audit-priya-action", caseId: recoveredCase.id, actor: "ACTION_ENGINE", summary: "Executed RETRY_PAYMENT: SUCCESS", payload: { outcome: "SUCCESS" } },
    { id: "seed-audit-priya-verifier", caseId: recoveredCase.id, actor: "VERIFIER", summary: "Verification: RECOVERED", payload: { status: "RECOVERED" } },
  ]);

  // --- An escalated high-value invoice, for Queue/Overview variety ---------
  const invoice = await prisma.invoice.upsert({
    where: { id: "seed-invoice-arjun" },
    update: {},
    create: {
      id: "seed-invoice-arjun",
      customerId: arjun.id,
      amount: 50000,
      currency: "INR",
      dueDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5),
      status: "overdue",
    },
  });
  const escalatedCase = await prisma.recoveryCase.upsert({
    where: { id: "seed-case-arjun-invoice" },
    update: {},
    create: {
      id: "seed-case-arjun-invoice",
      source: "INVOICE",
      sourceId: invoice.id,
      customerId: arjun.id,
      amountAtRisk: 50000,
      currency: "INR",
      riskScore: 0.8,
      recoverabilityScore: 0.35,
      priority: "HIGH",
      reason: "High-value invoice overdue; requires human approval",
      recommendedAction: "ESCALATE_HUMAN",
      status: "ESCALATED",
    },
  });
  await upsertAuditLogs([
    { id: "seed-audit-arjun-recoverability", caseId: escalatedCase.id, actor: "RECOVERABILITY_ENGINE", summary: "Recoverability 35%, priority HIGH", payload: { recoverabilityScore: 0.35, riskScore: 0.8 } },
    { id: "seed-audit-arjun-policy", caseId: escalatedCase.id, actor: "POLICY_ENGINE", summary: "Rejected: Amount 50000 meets/exceeds high-value threshold; requires human approval", payload: { allowed: false, escalate: true } },
  ]);

  // --- A medium-priority checkout-abandoned case, action in progress -------
  const abandonedPayment = await prisma.payment.upsert({
    where: { providerPaymentId: "pay_seed_abandoned" },
    update: {},
    create: {
      providerPaymentId: "pay_seed_abandoned",
      customerId: neha.id,
      amount: 4500,
      currency: "INR",
      status: "failed",
      method: "card",
      failureReason: "customer_abandoned",
    },
  });
  const abandonedEvent = await prisma.paymentEvent.upsert({
    where: { providerEventId: "evt_seed_abandoned" },
    update: {},
    create: {
      providerEventId: "evt_seed_abandoned",
      eventType: "payment.failed",
      paymentId: abandonedPayment.id,
      rawPayload: { seeded: true },
    },
  });
  const abandonedCase = await prisma.recoveryCase.upsert({
    where: { paymentEventId: abandonedEvent.id },
    update: {},
    create: {
      source: "PAYMENT",
      sourceId: abandonedPayment.id,
      paymentEventId: abandonedEvent.id,
      customerId: neha.id,
      amountAtRisk: 4500,
      currency: "INR",
      riskScore: 0.5,
      recoverabilityScore: 0.6,
      priority: "MEDIUM",
      reason: "Checkout abandoned; reminder recommended",
      recommendedAction: "SEND_REMINDER",
      status: "ACTION_IN_PROGRESS",
    },
  });
  await prisma.recoveryAction.upsert({
    where: { id: "seed-action-neha-reminder" },
    update: {},
    create: {
      id: "seed-action-neha-reminder",
      caseId: abandonedCase.id,
      actionType: "SEND_REMINDER",
      reason: "Checkout abandoned; reminder recommended",
      status: "COMPLETED",
      scheduledFor: new Date(Date.now() - 1000 * 60 * 30),
      claimedAt: new Date(Date.now() - 1000 * 60 * 29),
      executedAt: new Date(Date.now() - 1000 * 60 * 29),
      result: { sent: true, channel: "email" },
    },
  });
  await upsertAuditLogs([
    { id: "seed-audit-neha-recoverability", caseId: abandonedCase.id, actor: "RECOVERABILITY_ENGINE", summary: "Recoverability 60%, priority MEDIUM", payload: { recoverabilityScore: 0.6, riskScore: 0.5 } },
    { id: "seed-audit-neha-investigator", caseId: abandonedCase.id, actor: "INVESTIGATOR_AGENT", summary: "Cause: customer_abandoned (confidence 0.72)", payload: { cause: "customer_abandoned", confidence: 0.72 } },
    { id: "seed-audit-neha-decision", caseId: abandonedCase.id, actor: "DECISION_AGENT", summary: "Proposed SEND_REMINDER (confidence 0.8)", payload: { action: "SEND_REMINDER", confidence: 0.8 } },
    { id: "seed-audit-neha-policy", caseId: abandonedCase.id, actor: "POLICY_ENGINE", summary: "Approved", payload: { allowed: true } },
    { id: "seed-audit-neha-action", caseId: abandonedCase.id, actor: "ACTION_ENGINE", summary: "Executed SEND_REMINDER: SUCCESS", payload: { outcome: "SUCCESS" } },
  ]);

  // --- A failing subscription, left un-cased on purpose --------------------
  // Unlike every case above, this one has no recovery_case yet: it's here to
  // demonstrate the detection *scan* (POST /detection/scan, or the next
  // scheduler tick) actually finding it and running the full pipeline live,
  // rather than everything on the dashboard being pre-baked fixture data.
  const karan = await prisma.customer.upsert({
    where: { providerCustomerId: "cus_654" },
    update: {},
    create: {
      providerCustomerId: "cus_654",
      name: "Karan Malhotra",
      email: "karan.malhotra@example.com",
    },
  });
  await prisma.subscription.upsert({
    where: { id: "seed-sub-karan" },
    update: {},
    create: {
      id: "seed-sub-karan",
      customerId: karan.id,
      amount: 1200,
      currency: "INR",
      status: "past_due",
      nextPaymentAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2),
      failedAttempts: 2,
    },
  });

  console.log("Seed complete.");
  console.log(`Live-demo customer: providerCustomerId=cus_456 (Priya Sharma), 7/8 prior payments succeeded.`);
  console.log(`Run "npm run demo:webhook --workspace apps/api" to fire the golden-path payment.failed event.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
