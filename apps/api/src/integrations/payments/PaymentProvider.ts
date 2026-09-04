/**
 * Abstraction over "a system that can actually move money or contact a
 * customer". actionEngine.ts is the only module that talks to this
 * interface — swapping SimulatedProvider for RazorpayProvider later should
 * require zero changes outside integrations/payments/.
 */
export interface RetryPaymentParams {
  providerPaymentId: string;
  amount: number;
  currency: string;
  method: string;
}

export interface RetryPaymentResult {
  success: boolean;
  providerPaymentId: string;
  amountCaptured: number;
  raw?: unknown;
}

export interface ReminderParams {
  customerEmail: string;
  customerName: string;
  amount: number;
  currency: string;
  context: string;
}

export interface ReminderResult {
  sent: boolean;
  channel: "email";
}

export interface PaymentProvider {
  retryPayment(params: RetryPaymentParams): Promise<RetryPaymentResult>;
  sendReminder(params: ReminderParams): Promise<ReminderResult>;
}
