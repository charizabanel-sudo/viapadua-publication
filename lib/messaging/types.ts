/** Safe JSON contracts shared by the browser and messaging routes. */
export type ChatMessageDto = {
  id: number;
  sender: "guest" | "admin";
  text: string;
  createdAt: string;
  clientMessageId: string | null;
};
export type MessageDto = ChatMessageDto;

export type GuestThread = {
  id: string;
  displayName: string;
  contact: string | null;
  createdAt: string;
  lastMessageAt: string;
  expiresAt: string;
};

export type ChatSnapshot = {
  ok: true;
  thread: GuestThread | null;
  messages: ChatMessageDto[];
  unread: number;
  hasMore: boolean;
  nextBefore: number | null;
  /** Account chat only: the signed-in account has no usable name yet. */
  account?: { nameRequired: boolean };
};

export type ConversationSummary = {
  id: string;
  displayName: string;
  contact: string | null;
  lastMessageAt: string;
  lastMessage: string;
  unread: number;
  legacy: false;
};

export type LegacySummary = {
  id: string;
  email: string;
  displayName: string;
  contact: null;
  lastMessageAt: string;
  lastMessage: string;
  unread: number;
  legacy: true;
};

export type InboxSnapshot = {
  ok: true;
  conversations: ConversationSummary[];
  legacy: LegacySummary[];
  unread: number;
  hasMore: boolean;
  nextBefore: string | null;
  legacyHasMore: boolean;
  legacyNextBefore: string | null;
};

export type ChatFailure = { ok: false; error: string; code: string; retryAfter?: number };

export type GuestChatAction =
  | { op: "send"; text: string; clientMessageId: string; displayName?: string; contact?: string; conversationId?: string }
  | { op: "read"; messageId: number; conversationId?: string };

export type AccountChatAction =
  | { op: "send"; text: string; clientMessageId: string; accountName?: string; conversationId?: string }
  | { op: "read"; messageId: number; conversationId?: string };

export type AdminChatAction =
  | { op: "reply"; conversationId: string; text: string; clientMessageId: string }
  | { op: "read"; conversationId: string; messageId: number }
  | { op: "legacyRead"; legacyEmail: string; messageId: number };
