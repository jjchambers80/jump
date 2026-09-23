-- RSVP reminder email sweep (spec 034 §9.2)
-- Add remindedAt column to EventRsvp for idempotent reminder stamps.
ALTER TABLE "EventRsvp" ADD COLUMN "remindedAt" TIMESTAMP(3);