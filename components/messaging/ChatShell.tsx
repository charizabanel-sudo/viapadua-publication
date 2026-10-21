"use client";
import { useSearchParams } from "next/navigation";
import GuestChat from "./GuestChat";
export default function ChatShell({
  accountUserId,
}: {
  accountUserId?: number;
}) {
  const params = useSearchParams(),
    thread = accountUserId ? (params.get("thread") ?? undefined) : undefined;
  return (
    <GuestChat
      key={`${accountUserId ?? "guest"}:${thread ?? "latest"}`}
      accountUserId={accountUserId}
      conversationId={thread}
    />
  );
}
