import { prisma } from "../db/prisma.js";
import type { AuditActor } from "@prisma/client";

/**
 * "Every action must be logged" (policy engine rule). Every service in the
 * pipeline — deterministic or AI — writes one row here per decision, which
 * is what backs the AI Activity / Audit dashboard page.
 */
export async function logAudit(params: {
  caseId: string;
  actor: AuditActor;
  summary: string;
  payload: unknown;
}): Promise<void> {
  await prisma.recoveryAuditLog.create({
    data: {
      caseId: params.caseId,
      actor: params.actor,
      summary: params.summary,
      payload: params.payload as object,
    },
  });
}
