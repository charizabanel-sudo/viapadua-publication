-- CreateTable
CREATE TABLE "payment_receipts" (
    "id" UUID NOT NULL,
    "serial" SERIAL NOT NULL,
    "receipt_number" VARCHAR(32) NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "snapshot" JSONB NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "document_id" UUID,
    "issued_at" TIMESTAMPTZ(6),
    "issued_by_id" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_serial_key" ON "payment_receipts"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_receipt_number_key" ON "payment_receipts"("receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_booking_id_key" ON "payment_receipts"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_document_id_key" ON "payment_receipts"("document_id");

-- CreateIndex
CREATE INDEX "payment_receipts_status_idx" ON "payment_receipts"("status");

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "private_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

