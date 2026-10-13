-- Volunteer shifts (spec 050 §6.4, card 050-R) are removed: no use case yet.
-- Volunteer forms keep working without them; any shift rows are discarded.
DROP TABLE "ApplicationShift";
DROP TABLE "VolunteerShift";
