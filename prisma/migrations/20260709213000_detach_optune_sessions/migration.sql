-- DropForeignKey
ALTER TABLE "OptuneSession" DROP CONSTRAINT IF EXISTS "OptuneSession_dayId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "OptuneSession_dayId_idx";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OptuneSession_startAt_idx" ON "OptuneSession"("startAt");

-- DropColumn
ALTER TABLE "OptuneSession" DROP COLUMN IF EXISTS "dayId";
