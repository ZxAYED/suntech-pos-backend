BEGIN;

ALTER TABLE "Order"
  ADD COLUMN "syncPayloadHash" TEXT;

CREATE INDEX "Order_syncPayloadHash_idx" ON "Order"("syncPayloadHash");

COMMIT;

