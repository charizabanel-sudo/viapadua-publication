ALTER TABLE "bookings"
  ADD COLUMN "requested_date" DATE,
  ADD COLUMN "requested_time" VARCHAR(20),
  ADD COLUMN "reschedule_requested_at" TIMESTAMPTZ(6);
