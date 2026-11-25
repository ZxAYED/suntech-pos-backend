-- Additive migration: existing orders and v1 clients keep their original behavior.
ALTER TABLE "Order" ADD COLUMN "syncProtocol" INTEGER,
  ADD COLUMN "syncReceipt" JSONB,
  ADD COLUMN "syncWarnings" JSONB;

CREATE TABLE "OfflineDevice" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "OfflineDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OfflineDevice_deviceId_userId_businessId_locationId_key" ON "OfflineDevice"("deviceId", "userId", "businessId", "locationId");
CREATE INDEX "OfflineDevice_userId_businessId_locationId_idx" ON "OfflineDevice"("userId", "businessId", "locationId");

CREATE TABLE "OfflineGrant" (
  "id" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "claims" JSONB NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "OfflineGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OfflineGrant_tokenHash_key" ON "OfflineGrant"("tokenHash");
CREATE INDEX "OfflineGrant_enrollmentId_idx" ON "OfflineGrant"("enrollmentId");
ALTER TABLE "OfflineGrant" ADD CONSTRAINT "OfflineGrant_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "OfflineDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FinancialSaleIdentity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "businessId" TEXT,
  "locationId" TEXT,
  "protocol" TEXT NOT NULL,
  "legacyPath" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialSaleIdentity_pkey" PRIMARY KEY ("id")
);
