BEGIN;

ALTER TABLE "Order"
  ADD COLUMN "clientOrderId" TEXT,
  ADD COLUMN "clientReceiptNumber" TEXT,
  ADD COLUMN "deviceId" TEXT,
  ADD COLUMN "occurredAt" TIMESTAMP(3);

UPDATE "Order"
SET "occurredAt" = "createdAt"
WHERE "occurredAt" IS NULL;

ALTER TABLE "Order"
  ALTER COLUMN "occurredAt" SET NOT NULL,
  ALTER COLUMN "occurredAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "Order_clientOrderId_key" ON "Order"("clientOrderId");
CREATE INDEX "Order_occurredAt_idx" ON "Order"("occurredAt");

COMMIT;
