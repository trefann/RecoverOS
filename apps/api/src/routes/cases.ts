import { Router } from "express";
import { z } from "zod";
import { CASE_STATUSES, CASE_PRIORITIES, type CaseDetailDTO, type CaseListDTO } from "@recoveros/shared";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { toRecoveryCaseDTO, toRecoveryActionDTO, toRecoveryOutcomeDTO, buildTimeline } from "../services/dto.js";
import { escalateCase, retryCaseNow } from "../services/operatorActions.js";

export const casesRouter = Router();

const PAGE_SIZE = 50;

const ListQuerySchema = z.object({
  status: z.enum(CASE_STATUSES).optional(),
  priority: z.enum(CASE_PRIORITIES).optional(),
  cursor: z.string().optional(),
});

const EscalateBodySchema = z.object({ reason: z.string().min(1).optional() });

/** Recovery Queue page: filterable, cursor-paginated list of cases, newest first. */
casesRouter.get("/", asyncHandler(async (req, res) => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }

  const cases = await prisma.recoveryCase.findMany({
    where: {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.priority ? { priority: parsed.data.priority } : {}),
    },
    include: { customer: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
  });

  // Fetching one extra row is how we know a next page exists without a
  // separate COUNT query: if it came back, there's more beyond this page.
  const hasMore = cases.length > PAGE_SIZE;
  const page = hasMore ? cases.slice(0, PAGE_SIZE) : cases;

  const lastCase = page[page.length - 1];
  const dto: CaseListDTO = {
    cases: page.map(toRecoveryCaseDTO),
    nextCursor: hasMore && lastCase ? lastCase.id : null,
  };
  res.json(dto);
}));

/** Manual escalation from the dashboard — a human closing out a case themselves. */
casesRouter.post("/:id/escalate", asyncHandler(async (req, res) => {
  const parsed = EscalateBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const caseId = req.params.id;
  if (!caseId) {
    res.status(400).json({ error: "Missing case id" });
    return;
  }
  const updated = await escalateCase(caseId, parsed.data.reason);
  res.json({ case: toRecoveryCaseDTO({ ...updated, customer: await customerNameFor(updated.customerId) }) });
}));

/** Manual "retry now" from the dashboard — bypasses the AI, not the action engine. */
casesRouter.post("/:id/retry", asyncHandler(async (req, res) => {
  const caseId = req.params.id;
  if (!caseId) {
    res.status(400).json({ error: "Missing case id" });
    return;
  }
  const updated = await retryCaseNow(caseId);
  res.json({ case: toRecoveryCaseDTO({ ...updated, customer: await customerNameFor(updated.customerId) }) });
}));

async function customerNameFor(customerId: string): Promise<{ name: string }> {
  return prisma.customer.findUniqueOrThrow({ where: { id: customerId }, select: { name: true } });
}

/** Case Detail page: full case + actions + outcomes + rendered timeline. */
casesRouter.get("/:id", asyncHandler(async (req, res) => {
  const recoveryCase = await prisma.recoveryCase.findUnique({
    where: { id: req.params.id },
    include: {
      customer: { select: { name: true } },
      paymentEvent: true,
      actions: { orderBy: { createdAt: "asc" } },
      outcomes: { orderBy: { recoveredAt: "asc" } },
      auditLogs: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!recoveryCase) {
    res.status(404).json({ error: "Case not found" });
    return;
  }

  const dto: CaseDetailDTO = {
    case: toRecoveryCaseDTO(recoveryCase),
    actions: recoveryCase.actions.map(toRecoveryActionDTO),
    outcomes: recoveryCase.outcomes.map(toRecoveryOutcomeDTO),
    timeline: buildTimeline(recoveryCase.paymentEvent, recoveryCase.auditLogs, recoveryCase.outcomes),
  };

  res.json(dto);
}));
