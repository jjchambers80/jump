-- Spec 053-B: optional notifications (the RSVP reminder) can be switched off.
ALTER TABLE "NotificationTemplate" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
