-- CreateTable
CREATE TABLE "open_recovery_slots" (
    "id" TEXT NOT NULL,
    "source" "SourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_recovery_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "open_recovery_slots_caseId_key" ON "open_recovery_slots"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "open_recovery_slots_source_sourceId_key" ON "open_recovery_slots"("source", "sourceId");

-- AddForeignKey
ALTER TABLE "open_recovery_slots" ADD CONSTRAINT "open_recovery_slots_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "recovery_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
