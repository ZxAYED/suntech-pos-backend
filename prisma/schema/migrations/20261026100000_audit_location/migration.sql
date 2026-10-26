ALTER TABLE "AuditLog" ADD COLUMN "locationId" TEXT;
CREATE INDEX "AuditLog_locationId_idx" ON "AuditLog"("locationId");
