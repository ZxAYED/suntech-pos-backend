-- AlterTable User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isLoggedIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLogoutAt" TIMESTAMP(3);

-- Backfill existing users as logged out
UPDATE "User" SET "isLoggedIn" = false, "sessionId" = NULL WHERE "isLoggedIn" IS NULL OR "isLoggedIn" = true;

-- AlterTable ShiftSession
ALTER TABLE "ShiftSession" ADD COLUMN IF NOT EXISTS "autoCloseReason" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShiftSession_cashierId_openedAt_idx" ON "ShiftSession"("cashierId", "openedAt");

