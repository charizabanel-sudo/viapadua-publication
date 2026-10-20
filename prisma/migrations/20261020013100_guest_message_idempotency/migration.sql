-- Retries of a first message cannot create another conversation before a cookie arrives.
CREATE UNIQUE INDEX "guest_chat_messages_client_message_id_key" ON "guest_chat_messages"("client_message_id");
