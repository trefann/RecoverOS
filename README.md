# RecoverOS

AI-powered revenue recovery system. Detects revenue at risk, investigates why, predicts recoverability,
proposes a recovery action, validates it against a deterministic policy engine, executes it, verifies the
outcome, and measures money actually recovered.

**Core principle: "AI proposes, code disposes."** The LLM never touches a payment provider. It returns a
validated, structured proposal; a deterministic policy engine is the only thing that can approve it; a
separate action engine is the only thing that can execute it.

## Architecture

```
apps/
  web/     Next.js (App Router) dashboard — Overview, Recovery Queue, Case Detail, Analytics, AI Activity/Audit
  api/     Express REST API — the recovery pipeline lives here
packages/
  shared/  Zod schemas + TS types shared by web and api (agent I/O, DB-facing DTOs, policy constants)
```

### The recovery pipeline

```
PAYMENT:  webhook (POST /webhooks/payment)          --\
SUBSCRIPTION/INVOICE: detectionScanner.ts (scan)    --+-> recoveryOrchestrator.ts (coordinates every step below)
                                                        -> recoverabilityEngine.ts   deterministic: risk/recoverability score + priority
                                                        -> investigatorAgent.ts      LLM, structured output only — cause, confidence, evidence
                                                        -> decisionAgent.ts          LLM, structured output only — proposes ONE action
                                                        -> policyEngine.ts           deterministic hard gate — allow / deny / escalate
                                                        -> actionExecutor.ts         claims + runs the approved action (shared with scheduler.ts)
                                                             -> actionEngine.ts      the ONLY module that calls a PaymentProvider
                                                             -> verifier.ts          interprets the provider's result
```

`investigatorAgent.ts` and `decisionAgent.ts` import nothing from `actionEngine.ts` or
`integrations/payments/` — they physically cannot execute anything. `policyEngine.ts` calls no LLM and is
pure, testable TypeScript. `actionEngine.ts` is the sole caller of `PaymentProvider`, currently
`SimulatedProvider` (no real money moves); `RazorpayProvider` is a same-shape stub for later.

### LEARN — the loop's last step

`learningInsights.ts` is a deterministic aggregation over every *resolved* case (no LLM) — success rate by
diagnosed cause, by recommended action, by priority. It's read two ways from the exact same source of truth:

- `GET /analytics/insights` backs the Analytics page's "What we've learned" section (real numbers, no charts
  library needed — just sorted bars).
- `runPipelineAfterDetection` in `recoveryOrchestrator.ts` calls `successRateForPriority` before
  investigatorAgent runs and `successRateForCause` before decisionAgent runs, and both numbers get folded
  straight into the prompt as one line each ("Historical recovery rate for X is Y%"). This is verifiably not
  cosmetic — the real LLM has cited these exact injected numbers back in its own `evidence` output.

This keeps the boundary from Change 4 intact: the AI's *input* gets richer over time, but `policyEngine.ts`
is untouched — code still disposes exactly the same way regardless of what the AI has learned to say.

### Subscription and invoice detection

Payments arrive via webhook; failing subscriptions and overdue invoices don't — nothing pushes an event when
a subscription's dunning attempts run out or an invoice's due date passes, so `detectionScanner.ts` finds
them by polling `subscriptions`/`invoices` on the same interval the scheduler already runs on (no new infra:
one DB-polled loop covers both "execute due actions" and "detect newly-due sources"). Both funnel into the
exact same `recoveryOrchestrator.ts` pipeline as the payment path — `processSubscriptionFailure` /
`processInvoiceOverdue` differ only in how the case gets created.

Idempotency here works differently from the payment path, since there's no `payment_events`-style unique key
to check: an `open_recovery_slots` row (unique on `(source, sourceId)`) is created in the same transaction
as the case, so two processes racing to detect the same due subscription/invoice can't both win — the loser
hits the unique constraint and is handed back the case that actually won, same pattern as
`payment_events.provider_event_id`. The slot is deleted once the case resolves to `RECOVERED` (which also
resets the subscription's `failedAttempts`/`nextPaymentAt`, or marks the invoice `paid`) — without that reset,
the very next scan tick would immediately re-detect the same now-resolved source and open a duplicate case.
`POST /detection/scan` (authenticated) runs the same scan on demand, for demoing without waiting up to
`SCHEDULER_POLL_INTERVAL_MS`.

### Webhook idempotency

`payment_events.provider_event_id` is UNIQUE at the database level. `recoveryOrchestrator.ts` checks for an
existing event first (cheap fast path), but the actual guarantee is the INSERT: a second concurrent request
racing past that check will fail the unique constraint, and the orchestrator catches that specific error
(`P2002`) and returns the same case the first request created instead of erroring or duplicating anything.

### Scheduler concurrency safety

`recovery_actions` has a `PENDING -> PROCESSING -> COMPLETED | FAILED` lifecycle. Claiming a due action is a
single conditional `UPDATE ... WHERE status = 'PENDING'`. Postgres takes a row lock on that UPDATE; a second
concurrent UPDATE against the same row blocks until the first commits, then re-evaluates its own `WHERE`
clause against the now-committed row — which is no longer `PENDING`, so the second claim affects 0 rows and
is treated as "someone else got it." This holds whether the race is two overlapping ticks in one process or
two API instances polling at once. No Redis/BullMQ/queue broker involved.

### Manual case actions (human override)

`POST /cases/:id/escalate` and `POST /cases/:id/retry` let a dashboard operator act directly on a case —
the two buttons on the Case Detail page. These bypass decisionAgent/policyEngine's *AI-specific* gates
(confidence thresholds, high-value auto-escalation), because a human clicking the button in the dashboard
**is** the human approval those gates exist to require. What doesn't get bypassed: retry still runs through
the exact same `claimAndExecuteAction` as every automatic action (no separate execution path), and the hard
`MAX_RETRIES_PER_CASE` cap still applies. Every manual action is logged with actor `OPERATOR` — kept
distinct from `POLICY_ENGINE`/`DECISION_AGENT` in the audit trail so it's never mistaken for an AI decision.

### Pagination

`GET /cases` and `GET /analytics/audit` are cursor-paginated (`?cursor=<lastId>`, 50 rows/page). Each
response includes `nextCursor`; the Recovery Queue and AI Activity pages use it for a "Load more" button.
Fetching `PAGE_SIZE + 1` rows per query and slicing is how the API knows a next page exists without a
separate `COUNT` query.

### Money math on the Overview page

- **Revenue at Risk** — sum of `amount_at_risk` over cases still open (not yet RECOVERED/FAILED/ESCALATED/POLICY_REJECTED).
- **Recoverable** — same open cases, weighted by each case's `recoverability_score` (a probability-adjusted expectation, so it's lower than Revenue at Risk).
- **Recovered** — sum of `recovery_outcomes.amount_recovered` where `success = true`, all time.
- **Recovery Rate** — Recovered ÷ total `amount_at_risk` across all *resolved* cases.

## Setup

```bash
npm install
cp apps/api/.env.example apps/api/.env   # then fill in DATABASE_URL and GROQ_API_KEY
```

`DATABASE_URL` needs a Postgres instance — either a free-tier [Neon](https://neon.tech) /
[Supabase](https://supabase.com) database, or `docker compose up -d` (spins up Postgres on `localhost:5432`
using this repo's `docker-compose.yml`) if you'd rather run locally.

```bash
npm run db:migrate --workspace apps/api   # creates the schema
npm run db:seed --workspace apps/api      # demo customers + a couple of pre-resolved cases
```

`seed.ts` is safe to re-run any number of times — every row (including audit logs and actions, not just the
case itself) is upserted by a stable id. This matters because you *will* re-run it across a dev session
(after a migration, to reset the demo subscription's due date, etc).

## Running it

```bash
npm run dev:api   # http://localhost:4000
npm run dev:web   # http://localhost:3000
```

No login — `apps/web/app/page.tsx` is a short hero screen that auto-advances to `/overview` after a moment
(or click through immediately). This is a public demo, not a multi-tenant product; see "What's deliberately
not built" below for what that trade-off means.

## Running the MVP demo scenario

With `dev:api` running:

```bash
npm run demo:webhook --workspace apps/api
```

This fires the exact scenario from the architecture: Priya Sharma's ₹5,000 UPI payment fails with a bank
timeout. Watch it flow through recoverabilityEngine → investigatorAgent → decisionAgent → policyEngine →
actionEngine → verifier in real time on the Case Detail page (find it via the Overview or Queue page).

Run the same command again (or `npm run demo:webhook --workspace apps/api <same-event-id>`) to see webhook
idempotency: it returns `duplicate: true` with the same case, and no second case/action is created.

To see the subscription/invoice path (no webhook involved):

```bash
curl -X POST http://localhost:4000/detection/scan
```

This scans `subscriptions`/`invoices` for anything due/overdue right now and runs it through the same
pipeline — the seeded `Karan Malhotra` subscription and `Arjun Mehta` invoice are both already due, so a
fresh `npm run db:seed` followed by this scan is the fastest way to see a case created from a table scan
instead of an event.

## Testing

```bash
npm run test --workspaces --if-present
```

- `policyEngine.test.ts`, `recoverabilityEngine.test.ts`, `actionEngine.test.ts`, and
  `packages/shared/src/schemas.test.ts` are pure unit tests — no database needed.
- `recoveryOrchestrator.integration.test.ts` and `detectionScanner.integration.test.ts` exercise the real
  idempotency and scheduler-concurrency guarantees against Postgres (the latter specifically covers the
  `open_recovery_slots` race guard and the subscription/invoice reset-on-resolve behavior). Both are skipped
  automatically unless `DATABASE_URL` is set; point it at a throwaway/dev database before running them, and
  make sure no other `dev:api` instance is running against the same database at the same time — they share
  the scheduler's detection scan, so a live instance racing the test suite can produce confusing failures.

## Deploying (split hosting: Vercel + Railway)

`apps/web` (Next.js) deploys to Vercel; `apps/api` (Express + a `setInterval`-based scheduler) needs a host
that keeps a persistent Node process running, which rules out Vercel's serverless functions — Railway works
well and needs no code changes.

**`packages/shared` must be built before `apps/api` can run in production.** In dev, `tsx`/webpack transpile
its TypeScript on the fly; a real `node dist/index.js` cannot import `.ts` directly. `npm install` at the
repo root now builds it automatically (`postinstall` in `packages/shared/package.json`) — this isn't
optional config, skipping it means the API crashes on boot with `ERR_MODULE_NOT_FOUND`.

**Railway (apps/api):**
1. New Project → Deploy from GitHub repo → this repo.
2. Root Directory: leave as the **repo root** (not `apps/api`) — the build needs `npm install` to run where
   the workspaces are defined, so it can resolve `@recoveros/shared`.
3. Build Command: `npm run build:api`
4. Start Command: `npm run start:api`
5. Env vars: `DATABASE_URL`, `GROQ_API_KEY`, `GROQ_MODEL` (`openai/gpt-oss-120b`), `WEB_ORIGIN` (fill in
   after step 2 of Vercel below). `PORT` is injected by Railway automatically — the app already prefers it
   over `API_PORT`.
6. Reusing the same Neon `DATABASE_URL` from local dev is the simplest option — it's already migrated and
   seeded, so there's no separate migration step. A dedicated prod database needs one:
   `DATABASE_URL=<prod-url> npm run db:deploy --workspace apps/api` (uses `prisma migrate deploy`, not
   `migrate dev`).

**Vercel (apps/web):**
1. Import Git Repository → this repo.
2. Root Directory: `apps/web` (set explicitly in the import wizard — Vercel's monorepo detection should
   handle installing from the workspace root automatically, but if the build fails on resolving
   `@recoveros/shared`, override Install Command to `cd ../.. && npm install`).
3. Env var: `NEXT_PUBLIC_API_BASE_URL` = the Railway service's public URL from the step above.
4. Deploy.

**Then**, back on Railway: set `WEB_ORIGIN` to the Vercel production URL and redeploy — CORS is a single
exact-origin allowlist (`index.ts`), so the API rejects requests from an origin it wasn't told about.

## What's deliberately not built

- Real Razorpay integration (`RazorpayProvider` is a stub behind the same `PaymentProvider` interface
  `SimulatedProvider` implements — swapping it in later shouldn't touch anything above `actionEngine.ts`).
- Any auth at all — every route is open. This is intentional for a public single-tenant demo, not an
  oversight, but it means every visitor can also trigger `/cases/:id/retry`, `/cases/:id/escalate`, and
  `/detection/scan`. Adding it back is a matter of a middleware check applied to `casesRouter`/
  `analyticsRouter`/`detectionRouter` in `index.ts` — it doesn't touch anything else in the pipeline.
- No DB-level protection against the payment path's *own* rare races beyond what Change 2 already covers;
  the new subscription/invoice `open_recovery_slots` mechanism only guards that path.
