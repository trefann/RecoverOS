import type {
  PaymentProvider,
  ReminderParams,
  ReminderResult,
  RetryPaymentParams,
  RetryPaymentResult,
} from "./PaymentProvider.js";

export interface SimulatedProviderOptions {
  /** 0..1 probability a simulated retry succeeds. Defaults to a demo-friendly 0.85. */
  retrySuccessRate?: number;
  /** Force a specific outcome, bypassing randomness — used by tests. */
  forceRetryOutcome?: boolean;
}

/**
 * MVP action executor: no real money moves, no real emails send. Built to
 * the exact same PaymentProvider shape RazorpayProvider will implement, so
 * the rest of the system never needs to know it's talking to a simulator.
 */
export class SimulatedProvider implements PaymentProvider {
  constructor(private readonly options: SimulatedProviderOptions = {}) {}

  async retryPayment(params: RetryPaymentParams): Promise<RetryPaymentResult> {
    // Simulate network latency so the dashboard's "in progress" state is visible in a demo.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const success =
      this.options.forceRetryOutcome ??
      Math.random() < (this.options.retrySuccessRate ?? 0.85);

    return {
      success,
      providerPaymentId: params.providerPaymentId,
      amountCaptured: success ? params.amount : 0,
      raw: { simulated: true, method: params.method },
    };
  }

  async sendReminder(params: ReminderParams): Promise<ReminderResult> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    // eslint-disable-next-line no-console
    console.log(
      `[SimulatedProvider] would email ${params.customerEmail} re: ${params.amount} ${params.currency} — ${params.context}`
    );
    return { sent: true, channel: "email" };
  }
}
