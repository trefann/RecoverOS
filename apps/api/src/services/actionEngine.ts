import type { RecoveryActionType } from "@recoveros/shared";
import type { PaymentProvider } from "../integrations/payments/PaymentProvider.js";

export interface ExecuteActionInput {
  actionType: RecoveryActionType;
  amount: number;
  currency: string;
  method: string;
  providerPaymentId: string;
  customerEmail: string;
  customerName: string;
  reason: string;
}

export type ActionOutcome = "SUCCESS" | "FAILURE" | "NO_OP";

export interface ActionExecutionResult {
  outcome: ActionOutcome;
  amountRecovered: number;
  detail: unknown;
}

/**
 * The ONLY module in this codebase permitted to call a PaymentProvider.
 * Never imported by investigatorAgent.ts or decisionAgent.ts. Must only be
 * invoked by recoveryOrchestrator.ts, and only after policyEngine has
 * returned allowed: true — see CHANGE 4 in the architecture notes.
 */
export class ActionEngine {
  constructor(private readonly provider: PaymentProvider) {}

  async execute(input: ExecuteActionInput): Promise<ActionExecutionResult> {
    switch (input.actionType) {
      case "RETRY_PAYMENT": {
        const result = await this.provider.retryPayment({
          providerPaymentId: input.providerPaymentId,
          amount: input.amount,
          currency: input.currency,
          method: input.method,
        });
        return {
          outcome: result.success ? "SUCCESS" : "FAILURE",
          amountRecovered: result.amountCaptured,
          detail: result,
        };
      }

      case "SEND_REMINDER": {
        const result = await this.provider.sendReminder({
          customerEmail: input.customerEmail,
          customerName: input.customerName,
          amount: input.amount,
          currency: input.currency,
          context: input.reason,
        });
        return {
          outcome: result.sent ? "SUCCESS" : "FAILURE",
          amountRecovered: 0,
          detail: result,
        };
      }

      case "WAIT":
        return {
          outcome: "NO_OP",
          amountRecovered: 0,
          detail: { note: "No action taken; case will be re-evaluated on the next event." },
        };

      case "ESCALATE_HUMAN":
        return {
          outcome: "NO_OP",
          amountRecovered: 0,
          detail: { note: "Escalated for human review; no automated action taken." },
        };
    }
  }
}
