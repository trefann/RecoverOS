import { prisma } from "../db/prisma.js";
import type { CasePriority } from "@prisma/client";

/**
 * The LEARN step of DETECT→INVESTIGATE→DECIDE→POLICY→ACT→VERIFY→LEARN.
 * Deterministic aggregation over past outcomes — no LLM involved — used two
 * ways: read by GET /analytics/insights for the dashboard, and read by
 * investigatorAgent.ts/decisionAgent.ts to inject real historical context
 * into their prompts. Same numbers, same source of truth, both directions.
 */

// A case counts toward these stats once it's actually resolved one way or
// another. ESCALATED counts as "automation didn't recover it" — a human had
// to step in — not as a pending/unknown outcome.
const RESOLVED_STATUSES = ["RECOVERED", "FAILED", "ESCALATED", "POLICY_REJECTED"] as const;

export interface InsightBucket {
  key: string;
  attempts: number;
  recovered: number;
  successRatePct: number;
}

export interface LearningInsights {
  byCause: InsightBucket[];
  byAction: InsightBucket[];
  byPriority: InsightBucket[];
}

function toBuckets(rows: Array<{ key: string | null; recovered: boolean }>): InsightBucket[] {
  const grouped = new Map<string, { attempts: number; recovered: number }>();
  for (const row of rows) {
    if (!row.key) continue;
    const bucket = grouped.get(row.key) ?? { attempts: 0, recovered: 0 };
    bucket.attempts += 1;
    if (row.recovered) bucket.recovered += 1;
    grouped.set(row.key, bucket);
  }
  return [...grouped.entries()]
    .map(([key, { attempts, recovered }]) => ({
      key,
      attempts,
      recovered,
      successRatePct: Math.round((recovered / attempts) * 1000) / 10,
    }))
    .sort((a, b) => b.attempts - a.attempts);
}

/** Full breakdown for the Analytics page's "What We've Learned" section. */
export async function computeLearningInsights(): Promise<LearningInsights> {
  const resolved = await prisma.recoveryCase.findMany({
    where: { status: { in: [...RESOLVED_STATUSES] } },
    select: { status: true, investigatedCause: true, recommendedAction: true, priority: true },
  });

  return {
    byCause: toBuckets(resolved.map((c) => ({ key: c.investigatedCause, recovered: c.status === "RECOVERED" }))),
    byAction: toBuckets(resolved.map((c) => ({ key: c.recommendedAction, recovered: c.status === "RECOVERED" }))),
    byPriority: toBuckets(resolved.map((c) => ({ key: c.priority, recovered: c.status === "RECOVERED" }))),
  };
}

/** Historical recovery rate for cases investigatorAgent has diagnosed with this cause, so far. */
export async function successRateForCause(cause: string): Promise<InsightBucket | null> {
  const rows = await prisma.recoveryCase.findMany({
    where: { status: { in: [...RESOLVED_STATUSES] }, investigatedCause: cause },
    select: { status: true },
  });
  if (rows.length === 0) return null;
  const [bucket] = toBuckets(rows.map((r) => ({ key: cause, recovered: r.status === "RECOVERED" })));
  return bucket ?? null;
}

/** Historical recovery rate for cases recoverabilityEngine assigned this priority, so far. */
export async function successRateForPriority(priority: CasePriority): Promise<InsightBucket | null> {
  const rows = await prisma.recoveryCase.findMany({
    where: { status: { in: [...RESOLVED_STATUSES] }, priority },
    select: { status: true },
  });
  if (rows.length === 0) return null;
  const [bucket] = toBuckets(rows.map((r) => ({ key: priority, recovered: r.status === "RECOVERED" })));
  return bucket ?? null;
}
