-- AlterTable
ALTER TABLE "EmployeeAdvance" ADD COLUMN IF NOT EXISTS "locationId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeAdvance_locationId_idx" ON "EmployeeAdvance"("locationId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeAdvance_locationId_fkey'
  ) THEN
    ALTER TABLE "EmployeeAdvance" ADD CONSTRAINT "EmployeeAdvance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
