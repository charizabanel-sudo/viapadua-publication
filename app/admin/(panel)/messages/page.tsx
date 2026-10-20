import AdminMessages from "@/components/messaging/AdminMessages";
import { requireAdmin } from "@/lib/server/auth";

export default async function MessagesPage() {
  await requireAdmin();
  return <><header className="page-header"><h1>Messages</h1><p>Reply to guests and review parish conversation history.</p></header><AdminMessages /></>;
}
