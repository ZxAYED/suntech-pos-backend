-- Additive: no existing table, stock, sale, or refund rows are modified.
CREATE TABLE "OfflineCommandReceipt" (
 "clientCommandId" TEXT NOT NULL PRIMARY KEY, "kind" TEXT NOT NULL,
 "userId" TEXT NOT NULL, "businessId" TEXT NOT NULL, "locationId" TEXT NOT NULL,
 "deviceId" TEXT NOT NULL, "payloadHash" TEXT NOT NULL,
 "occurredAt" TIMESTAMP(3) NOT NULL, "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "evidence" JSONB NOT NULL, "result" JSONB NOT NULL
);
CREATE INDEX "OfflineCommandReceipt_userId_businessId_locationId_deviceId_idx" ON "OfflineCommandReceipt"("userId", "businessId", "locationId", "deviceId");
