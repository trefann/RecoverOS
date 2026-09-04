import type {
  RecoveryCase,
  RecoveryAction,
  RecoveryOutcome,
  RecoveryAuditLog,
  PaymentEvent,
  AuditActor,
} from "@prisma/client";
import type {
  RecoveryCaseDTO,
  RecoveryActionDTO,
  RecoveryOutcomeDTO,
  CaseTimelineEventDTO,
} from "@recoveros/shared";

export function toRecoveryCaseDTO(c: RecoveryCase & { customer: { name: string } }): RecoveryCaseDTO {
  return {
    id: c.id,
    sourceType: c.source,
    sourceId: c.sourceId,
    customerId: c.customerId,
    customerName: c.customer.name,
    amountAtRisk: Number(c.amountAtRisk),
    currency: c.currency,
    riskScore: c.riskScore,
    recoverabilityScore: c.recoverabilityScore,
    priority: c.priority,
    reason: c.reason,
    recommendedAction: c.recommendedAction,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toRecoveryActionDTO(a: RecoveryAction): RecoveryActionDTO {
  return {
    id: a.id,
    caseId: a.caseId,
    actionType: a.actionType,
    reason: a.reason,
    status: a.status,
    scheduledFor: a.scheduledFor.toISOString(),
    executedAt: a.executedAt ? a.executedAt.toISOString() : null,
    result: a.result ? JSON.stringify(a.result) : null,
  };
}

export function toRecoveryOutcomeDTO(o: RecoveryOutcome): RecoveryOutcomeDTO {
  return {
    id: o.id,
    caseId: o.caseId,
    amountRecovered: Number(o.amountRecovered),
    success: o.success,
    recoveredAt: o.recoveredAt.toISOString(),
  };
}

const ACTOR_LABELS: Record<AuditActor, string> = {
  RECOVERABILITY_ENGINE: "Revenue risk detected",
  INVESTIGATOR_AGENT: "AI investigated — cause identified",
  DECISION_AGENT: "Recovery action recommended",
  POLICY_ENGINE: "Policy reviewed",
  ACTION_ENGINE: "Action executed",
  VERIFIER: "Outcome verified",
  SCHEDULER: "Scheduler",
  OPERATOR: "Operator action",
};

export function buildTimeline(
  paymentEvent: PaymentEvent | null,
  auditLogs: RecoveryAuditLog[],
  outcomes: RecoveryOutcome[]
): CaseTimelineEventDTO[] {
  const events: CaseTimelineEventDTO[] = [];

  if (paymentEvent) {
    events.push({
      step: "payment_failed",
      label: "Payment failed",
      detail: paymentEvent.eventType,
      timestamp: paymentEvent.receivedAt.toISOString(),
    });
  }

  for (const log of auditLogs) {
    events.push({
      step: log.actor.toLowerCase(),
      label: ACTOR_LABELS[log.actor],
      detail: log.summary,
      timestamp: log.createdAt.toISOString(),
    });
  }

  for (const outcome of outcomes) {
    events.push({
      step: "outcome",
      label: outcome.success ? `${Number(outcome.amountRecovered)} RECOVERED` : "Not recovered",
      detail: null,
      timestamp: outcome.recoveredAt.toISOString(),
    });
  }

  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
