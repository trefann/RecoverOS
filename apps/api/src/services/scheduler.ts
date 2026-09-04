import { prisma } from "../db/prisma.js";
import { claimAndExecuteAction } from "./actionExecutor.js";
import { runDetectionScan } from "./detectionScanner.js";
import type { PaymentProvider } from "../integrations/payments/PaymentProvider.js";

/**
 * DB-polled scheduler (CHANGE 3). No Redis/Kafka/BullMQ — just a plain
 * interval that looks for due, unclaimed actions. Safe to run this tick
 * concurrently with itself (overlapping intervals) or from multiple API
 * instances: claimAndExecuteAction's atomic UPDATE ensures only one winner
 * per action regardless of how many processes are polling.
 */
export async function runSchedulerTick(provider: PaymentProvider): Promise<{ claimed: number; seen: number }> {
  const due = await prisma.recoveryAction.findMany({
    where: { status: "PENDING", scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: "asc" },
    take: 20,
    select: { id: true },
  });

  let claimed = 0;
  for (const action of due) {
    const won = await claimAndExecuteAction(action.id, provider);
    if (won) claimed++;
  }

  // Same tick also covers detection for the two source types with no
  // webhook to react to (subscriptions, invoices) — see detectionScanner.ts.
  // Kept in the same poll loop rather than a second timer/process: this is
  // still just one DB-polled interval, no new infra.
  await runDetectionScan({ provider });

  return { claimed, seen: due.length };
}

export function startScheduler(provider: PaymentProvider, intervalMs: number): () => void {
  let running = false;

  const timer = setInterval(() => {
    // Guard against a slow tick overlapping the next timer fire within this
    // same process — claimAndExecuteAction is already safe without this,
    // but skipping avoids piling up redundant polls under load.
    if (running) return;
    running = true;
    runSchedulerTick(provider)
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("[scheduler] tick failed", error);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);

  return () => clearInterval(timer);
}
