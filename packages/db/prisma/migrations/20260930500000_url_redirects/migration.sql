-- Spec 028: Content › URL redirects.
CREATE TABLE "UrlRedirect" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UrlRedirect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UrlRedirect_organizationId_fromPath_key" ON "UrlRedirect"("organizationId", "fromPath");

ALTER TABLE "UrlRedirect" ADD CONSTRAINT "UrlRedirect_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
