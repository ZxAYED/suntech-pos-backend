-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ExpenseSourceType" AS ENUM ('MANUAL', 'SALARY_ADVANCE', 'PAYROLL_NET');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable: Add columns to Expense
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "sourceType" "ExpenseSourceType" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "beneficiaryCashierId" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "advanceId" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "payrollId" TEXT;

-- CreateUniqueIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Expense_advanceId_key" ON "Expense"("advanceId");
CREATE UNIQUE INDEX IF NOT EXISTS "Expense_payrollId_key" ON "Expense"("payrollId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_beneficiaryCashierId_fkey" FOREIGN KEY ("beneficiaryCashierId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "EmployeeAdvance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "PayrollRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Expense_beneficiaryCashierId_idx" ON "Expense"("beneficiaryCashierId");
CREATE INDEX IF NOT EXISTS "Expense_sourceType_idx" ON "Expense"("sourceType");
CREATE INDEX IF NOT EXISTS "Expense_category_idx" ON "Expense"("category");
