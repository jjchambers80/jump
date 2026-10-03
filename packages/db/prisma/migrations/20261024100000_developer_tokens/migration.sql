-- Spec 043: developer tokens for the Jump CLI.
CREATE TABLE "DeveloperToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeveloperToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeveloperAuthCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeveloperAuthCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeveloperToken_tokenHash_key" ON "DeveloperToken"("tokenHash");
CREATE INDEX "DeveloperToken_organizationId_idx" ON "DeveloperToken"("organizationId");
CREATE INDEX "DeveloperToken_userId_idx" ON "DeveloperToken"("userId");
CREATE UNIQUE INDEX "DeveloperAuthCode_codeHash_key" ON "DeveloperAuthCode"("codeHash");

ALTER TABLE "DeveloperToken" ADD CONSTRAINT "DeveloperToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeveloperToken" ADD CONSTRAINT "DeveloperToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
