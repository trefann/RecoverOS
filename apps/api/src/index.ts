import "dotenv/config";
import express from "express";
import cors from "cors";
import { webhooksRouter } from "./routes/webhooks.js";
import { casesRouter } from "./routes/cases.js";
import { analyticsRouter } from "./routes/analytics.js";
import { detectionRouter } from "./routes/detection.js";
import { OperatorActionError } from "./services/operatorActions.js";
import { startScheduler } from "./services/scheduler.js";
import { getDefaultProvider } from "./integrations/payments/defaultProvider.js";
import { prisma } from "./db/prisma.js";

const app = express();

// No auth on purpose — this is a public demo, not a multi-tenant product.
// See README for what that trade-off means if this ever needs real users.
app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/webhooks", webhooksRouter);
app.use("/cases", casesRouter);
app.use("/analytics", analyticsRouter);
app.use("/detection", detectionRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof OperatorActionError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("[api] unhandled error", err);
  res.status(500).json({ error: "Internal server error" });
});

// Railway/Render/most PaaS inject PORT and route traffic to whatever it is —
// API_PORT is the local-dev-friendly override, PORT wins when a host sets it.
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
const pollIntervalMs = Number(process.env.SCHEDULER_POLL_INTERVAL_MS ?? 5000);

const server = app.listen(port, () => {
  console.log(`[api] listening on :${port}`);
});

const stopScheduler = startScheduler(getDefaultProvider(), pollIntervalMs);
console.log(`[scheduler] polling every ${pollIntervalMs}ms`);

function shutdown() {
  console.log("[api] shutting down");
  stopScheduler();
  server.close();
  prisma.$disconnect().finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
