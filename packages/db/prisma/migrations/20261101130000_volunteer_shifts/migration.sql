-- Spec 050 §6.4 (card 050-R): volunteer shifts on VOLUNTEER forms and the
-- applicant's picks. New tables only, no backfill.
-- CreateTable
CREATE TABLE "VolunteerShift" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "capacity" INTEGER,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationShift" (
    "applicationId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "assigned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationShift_pkey" PRIMARY KEY ("applicationId","shiftId")
);

-- CreateIndex
CREATE INDEX "VolunteerShift_formId_displayOrder_idx" ON "VolunteerShift"("formId", "displayOrder");

-- CreateIndex
CREATE INDEX "ApplicationShift_shiftId_assigned_idx" ON "ApplicationShift"("shiftId", "assigned");

-- AddForeignKey
ALTER TABLE "VolunteerShift" ADD CONSTRAINT "VolunteerShift_formId_fkey" FOREIGN KEY ("formId") REFERENCES "ApplicationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationShift" ADD CONSTRAINT "ApplicationShift_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationShift" ADD CONSTRAINT "ApplicationShift_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "VolunteerShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

