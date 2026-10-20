-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "paid_at" TIMESTAMPTZ(6),
ADD COLUMN     "paid_by_id" INTEGER;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
