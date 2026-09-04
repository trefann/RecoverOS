export const RECOVERY_ACTIONS = [
  "RETRY_PAYMENT",
  "SEND_REMINDER",
  "WAIT",
  "ESCALATE_HUMAN",
] as const;

export type RecoveryActionType = (typeof RECOVERY_ACTIONS)[number];

export const CASE_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const CASE_STATUSES = [
  "DETECTED",
  "INVESTIGATING",
  "DECIDED",
  "POLICY_APPROVED",
  "POLICY_REJECTED",
  "ACTION_SCHEDULED",
  "ACTION_IN_PROGRESS",
  "RECOVERED",
  "FAILED",
  "ESCALATED",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const ACTION_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const SOURCE_TYPES = ["PAYMENT", "SUBSCRIPTION", "INVOICE"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * Deterministic policy limits enforced by policyEngine.ts.
 * These are the only knobs that change recovery behavior — never the LLM.
 */
export const POLICY_LIMITS = {
  /** A given recovery case may never accumulate more than this many RETRY_PAYMENT actions. */
  MAX_RETRIES_PER_CASE: 2,
  /** Amounts at/above this (in the currency's smallest display unit, e.g. rupees) require human escalation regardless of AI confidence. */
  HIGH_VALUE_THRESHOLD: 20000,
  /** Decision Agent proposals below this confidence are auto-escalated instead of executed. */
  MIN_DECISION_CONFIDENCE: 0.6,
  /** Investigator outputs below this confidence are treated as inconclusive and escalated. */
  MIN_INVESTIGATION_CONFIDENCE: 0.5,
  /**
   * Floor for how soon a retry may be scheduled. 0 is allowed: decisionAgent's
   * prompt explicitly permits proposing an immediate retry when the failure
   * reason looks instantaneous (e.g. a bank timeout), and recoveryOrchestrator
   * has a dedicated synchronous execution path for exactly that case.
   */
  MIN_RETRY_DELAY_MINUTES: 0,
  MAX_RETRY_DELAY_MINUTES: 24 * 60,
} as const;
