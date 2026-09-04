import { SimulatedProvider } from "./SimulatedProvider.js";
import type { PaymentProvider } from "./PaymentProvider.js";

// Single shared simulator instance for the running process. Swapping to
// RazorpayProvider later is a one-line change here — nothing else in the
// codebase constructs a provider directly.
let _defaultProvider: PaymentProvider | null = null;

export function getDefaultProvider(): PaymentProvider {
  if (!_defaultProvider) {
    _defaultProvider = new SimulatedProvider();
  }
  return _defaultProvider;
}
