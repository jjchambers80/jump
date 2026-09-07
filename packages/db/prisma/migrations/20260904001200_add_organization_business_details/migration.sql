ALTER TABLE "Organization"
ADD COLUMN "businessType" TEXT,
ADD COLUMN "nickname" TEXT,
ADD COLUMN "countryCode" TEXT DEFAULT 'US',
ADD COLUMN "addressLine1" TEXT,
ADD COLUMN "addressLine2" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "postalCode" TEXT,
ADD COLUMN "phoneCountryCode" TEXT DEFAULT '+1',
ADD COLUMN "phoneNumber" TEXT,
ADD COLUMN "ein" TEXT;
