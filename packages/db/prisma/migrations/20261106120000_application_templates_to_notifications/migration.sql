-- Spec 053-D (expand): application decision templates now live in
-- NotificationTemplate under key application.<event|standing>.<ACTION>.
-- ApplicationMessageTemplate is left in place, unread, and is dropped in a
-- later migration once this deploy is live.
INSERT INTO "NotificationTemplate" ("id", "organizationId", "key", "subject", "body", "enabled", "updatedAt")
SELECT
  'ntapp' || md5("id"),
  "organizationId",
  'application.' || lower("scope"::text) || '.' || "action"::text,
  "subject",
  "body",
  true,
  "updatedAt"
FROM "ApplicationMessageTemplate"
ON CONFLICT ("organizationId", "key") DO NOTHING;
