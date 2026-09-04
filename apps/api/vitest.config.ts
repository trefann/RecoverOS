import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The recoveryOrchestrator integration tests make several sequential
    // round-trips to a real (often remote, e.g. Neon) Postgres instance per
    // test; the 5s default is too tight for that over a real network.
    testTimeout: 60000,
  },
});
