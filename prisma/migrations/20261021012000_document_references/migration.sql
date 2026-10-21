-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "document_reference" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "bookings_document_reference_key" ON "bookings"("document_reference");
