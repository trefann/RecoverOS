import { Router } from "express";
import { z } from "zod";
import type {
  OverviewMetricsDTO,
  AuditLogEntryDTO,
  AuditLogListDTO,
  AnalyticsBreakdownDTO,
  LearningInsightsDTO,
} from "@recoveros/shared";
import { CASE_PRIORITIES, CASE_STATUSES } from "@recoveros/shared";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { computeLearningInsights } from "../services/learningInsights.js";

export const analyticsRouter = Router();

const OPEN_STATUSES = [
  "DETECTED",
  "INVESTIGATING",
  "DECIDED",
  "POLICY_APPROVED",
  "ACTION_SCHEDULED",
  "ACTION_IN_PROGRESS",
  "ESCALATED",
] as const;

const RESOLVED_STATUSES = ["RECOVERED", "FAILED", "ESCALATED", "POLICY_REJECTED"] as const;

/** Overview page: the money-first headline metrics. */
analyticsRouter.get("/overview", asyncHandler(async (_req, res) => {
  const openCases = await prisma.recoveryCase.findMany({
    where: { status: { in: [...OPEN_STATUSES] } },
    select: { amountAtRisk: true, recoverabilityScore: true },
  });

  const resolvedCases = await prisma.recoveryCase.findMany({
    where: { status: { in: [...RESOLVED_STATUSES] } },
    select: { amountAtRisk: true },
  });

  const recoveredAgg = await prisma.recoveryOutcome.aggregate({
    where: { success: true },
    _sum: { amountRecovered: true },
  });

  const revenueAtRisk = openCases.reduce((sum, c) => sum + Number(c.amountAtRisk), 0);
  const recoverable = openCases.reduce(
    (sum, c) => sum + Number(c.amountAtRisk) * c.recoverabilityScore,
    0
  );
  const recovered = Number(recoveredAgg._sum.amountRecovered ?? 0);
  const totalResolvedAmount = resolvedCases.reduce((sum, c) => sum + Number(c.amountAtRisk), 0);
  const recoveryRatePct = totalResolvedAmount > 0 ? (recovered / totalResolvedAmount) * 100 : 0;

  const metrics: OverviewMetricsDTO = {
    currency: "INR",
    revenueAtRisk,
    recoverable,
    recovered,
    recoveryRatePct: Math.round(recoveryRatePct * 10) / 10,
    openCases: openCases.length,
  };

  res.json(metrics);
}));

const AUDIT_PAGE_SIZE = 50;
const AuditQuerySchema = z.object({ cursor: z.string().optional() });

/** AI Activity / Audit page: every deterministic + AI decision, newest first, cursor-paginated. */
analyticsRouter.get("/audit", asyncHandler(async (req, res) => {
  const parsed = AuditQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }

  const logs = await prisma.recoveryAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: AUDIT_PAGE_SIZE + 1,
    ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
  });

  const hasMore = logs.length > AUDIT_PAGE_SIZE;
  const page = hasMore ? logs.slice(0, AUDIT_PAGE_SIZE) : logs;

  const entries: AuditLogEntryDTO[] = page.map((log) => ({
    id: log.id,
    caseId: log.caseId,
    actor: log.actor.toLowerCase().replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()) as AuditLogEntryDTO["actor"],
    summary: log.summary,
    payload: log.payload,
    createdAt: log.createdAt.toISOString(),
  }));

  const lastLog = page[page.length - 1];
  const dto: AuditLogListDTO = { entries, nextCursor: hasMore && lastLog ? lastLog.id : null };
  res.json(dto);
}));

/** Analytics page: distribution + a simple recovered-amount trend. */
analyticsRouter.get("/breakdown", asyncHandler(async (_req, res) => {
  const byPriorityRaw = await prisma.recoveryCase.groupBy({
    by: ["priority"],
    _count: { _all: true },
    _sum: { amountAtRisk: true },
  });
  const byStatusRaw = await prisma.recoveryCase.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 14);
  const outcomes = await prisma.recoveryOutcome.findMany({
    where: { success: true, recoveredAt: { gte: since } },
    select: { amountRecovered: true, recoveredAt: true },
  });
  const byDay = new Map<string, number>();
  for (const o of outcomes) {
    const day = o.recoveredAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(o.amountRecovered));
  }

  const breakdown: AnalyticsBreakdownDTO = {
    byPriority: CASE_PRIORITIES.map((priority) => {
      const row = byPriorityRaw.find((r) => r.priority === priority);
      return {
        priority,
        count: row?._count._all ?? 0,
        amountAtRisk: Number(row?._sum.amountAtRisk ?? 0),
      };
    }),
    byStatus: CASE_STATUSES.map((status) => ({
      status,
      count: byStatusRaw.find((r) => r.status === status)?._count._all ?? 0,
    })).filter((s) => s.count > 0),
    recoveredByDay: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount })),
  };

  res.json(breakdown);
}));

/** Analytics page: the LEARN step — historical success rate by cause/action/priority. */
analyticsRouter.get("/insights", asyncHandler(async (_req, res) => {
  const insights: LearningInsightsDTO = await computeLearningInsights();
  res.json(insights);
}));
