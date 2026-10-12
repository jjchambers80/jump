-- Spec 053-D (contract): application decision templates moved to
-- NotificationTemplate in 20261106120000; nothing reads this table any more.
DROP TABLE "ApplicationMessageTemplate";
DROP TYPE "ApplicationMessageScope";
