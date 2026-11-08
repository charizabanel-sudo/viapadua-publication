import { z } from "zod";
import { getCurrentAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import {
  findDocumentReference,
  suggestCertificateRequests,
  suggestBookings,
  attachScan,
} from "@/lib/documents/scans";
import {
  messagingJson,
  messagingFailure,
  readMessagingBody,
} from "@/lib/server/messaging-http";
import { MessagingError } from "@/lib/messaging/store";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    if (!(await getCurrentAdmin()))
      throw new MessagingError("unauthorized", "Sign in as staff.", 401);
    const p = new URL(request.url).searchParams;
    const db = getDb();
    const text = (p.get("text") ?? "").slice(0, 2000);
    const query = p.get("q") ?? "";
    const [bookings, certificateRequests] = await Promise.all([
      suggestBookings(db, text, query),
      suggestCertificateRequests(db, text, query),
    ]);
    return messagingJson({
      candidates: [...bookings, ...certificateRequests],
      resolved: p.get("reference")
        ? await findDocumentReference(db, p.get("reference")!)
        : null,
    });
  } catch (e) {
    return messagingFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    const admin = await getCurrentAdmin();
    if (!admin)
      throw new MessagingError("unauthorized", "Sign in as staff.", 401);
    const parsed = z
      .object({
        documentId: z.uuid(),
        bookingId: z.number().int().positive().optional(),
        requestId: z.uuid().optional(),
        note: z.string().min(10).max(1000),
      })
      .strict()
      .parse(await readMessagingBody(request));
    await attachScan(getDb(), { ...parsed, adminId: admin.id });
    return messagingJson({ ok: true });
  } catch (e) {
    return messagingFailure(
      e instanceof MessagingError
        ? e
        : new MessagingError(
            "invalid_attachment",
            e instanceof Error ? e.message : "Attachment failed.",
          ),
    );
  }
}
