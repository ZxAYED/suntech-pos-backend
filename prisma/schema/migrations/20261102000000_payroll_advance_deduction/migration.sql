-- AlterTable EmployeeAdvance
ALTER TABLE "EmployeeAdvance" ADD COLUMN IF NOT EXISTS "deductedAmount" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing DEDUCTED advances
UPDATE "EmployeeAdvance" SET "deductedAmount" = "amount" WHERE "status" = 'DEDUCTED' AND "deductedAmount" = 0;

-- CreateTable PayrollAdvanceDeduction
CREATE TABLE IF NOT EXISTS "PayrollAdvanceDeduction" (
    "id" TEXT NOT NULL,
    "payrollId" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollAdvanceDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollAdvanceDeduction_payrollId_idx" ON "PayrollAdvanceDeduction"("payrollId");
CREATE INDEX IF NOT EXISTS "PayrollAdvanceDeduction_advanceId_idx" ON "PayrollAdvanceDeduction"("advanceId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PayrollAdvanceDeduction_payrollId_fkey'
  ) THEN
    ALTER TABLE "PayrollAdvanceDeduction" ADD CONSTRAINT "PayrollAdvanceDeduction_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "PayrollRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PayrollAdvanceDeduction_advanceId_fkey'
  ) THEN
    ALTER TABLE "PayrollAdvanceDeduction" ADD CONSTRAINT "PayrollAdvanceDeduction_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "EmployeeAdvance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
