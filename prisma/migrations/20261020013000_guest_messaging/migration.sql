-- Add guest messaging without changing historical chat, accounts or bookings.
CREATE TABLE "guest_chat_sessions" (
  "id" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guest_chat_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guest_conversations" (
  "id" UUID NOT NULL,
  "session_id" VARCHAR(64) NOT NULL,
  "display_name" VARCHAR(80) NOT NULL,
  "contact" VARCHAR(120),
  "guest_last_read_id" INTEGER NOT NULL DEFAULT 0,
  "admin_last_read_id" INTEGER NOT NULL DEFAULT 0,
  "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guest_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "guest_conversations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "guest_chat_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "guest_chat_messages" (
  "id" SERIAL NOT NULL,
  "conversation_id" UUID NOT NULL,
  "client_message_id" UUID NOT NULL,
  "sender" "ChatSender" NOT NULL,
  "text" VARCHAR(2000) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guest_chat_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "guest_chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "guest_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "guest_chat_sessions_expires_at_idx" ON "guest_chat_sessions"("expires_at");
CREATE UNIQUE INDEX "guest_conversations_session_id_key" ON "guest_conversations"("session_id");
CREATE INDEX "guest_conversations_last_message_at_id_idx" ON "guest_conversations"("last_message_at", "id");
CREATE UNIQUE INDEX "guest_chat_messages_conversation_id_client_message_id_key" ON "guest_chat_messages"("conversation_id", "client_message_id");
CREATE INDEX "guest_chat_messages_conversation_id_id_idx" ON "guest_chat_messages"("conversation_id", "id");
