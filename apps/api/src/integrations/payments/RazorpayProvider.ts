import type {
  PaymentProvider,
  ReminderParams,
  ReminderResult,
  RetryPaymentParams,
  RetryPaymentResult,
} from "./PaymentProvider.js";

/**
 * Not wired up for the hackathon MVP. Left as a stub so swapping the
 * simulator for real Razorpay test-mode calls later is a same-shape change
 * behind PaymentProvider — actionEngine.ts and everything above it is
 * unaffected. Real implementation would use the Razorpay Node SDK
 * (`razorpay.payments.capture` / a new payment link for retries, and an
 * email/SMS provider for reminders), authenticated via
 * RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET env vars — never hardcoded, never
 * sent to the frontend.
 */
export class RazorpayProvider implements PaymentProvider {
  async retryPayment(_params: RetryPaymentParams): Promise<RetryPaymentResult> {
    throw new Error("RazorpayProvider is not implemented yet. Use SimulatedProvider for the MVP.");
  }

  async sendReminder(_params: ReminderParams): Promise<ReminderResult> {
    throw new Error("RazorpayProvider is not implemented yet. Use SimulatedProvider for the MVP.");
  }
}
