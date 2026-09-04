import type { RecoveryCase } from "@prisma/client";
import { type PaymentWebhookEvent, type SourceType } from "@recoveros/shared";
import { prisma } from "../db/prisma.js";
import { isUniqueConstraintViolation } from "../db/prismaErrors.js";
import { evaluateRecoverability, type CustomerPaymentHistory } from "./recoverabilityEngine.js";
import { investigate, type CallStructuredFn } from "./investigatorAgent.js";
import { decide } from "./decisionAgent.js";
import { evaluatePolicy } from "./policyEngine.js";
import { successRateForCause, successRateForPriority } from "./learningInsights.js";
import { claimAndExecuteAction } from "./actionExecutor.js";
import { logAudit } from "./auditLog.js";
import { getDefaultProvider } from "../integrations/payments/defaultProvider.js";
import type { PaymentProvider } from "../integrations/payments/PaymentProvider.js";

export interface OrchestratorDeps {
  provider?: PaymentProvider;
  callStructured?: CallStructuredFn;
}

export interface WebhookProcessingResult {
  duplicate: boolean;
  case: RecoveryCase;
}

async function computeCustomerHistory(customerId: string): Promise<CustomerPaymentHistory> {
  const [totalPayments, successfulPayments, previousRecoveryAttempts] = await Promise.all([
    prisma.payment.count({ where: { customerId } }),
    prisma.payment.count({ where: { customerId, status: "captured" } }),
    prisma.recoveryCase.count({ where: { customerId } }),
  ]);
  return { totalPayments, successfulPayments, previousRecoveryAttempts };
}

/**
 * Owns the entire recovery workflow end to end:
 *
 *   webhook/event -> recoverabilityEngine -> investigatorAgent -> decisionAgent
 *     -> policyEngine -> actionEngine -> verifier
 *
 * This is the ONLY place that chains these services together. Route
 * handlers (routes/webhooks.ts) call processPaymentFailedWebhook and
 * translate the result to an HTTP response — they contain no business logic
 * of their own. Each service still owns its own internal logic; this file
 * only sequences calls and persists results between steps.
 */
export async function processPaymentFailedWebhook(
  event: PaymentWebhookEvent,
  deps: OrchestratorDeps = {}
): Promise<WebhookProcessingResult> {
  const provider = deps.provider ?? getDefaultProvider();

  // --- CHANGE 2: idempotency ---------------------------------------------
  // Fast path: if we've already recorded this provider_event_id, don't touch
  // anything else. This check alone is a race condition under concurrent
  // requests, which is why the real guarantee is the unique constraint catch
  // below, not this early return.
  const existing = await prisma.paymentEvent.findUnique({
    where: { providerEventId: event.provider_event_id },
    include: { recoveryCase: true },
  });
  if (existing) {
    if (!existing.recoveryCase) {
      throw new Error(
        `Data integrity issue: payment_event ${existing.id} has no associated recovery_case`
      );
    }
    return { duplicate: true, case: existing.recoveryCase };
  }

  const customer = await prisma.customer.upsert({
    where: { providerCustomerId: event.customer_id },
    update: {
      ...(event.customer_name ? { name: event.customer_name } : {}),
      ...(event.customer_email ? { email: event.customer_email } : {}),
    },
    create: {
      providerCustomerId: event.customer_id,
      // Most real webhooks only carry a customer id; fall back to a
      // placeholder profile rather than failing ingestion when this is the
      // first time we've seen this customer with no enriched name/email.
      name: event.customer_name ?? `Customer ${event.customer_id}`,
      email: event.customer_email ?? `${event.customer_id}@unknown.recoveros.local`,
    },
  });

  const payment = await prisma.payment.upsert({
    where: { providerPaymentId: event.payment_id },
    update: { status: "failed", failureReason: event.failure_reason },
    create: {
      providerPaymentId: event.payment_id,
      customerId: customer.id,
      amount: event.amount,
      currency: event.currency,
      status: "failed",
      method: event.method,
      failureReason: event.failure_reason,
    },
  });

  let paymentEventId: string;
  try {
    const paymentEvent = await prisma.paymentEvent.create({
      data: {
        providerEventId: event.provider_event_id,
        eventType: event.event_type,
        paymentId: payment.id,
        rawPayload: event as unknown as object,
      },
    });
    paymentEventId = paymentEvent.id;
  } catch (error) {
    // The database's UNIQUE constraint on provider_event_id is the final
    // protection against duplicates — this branch handles the race where two
    // requests both passed the findUnique check above.
    if (isUniqueConstraintViolation(error, "providerEventId")) {
      const raceWinner = await prisma.paymentEvent.findUniqueOrThrow({
        where: { providerEventId: event.provider_event_id },
        include: { recoveryCase: true },
      });
      if (!raceWinner.recoveryCase) {
        throw new Error(
          `Data integrity issue: payment_event ${raceWinner.id} has no associated recovery_case`
        );
      }
      return { duplicate: true, case: raceWinner.recoveryCase };
    }
    throw error;
  }

  // --- Detect ---------------------------------------------------------------
  const history = await computeCustomerHistory(customer.id);
  const amount = Number(payment.amount);
  const recoverability = evaluateRecoverability({
    sourceType: "PAYMENT",
    amount,
    failureReason: event.failure_reason,
    history,
  });

  const recoveryCase = await prisma.recoveryCase.create({
    data: {
      source: "PAYMENT",
      sourceId: payment.id,
      paymentEventId,
      customerId: customer.id,
      amountAtRisk: amount,
      currency: payment.currency,
      riskScore: recoverability.riskScore,
      recoverabilityScore: recoverability.recoverabilityScore,
      priority: recoverability.priority,
      status: "DETECTED",
    },
  });

  await logAudit({
    caseId: recoveryCase.id,
    actor: "RECOVERABILITY_ENGINE",
    summary: `Recoverability ${(recoverability.recoverabilityScore * 100).toFixed(0)}%, priority ${recoverability.priority}`,
    payload: recoverability,
  });

  const finalCase = await runPipelineAfterDetection({
    caseId: recoveryCase.id,
    amount,
    currency: payment.currency,
    method: payment.method,
    failureReason: event.failure_reason,
    customerName: customer.name,
    history,
    recoverability,
    provider,
    callStructured: deps.callStructured,
  });

  return { duplicate: false, case: finalCase };
}

/** Case statuses that mean a source is fully resolved and eligible for re-detection on its next cycle. */
const TERMINAL_CASE_STATUSES = ["RECOVERED", "FAILED", "POLICY_REJECTED"] as const;

/**
 * Subscriptions and invoices have no webhook to arrive on — they're found by
 * periodically scanning the table (see detectionScanner.ts) rather than
 * reacting to an event. Both funnel into the exact same
 * runPipelineAfterDetection used by the payment path; only case creation
 * differs, since subscriptions/invoices don't carry a payment_event to key
 * idempotency off of. Idempotency here instead means "don't open a second
 * case for the same subscription/invoice while one is still open" — a fresh
 * failure cycle after a prior case resolves is allowed to open a new one.
 */
/**
 * Creates the case and its OpenRecoverySlot marker in one transaction. The
 * fast-path `existing` check above each caller is only an optimization to
 * skip unnecessary recoverability/LLM work — this is the actual guarantee:
 * the slot's unique (source, sourceId) constraint means at most one process
 * can win this insert for a given subscription/invoice, so a second process
 * racing the same detection window (e.g. two overlapping scheduler ticks)
 * gets a constraint violation here instead of silently creating a duplicate.
 * Mirrors how payment_events.providerEventId backstops the payment webhook.
 */
async function createOpenCase(input: {
  source: Extract<SourceType, "SUBSCRIPTION" | "INVOICE">;
  sourceId: string;
  customerId: string;
  amountAtRisk: number;
  currency: string;
  recoverability: ReturnType<typeof evaluateRecoverability>;
}): Promise<{ duplicate: false; case: RecoveryCase } | { duplicate: true; case: RecoveryCase }> {
  try {
    const recoveryCase = await prisma.$transaction(async (tx) => {
      const created = await tx.recoveryCase.create({
        data: {
          source: input.source,
          sourceId: input.sourceId,
          customerId: input.customerId,
          amountAtRisk: input.amountAtRisk,
          currency: input.currency,
          riskScore: input.recoverability.riskScore,
          recoverabilityScore: input.recoverability.recoverabilityScore,
          priority: input.recoverability.priority,
          status: "DETECTED",
        },
      });
      await tx.openRecoverySlot.create({
        data: { source: input.source, sourceId: input.sourceId, caseId: created.id },
      });
      return created;
    });
    return { duplicate: false, case: recoveryCase };
  } catch (error) {
    if (isUniqueConstraintViolation(error, "sourceId")) {
      const slot = await prisma.openRecoverySlot.findUniqueOrThrow({
        where: { source_sourceId: { source: input.source, sourceId: input.sourceId } },
        include: { case: true },
      });
      return { duplicate: true, case: slot.case };
    }
    throw error;
  }
}

export async function processSubscriptionFailure(
  subscriptionId: string,
  deps: OrchestratorDeps = {}
): Promise<WebhookProcessingResult> {
  const provider = deps.provider ?? getDefaultProvider();

  const existing = await prisma.recoveryCase.findFirst({
    where: {
      source: "SUBSCRIPTION",
      sourceId: subscriptionId,
      status: { notIn: [...TERMINAL_CASE_STATUSES] },
    },
  });
  if (existing) {
    return { duplicate: true, case: existing };
  }

  const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: subscription.customerId } });

  const amount = Number(subscription.amount);
  const failureReason = `${subscription.failedAttempts} consecutive failed renewal attempt(s)`;
  const history = await computeCustomerHistory(customer.id);
  const recoverability = evaluateRecoverability({
    sourceType: "SUBSCRIPTION",
    amount,
    failureReason,
    history,
  });

  const opened = await createOpenCase({
    source: "SUBSCRIPTION",
    sourceId: subscription.id,
    customerId: customer.id,
    amountAtRisk: amount,
    currency: subscription.currency,
    recoverability,
  });
  if (opened.duplicate) {
    return opened;
  }
  const recoveryCase = opened.case;

  await logAudit({
    caseId: recoveryCase.id,
    actor: "RECOVERABILITY_ENGINE",
    summary: `Recoverability ${(recoverability.recoverabilityScore * 100).toFixed(0)}%, priority ${recoverability.priority}`,
    payload: recoverability,
  });

  const finalCase = await runPipelineAfterDetection({
    caseId: recoveryCase.id,
    amount,
    currency: subscription.currency,
    method: "subscription_renewal",
    failureReason,
    customerName: customer.name,
    history,
    recoverability,
    provider,
    callStructured: deps.callStructured,
  });

  return { duplicate: false, case: finalCase };
}

export async function processInvoiceOverdue(
  invoiceId: string,
  deps: OrchestratorDeps = {}
): Promise<WebhookProcessingResult> {
  const provider = deps.provider ?? getDefaultProvider();

  const existing = await prisma.recoveryCase.findFirst({
    where: {
      source: "INVOICE",
      sourceId: invoiceId,
      status: { notIn: [...TERMINAL_CASE_STATUSES] },
    },
  });
  if (existing) {
    return { duplicate: true, case: existing };
  }

  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: invoice.customerId } });

  const amount = Number(invoice.amount);
  const daysOverdue = Math.max(1, Math.floor((Date.now() - invoice.dueDate.getTime()) / (1000 * 60 * 60 * 24)));
  const failureReason = `Invoice overdue by ${daysOverdue} day(s)`;
  const history = await computeCustomerHistory(customer.id);
  const recoverability = evaluateRecoverability({
    sourceType: "INVOICE",
    amount,
    failureReason,
    history,
  });

  const opened = await createOpenCase({
    source: "INVOICE",
    sourceId: invoice.id,
    customerId: customer.id,
    amountAtRisk: amount,
    currency: invoice.currency,
    recoverability,
  });
  if (opened.duplicate) {
    return opened;
  }
  const recoveryCase = opened.case;

  await logAudit({
    caseId: recoveryCase.id,
    actor: "RECOVERABILITY_ENGINE",
    summary: `Recoverability ${(recoverability.recoverabilityScore * 100).toFixed(0)}%, priority ${recoverability.priority}`,
    payload: recoverability,
  });

  const finalCase = await runPipelineAfterDetection({
    caseId: recoveryCase.id,
    amount,
    currency: invoice.currency,
    method: "invoice",
    failureReason,
    customerName: customer.name,
    history,
    recoverability,
    provider,
    callStructured: deps.callStructured,
  });

  return { duplicate: false, case: finalCase };
}

interface PipelineContext {
  caseId: string;
  amount: number;
  currency: string;
  method: string;
  failureReason: string | null;
  customerName: string;
  history: CustomerPaymentHistory;
  recoverability: ReturnType<typeof evaluateRecoverability>;
  provider: PaymentProvider;
  callStructured?: CallStructuredFn;
}

async function runPipelineAfterDetection(ctx: PipelineContext): Promise<RecoveryCase> {
  await prisma.recoveryCase.update({ where: { id: ctx.caseId }, data: { status: "INVESTIGATING" } });

  // --- Investigate (AI, structured output only) ----------------------------
  // LEARN: hand the investigator real historical outcomes for this priority
  // tier, computed from every past resolved case — see learningInsights.ts.
  const priorityHistory = await successRateForPriority(ctx.recoverability.priority);

  let investigation;
  try {
    investigation = await investigate(
      {
        amount: ctx.amount,
        currency: ctx.currency,
        method: ctx.method,
        failureReason: ctx.failureReason,
        customerName: ctx.customerName,
        totalPayments: ctx.history.totalPayments,
        successfulPayments: ctx.history.successfulPayments,
        previousRecoveryAttempts: ctx.history.previousRecoveryAttempts,
        recoverability: ctx.recoverability,
        priorityHistory,
      },
      { callStructured: ctx.callStructured }
    );
  } catch (error) {
    return escalateForAiFailure(ctx.caseId, "investigatorAgent", error);
  }

  await logAudit({
    caseId: ctx.caseId,
    actor: "INVESTIGATOR_AGENT",
    summary: `Cause: ${investigation.cause} (confidence ${investigation.confidence.toFixed(2)})`,
    payload: investigation,
  });

  // --- Decide (AI, structured output only) ----------------------------------
  const retryAttemptsSoFar = await prisma.recoveryAction.count({
    where: { caseId: ctx.caseId, actionType: "RETRY_PAYMENT" },
  });

  // LEARN: hand the decision agent real historical outcomes for this exact
  // diagnosed cause, computed from every past resolved case.
  const causeHistory = await successRateForCause(investigation.cause);

  let proposal;
  try {
    proposal = await decide(
      {
        amount: ctx.amount,
        currency: ctx.currency,
        priority: ctx.recoverability.priority,
        investigation,
        attemptsSoFar: retryAttemptsSoFar,
        causeHistory,
      },
      { callStructured: ctx.callStructured }
    );
  } catch (error) {
    return escalateForAiFailure(ctx.caseId, "decisionAgent", error);
  }

  await logAudit({
    caseId: ctx.caseId,
    actor: "DECISION_AGENT",
    summary: `Proposed ${proposal.action} (confidence ${proposal.confidence.toFixed(2)})`,
    payload: proposal,
  });

  await prisma.recoveryCase.update({
    where: { id: ctx.caseId },
    data: {
      status: "DECIDED",
      recommendedAction: proposal.action,
      reason: proposal.reason,
      investigatedCause: investigation.cause,
    },
  });

  // --- Policy check (deterministic, the hard gate) --------------------------
  const verdict = evaluatePolicy({
    proposal,
    investigation,
    amount: ctx.amount,
    retryAttemptsSoFar,
  });

  await logAudit({
    caseId: ctx.caseId,
    actor: "POLICY_ENGINE",
    summary: verdict.allowed ? "Approved" : `Rejected: ${verdict.reasons.join("; ")}`,
    payload: verdict,
  });

  if (!verdict.allowed) {
    return prisma.recoveryCase.update({
      where: { id: ctx.caseId },
      data: {
        status: verdict.escalate ? "ESCALATED" : "POLICY_REJECTED",
        reason: verdict.reasons.join("; "),
      },
    });
  }

  // --- Act (only reachable after policy approval) ---------------------------
  const scheduledFor = new Date(Date.now() + proposal.delay_minutes * 60_000);
  const action = await prisma.recoveryAction.create({
    data: {
      caseId: ctx.caseId,
      actionType: proposal.action,
      reason: proposal.reason,
      attemptNumber: retryAttemptsSoFar + 1,
      status: "PENDING",
      scheduledFor,
    },
  });

  await prisma.recoveryCase.update({
    where: { id: ctx.caseId },
    data: { status: "ACTION_SCHEDULED" },
  });

  if (proposal.delay_minutes === 0) {
    // Keep the zero-delay demo path synchronous end to end instead of
    // waiting on the next scheduler tick. Goes through the exact same
    // claim-then-execute code the scheduler uses (actionExecutor.ts) — no
    // duplicated execution logic.
    await claimAndExecuteAction(action.id, ctx.provider);
  }

  return prisma.recoveryCase.findUniqueOrThrow({ where: { id: ctx.caseId } });
}

async function escalateForAiFailure(
  caseId: string,
  source: "investigatorAgent" | "decisionAgent",
  error: unknown
): Promise<RecoveryCase> {
  const message = error instanceof Error ? error.message : String(error);
  await logAudit({
    caseId,
    actor: source === "investigatorAgent" ? "INVESTIGATOR_AGENT" : "DECISION_AGENT",
    summary: `${source} failed validation/output — escalating case, no action executed`,
    payload: { error: message },
  });
  return prisma.recoveryCase.update({
    where: { id: caseId },
    data: { status: "ESCALATED", reason: `${source} error: ${message}` },
  });
}
