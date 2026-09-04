import { prisma } from "../db/prisma.js";
import { ActionEngine } from "./actionEngine.js";
import { verify } from "./verifier.js";
import { logAudit } from "./auditLog.js";
import type { PaymentProvider } from "../integrations/payments/PaymentProvider.js";

/**
 * Atomically claims one due recovery_action so at most one process/tick ever
 * executes it (CHANGE 3). This is a conditional UPDATE, not a
 * check-then-write: Postgres takes a row lock on UPDATE, so a second
 * concurrent UPDATE targeting the same row blocks until the first commits,
 * then re-evaluates `WHERE status = 'PENDING'` against the now-committed row
 * — which is no longer PENDING, so the second claim affects 0 rows. No
 * SELECT ... FOR UPDATE or external lock manager needed.
 */
export async function claimAction(actionId: string) {
  const claim = await prisma.recoveryAction.updateMany({
    where: { id: actionId, status: "PENDING" },
    data: { status: "PROCESSING", claimedAt: new Date() },
  });

  if (claim.count === 0) {
    // Someone else (another tick, or an overlapping interval) already claimed it.
    return null;
  }

  return loadActionContext(actionId);
}

async function loadActionContext(actionId: string) {
  return prisma.recoveryAction.findUniqueOrThrow({
    where: { id: actionId },
    include: {
      case: {
        include: {
          customer: true,
          paymentEvent: { include: { payment: true } },
        },
      },
    },
  });
}

export type ClaimedAction = Awaited<ReturnType<typeof loadActionContext>>;

/**
 * Runs a claimed action through actionEngine → verifier, and persists the
 * result. Only ever called with an action this process just claimed via
 * claimAction — actionEngine is never reachable any other way.
 */
export async function executeClaimedAction(
  claimed: ClaimedAction,
  provider: PaymentProvider
): Promise<void> {
  const { case: recoveryCase } = claimed;
  const payment = recoveryCase.paymentEvent?.payment;

  const engine = new ActionEngine(provider);

  try {
    const executionResult = await engine.execute({
      actionType: claimed.actionType,
      amount: Number(claimed.case.amountAtRisk),
      currency: claimed.case.currency,
      method: payment?.method ?? "unknown",
      providerPaymentId: payment?.providerPaymentId ?? claimed.case.sourceId,
      customerEmail: recoveryCase.customer.email,
      customerName: recoveryCase.customer.name,
      reason: claimed.reason,
    });

    await logAudit({
      caseId: claimed.caseId,
      actor: "ACTION_ENGINE",
      summary: `Executed ${claimed.actionType}: ${executionResult.outcome}`,
      payload: executionResult,
    });

    const verification = verify({
      actionType: claimed.actionType,
      actionResult: executionResult,
      providerPaymentId: payment?.providerPaymentId ?? claimed.case.sourceId,
    });

    await logAudit({
      caseId: claimed.caseId,
      actor: "VERIFIER",
      summary: `Verification: ${verification.status}`,
      payload: verification,
    });

    await prisma.$transaction(async (tx) => {
      await tx.recoveryAction.update({
        where: { id: claimed.id },
        data: {
          status: executionResult.outcome === "FAILURE" ? "FAILED" : "COMPLETED",
          executedAt: new Date(),
          result: executionResult as unknown as object,
        },
      });

      if (verification.status === "RECOVERED") {
        await tx.recoveryOutcome.create({
          data: {
            caseId: claimed.caseId,
            actionId: claimed.id,
            amountRecovered: verification.amount_recovered,
            success: true,
          },
        });
        await tx.recoveryCase.update({
          where: { id: claimed.caseId },
          data: { status: "RECOVERED" },
        });

        // Subscriptions/invoices have no webhook telling them they're
        // resolved — they're found by scanning the table for a due/overdue
        // row (detectionScanner.ts). Without this, a recovered subscription
        // still has failedAttempts > 0 and a past nextPaymentAt, so the very
        // next scheduler tick would re-detect it and open a duplicate case.
        if (recoveryCase.source === "SUBSCRIPTION") {
          await tx.subscription.update({
            where: { id: recoveryCase.sourceId },
            data: {
              failedAttempts: 0,
              nextPaymentAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
            },
          });
          await tx.openRecoverySlot.deleteMany({ where: { caseId: claimed.caseId } });
        } else if (recoveryCase.source === "INVOICE") {
          await tx.invoice.update({
            where: { id: recoveryCase.sourceId },
            data: { status: "paid" },
          });
          await tx.openRecoverySlot.deleteMany({ where: { caseId: claimed.caseId } });
        }

        return;
      }

      if (verification.status === "FAILED") {
        // Failed action: escalate rather than silently giving up, matching
        // "low-confidence / failed automated attempts escalate to a human".
        await tx.recoveryCase.update({
          where: { id: claimed.caseId },
          data: { status: "ESCALATED" },
        });
        return;
      }

      // STILL_AT_RISK (e.g. a reminder was sent, or the case is waiting):
      // leave the case in ACTION_IN_PROGRESS until a future event resolves it.
      await tx.recoveryCase.update({
        where: { id: claimed.caseId },
        data: { status: "ACTION_IN_PROGRESS" },
      });
    });
  } catch (error) {
    await prisma.recoveryAction.update({
      where: { id: claimed.id },
      data: {
        status: "FAILED",
        executedAt: new Date(),
        result: { error: error instanceof Error ? error.message : String(error) },
      },
    });
    await logAudit({
      caseId: claimed.caseId,
      actor: "ACTION_ENGINE",
      summary: "Action execution threw an error",
      payload: { error: error instanceof Error ? error.message : String(error) },
    });
  }
}

/** Convenience used by both the scheduler tick and the orchestrator's immediate path. */
export async function claimAndExecuteAction(
  actionId: string,
  provider: PaymentProvider
): Promise<boolean> {
  const claimed = await claimAction(actionId);
  if (!claimed) return false;
  await executeClaimedAction(claimed, provider);
  return true;
}
