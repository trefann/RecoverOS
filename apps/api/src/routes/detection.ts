import { Router } from "express";
import { runDetectionScan } from "../services/detectionScanner.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const detectionRouter = Router();

/**
 * Manual trigger for the same scan the scheduler runs on every poll tick
 * (see scheduler.ts / detectionScanner.ts). Subscriptions and invoices have
 * no webhook to react to, so without this a demo would have to wait up to
 * SCHEDULER_POLL_INTERVAL_MS for a newly-seeded overdue invoice or failing
 * subscription to turn into a case.
 */
detectionRouter.post("/scan", asyncHandler(async (_req, res) => {
  const result = await runDetectionScan();
  res.json(result);
}));
