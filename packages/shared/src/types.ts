import type { CasePriority, CaseStatus, ActionStatus, SourceType, RecoveryActionType } from "./constants.js";

/** API-facing shape of a recovery_cases row, as returned by apps/api to apps/web. */
export interface RecoveryCaseDTO {
  id: string;
  sourceType: SourceType;
  sourceId: string;
  customerId: string;
  customerName: string;
  amountAtRisk: number;
  currency: string;
  riskScore: number;
  recoverabilityScore: number;
  priority: CasePriority;
  reason: string | null;
  recommendedAction: RecoveryActionType | null;
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryActionDTO {
  id: string;
  caseId: string;
  actionType: RecoveryActionType;
  reason: string;
  status: ActionStatus;
  scheduledFor: string;
  executedAt: string | null;
  result: string | null;
}

export interface RecoveryOutcomeDTO {
  id: string;
  caseId: string;
  amountRecovered: number;
  success: boolean;
  recoveredAt: string;
}

/** A single step in a case's timeline, rendered on the Case Detail page. */
export interface CaseTimelineEventDTO {
  step: string;
  label: string;
  detail: string | null;
  timestamp: string;
}

/** GET /cases — cursor-paginated: pass `nextCursor` back as `?cursor=` to fetch the next page. */
export interface CaseListDTO {
  cases: RecoveryCaseDTO[];
  nextCursor: string | null;
}

export interface CaseDetailDTO {
  case: RecoveryCaseDTO;
  actions: RecoveryActionDTO[];
  outcomes: RecoveryOutcomeDTO[];
  timeline: CaseTimelineEventDTO[];
}

/** Analytics page breakdowns, computed server-side to keep the frontend dumb. */
export interface AnalyticsBreakdownDTO {
  byPriority: Array<{ priority: CasePriority; count: number; amountAtRisk: number }>;
  byStatus: Array<{ status: CaseStatus; count: number }>;
  recoveredByDay: Array<{ date: string; amount: number }>;
}

/** One bucket of the LEARN loop's historical success-rate breakdown. */
export interface InsightBucketDTO {
  key: string;
  attempts: number;
  recovered: number;
  successRatePct: number;
}

/** GET /analytics/insights — the LEARN step: what's actually worked, by cause/action/priority. */
export interface LearningInsightsDTO {
  byCause: InsightBucketDTO[];
  byAction: InsightBucketDTO[];
  byPriority: InsightBucketDTO[];
}

/** Aggregate metrics for the Overview page. */
export interface OverviewMetricsDTO {
  currency: string;
  revenueAtRisk: number;
  recoverable: number;
  recovered: number;
  recoveryRatePct: number;
  openCases: number;
}

/** Per-decision audit log entry for the AI Activity / Audit page. */
export interface AuditLogEntryDTO {
  id: string;
  caseId: string;
  actor:
    | "recoverabilityEngine"
    | "investigatorAgent"
    | "decisionAgent"
    | "policyEngine"
    | "actionEngine"
    | "verifier"
    | "scheduler"
    | "operator";
  summary: string;
  payload: unknown;
  createdAt: string;
}

/** GET /analytics/audit — cursor-paginated the same way as CaseListDTO. */
export interface AuditLogListDTO {
  entries: AuditLogEntryDTO[];
  nextCursor: string | null;
}
