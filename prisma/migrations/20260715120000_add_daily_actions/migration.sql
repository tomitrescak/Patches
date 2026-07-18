-- CreateEnum
CREATE TYPE "DailyActionType" AS ENUM ('EXERCISE', 'MEDICINE');

-- CreateTable
CREATE TABLE "DailyAction" (
    "id" TEXT NOT NULL,
    "type" "DailyActionType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyAction_occurredAt_idx" ON "DailyAction"("occurredAt");

-- CreateIndex
CREATE INDEX "DailyAction_type_idx" ON "DailyAction"("type");
