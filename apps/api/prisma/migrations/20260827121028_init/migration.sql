-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('PAYMENT', 'SUBSCRIPTION', 'INVOICE');

-- CreateEnum
CREATE TYPE "CasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DETECTED', 'INVESTIGATING', 'DECIDED', 'POLICY_APPROVED', 'POLICY_REJECTED', 'ACTION_SCHEDULED', 'ACTION_IN_PROGRESS', 'RECOVERED', 'FAILED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "RecoveryActionType" AS ENUM ('RETRY_PAYMENT', 'SEND_REMINDER', 'WAIT', 'ESCALATE_HUMAN');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditActor" AS ENUM ('RECOVERABILITY_ENGINE', 'INVESTIGATOR_AGENT', 'DECISION_AGENT', 'POLICY_ENGINE', 'ACTION_ENGINE', 'VERIFIER', 'SCHEDULER');

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "providerCustomerId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL,
    "nextPaymentAt" TIMESTAMP(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_cases" (
    "id" TEXT NOT NULL,
    "source" "SourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "paymentEventId" TEXT,
    "customerId" TEXT NOT NULL,
    "amountAtRisk" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "riskScore" DOUBLE PRECISION NOT NULL,
    "recoverabilityScore" DOUBLE PRECISION NOT NULL,
    "priority" "CasePriority" NOT NULL,
    "reason" TEXT,
    "recommendedAction" "RecoveryActionType",
    "status" "CaseStatus" NOT NULL DEFAULT 'DETECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_actions" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actionType" "RecoveryActionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_outcomes" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actionId" TEXT,
    "amountRecovered" DECIMAL(12,2) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "recoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_audit_logs" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actor" "AuditActor" NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_providerCustomerId_key" ON "customers"("providerCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerPaymentId_key" ON "payments"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_providerEventId_key" ON "payment_events"("providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_cases_paymentEventId_key" ON "recovery_cases"("paymentEventId");

-- CreateIndex
CREATE INDEX "recovery_cases_status_idx" ON "recovery_cases"("status");

-- CreateIndex
CREATE INDEX "recovery_cases_priority_idx" ON "recovery_cases"("priority");

-- CreateIndex
CREATE INDEX "recovery_actions_status_scheduledFor_idx" ON "recovery_actions"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "recovery_audit_logs_caseId_idx" ON "recovery_audit_logs"("caseId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_paymentEventId_fkey" FOREIGN KEY ("paymentEventId") REFERENCES "payment_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_actions" ADD CONSTRAINT "recovery_actions_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "recovery_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_outcomes" ADD CONSTRAINT "recovery_outcomes_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "recovery_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_outcomes" ADD CONSTRAINT "recovery_outcomes_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "recovery_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_audit_logs" ADD CONSTRAINT "recovery_audit_logs_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "recovery_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
