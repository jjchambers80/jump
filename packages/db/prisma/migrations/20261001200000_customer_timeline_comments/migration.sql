CREATE TYPE "ContactCommentKind" AS ENUM ('COMMENT', 'EMAIL_CHANGED');

CREATE TABLE "ContactComment" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "kind" "ContactCommentKind" NOT NULL DEFAULT 'COMMENT',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactComment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContactComment_body_length" CHECK (char_length("body") BETWEEN 1 AND 2000)
);

CREATE INDEX "ContactComment_contactId_createdAt_idx" ON "ContactComment"("contactId", "createdAt");
CREATE INDEX "ContactComment_organizationId_createdAt_idx" ON "ContactComment"("organizationId", "createdAt");
CREATE INDEX "ContactComment_authorUserId_idx" ON "ContactComment"("authorUserId");

ALTER TABLE "ContactComment" ADD CONSTRAINT "ContactComment_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactComment" ADD CONSTRAINT "ContactComment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactComment" ADD CONSTRAINT "ContactComment_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
