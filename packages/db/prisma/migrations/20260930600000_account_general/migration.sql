-- Spec 030 feature A: account settings › General
ALTER TABLE "User"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en-US',
  ADD COLUMN "timeZone" TEXT,
  ADD COLUMN "avatarImageId" TEXT,
  ADD COLUMN "pendingEmail" TEXT;

CREATE UNIQUE INDEX "User_avatarImageId_key" ON "User"("avatarImageId");

ALTER TABLE "User" ADD CONSTRAINT "User_avatarImageId_fkey"
  FOREIGN KEY ("avatarImageId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;
