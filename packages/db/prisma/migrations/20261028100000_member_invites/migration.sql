-- Settings › Users: invited members and the "secure sign-in method" requirement
ALTER TABLE "OrganizationMember" ADD COLUMN "invitedAt" TIMESTAMP(3),
ADD COLUMN "invitedById" TEXT,
ADD COLUMN "requireTwoStep" BOOLEAN NOT NULL DEFAULT false;
