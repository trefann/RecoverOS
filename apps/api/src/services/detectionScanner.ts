import { prisma } from "../db/prisma.js";
import { processSubscriptionFailure, processInvoiceOverdue, type OrchestratorDeps } from "./recoveryOrchestrator.js";

export interface DetectionScanResult {
  subscriptionsScanned: number;
  subscriptionsProcessed: number;
  invoicesScanned: number;
  invoicesProcessed: number;
}

/**
 * Periodic scan for the two source types that have no webhook to react to:
 * a failing subscription and an overdue invoice are discovered by polling
 * the table, not by an inbound event. Reuses the exact same
 * processSubscriptionFailure/processInvoiceOverdue idempotency check (skip
 * if a non-terminal case already exists) so running this on every scheduler
 * tick never opens duplicate cases for a source still being worked.
 */
export async function runDetectionScan(deps: OrchestratorDeps = {}): Promise<DetectionScanResult> {
  const dueSubscriptions = await prisma.subscription.findMany({
    where: { failedAttempts: { gt: 0 }, nextPaymentAt: { lte: new Date() } },
    select: { id: true },
  });

  let subscriptionsProcessed = 0;
  for (const sub of dueSubscriptions) {
    const result = await processSubscriptionFailure(sub.id, deps);
    if (!result.duplicate) subscriptionsProcessed++;
  }

  const overdueInvoices = await prisma.invoice.findMany({
    where: { status: { not: "paid" }, dueDate: { lt: new Date() } },
    select: { id: true },
  });

  let invoicesProcessed = 0;
  for (const invoice of overdueInvoices) {
    const result = await processInvoiceOverdue(invoice.id, deps);
    if (!result.duplicate) invoicesProcessed++;
  }

  return {
    subscriptionsScanned: dueSubscriptions.length,
    subscriptionsProcessed,
    invoicesScanned: overdueInvoices.length,
    invoicesProcessed,
  };
}
