-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "guest_conversations" ADD COLUMN     "user_id" INTEGER;

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" VARCHAR(64) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_booking_access" (
    "booking_id" INTEGER NOT NULL,
    "credential_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guest_booking_access_pkey" PRIMARY KEY ("booking_id")
);

-- CreateTable
CREATE TABLE "certificate_requests" (
    "id" UUID NOT NULL,
    "client_request_id" UUID NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "user_id" INTEGER,
    "guest_hash" VARCHAR(64),
    "guest_expires_at" TIMESTAMPTZ(6),
    "booking_id" INTEGER,
    "type" VARCHAR(30) NOT NULL,
    "requester_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "details" JSONB NOT NULL,
    "certificate" JSONB,
    "fee" DECIMAL(10,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "admin_note" VARCHAR(1000),
    "reviewed_by_id" INTEGER,
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_claims" (
    "id" UUID NOT NULL,
    "user_id" INTEGER NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "evidence" VARCHAR(1000) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "booking_id" INTEGER,
    "reviewed_by_id" INTEGER,
    "review_note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),

    CONSTRAINT "booking_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "private_documents" (
    "id" UUID NOT NULL,
    "reference" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "filename" VARCHAR(150) NOT NULL,
    "mime" VARCHAR(80) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "booking_id" INTEGER,
    "request_id" UUID,
    "user_id" INTEGER,
    "guest_hash" VARCHAR(64),
    "uploaded_by_id" INTEGER,
    "released" BOOLEAN NOT NULL DEFAULT false,
    "extracted_text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "private_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_audit" (
    "id" SERIAL NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "target_id" VARCHAR(80) NOT NULL,
    "admin_id" INTEGER,
    "user_id" INTEGER,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "guest_booking_access_credential_hash_idx" ON "guest_booking_access"("credential_hash");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_requests_client_request_id_key" ON "certificate_requests"("client_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_requests_reference_key" ON "certificate_requests"("reference");

-- CreateIndex
CREATE INDEX "certificate_requests_user_id_created_at_idx" ON "certificate_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "certificate_requests_status_created_at_idx" ON "certificate_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "booking_claims_status_created_at_idx" ON "booking_claims"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_claims_user_id_reference_key" ON "booking_claims"("user_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "private_documents_reference_key" ON "private_documents"("reference");

-- CreateIndex
CREATE INDEX "private_documents_booking_id_idx" ON "private_documents"("booking_id");

-- CreateIndex
CREATE INDEX "private_documents_request_id_idx" ON "private_documents"("request_id");

-- CreateIndex
CREATE INDEX "private_documents_user_id_idx" ON "private_documents"("user_id");

-- CreateIndex
CREATE INDEX "portal_audit_target_id_created_at_idx" ON "portal_audit"("target_id", "created_at");

-- CreateIndex
CREATE INDEX "guest_conversations_user_id_idx" ON "guest_conversations"("user_id");

-- AddForeignKey
ALTER TABLE "guest_conversations" ADD CONSTRAINT "guest_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_booking_access" ADD CONSTRAINT "guest_booking_access_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_requests" ADD CONSTRAINT "certificate_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_requests" ADD CONSTRAINT "certificate_requests_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_requests" ADD CONSTRAINT "certificate_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_claims" ADD CONSTRAINT "booking_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_claims" ADD CONSTRAINT "booking_claims_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_claims" ADD CONSTRAINT "booking_claims_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_documents" ADD CONSTRAINT "private_documents_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_documents" ADD CONSTRAINT "private_documents_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "certificate_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_documents" ADD CONSTRAINT "private_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_documents" ADD CONSTRAINT "private_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
