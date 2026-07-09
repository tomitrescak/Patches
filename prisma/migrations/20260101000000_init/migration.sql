-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "PatchDay" (
    "id" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "patchChanged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatchDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptuneSession" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptuneSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatchDay_dateKey_key" ON "PatchDay"("dateKey");

-- CreateIndex
CREATE INDEX "OptuneSession_dayId_idx" ON "OptuneSession"("dayId");

-- CreateIndex
CREATE INDEX "OptuneSession_endAt_idx" ON "OptuneSession"("endAt");

-- AddForeignKey
ALTER TABLE "OptuneSession" ADD CONSTRAINT "OptuneSession_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "PatchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
