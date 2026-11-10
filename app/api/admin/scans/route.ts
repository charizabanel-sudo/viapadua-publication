import { z } from "zod";
import { getCurrentAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import {
  findDocumentReference,
  suggestCertificateRequests,
  suggestBookings,
  suggestUsers,
  selectUniqueScanMatch,
  attachScan,
} from "@/lib/documents/scans";
import {
  messagingJson,
  messagingFailure,
  readMessagingBody,
} from "@/lib/server/messaging-http";
import { MessagingError } from "@/lib/messaging/store";
export const dynamic = "force-dynamic";

const matchSchema = z
  .object({
    action: z.literal("match"),
    text: z.string().max(12000).default(""),
    q: z.string().max(100).default(""),
    reference: z.string().max(64).default(""),
  })
  .strict();

const attachSchema = z
  .object({
    documentId: z.uuid(),
    bookingId: z.number().int().positive().optional(),
    requestId: z.uuid().optional(),
    userId: z.number().int().positive().optional(),
    note: z.string().min(10).max(1000),
  })
  .strict();

async function runMatch(input: { text: string; q: string; reference: string }) {
  const db = getDb();
  const [bookings, requests, resolved] = await Promise.all([
    suggestBookings(db, input.text, input.q),
    suggestCertificateRequests(db, input.text, input.q),
    input.reference
      ? findDocumentReference(db, input.reference)
      : Promise.resolve(null),
  ]);
  const recordCandidates = [...bookings, ...requests];
  if (resolved && resolved.kind !== "document") {
    return { candidates: [], resolved };
  }
  const referenceMatch = recordCandidates.find(
    (candidate) =>
      candidate.score === 100 &&
      candidate.evidence.toLowerCase().includes("reference"),
  );
  const userCandidates = selectUniqueScanMatch(
    await suggestUsers(db, input.text, input.q),
  );
  const recordCandidatesUnique = selectUniqueScanMatch(recordCandidates);
  const strongRecordMatch = recordCandidatesUnique[0]?.score >= 90;
  const candidates = referenceMatch
    ? [referenceMatch]
    : strongRecordMatch
      ? recordCandidatesUnique
      : userCandidates.length
        ? userCandidates
        : recordCandidatesUnique;
  return {
    candidates,
    resolved: resolved?.kind === "document" && candidates.length ? null : resolved,
  };
}

export async function GET(request: Request) {
  try {
    if (!(await getCurrentAdmin()))
      throw new MessagingError("unauthorized", "Sign in as staff.", 401);
    const p = new URL(request.url).searchParams;
    return messagingJson(
      await runMatch({
        text: (p.get("text") ?? "").slice(0, 12000),
        q: p.get("q") ?? "",
        reference: p.get("reference") ?? "",
      }),
    );
  } catch (e) {
    return messagingFailure(e);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await getCurrentAdmin();
    if (!admin)
      throw new MessagingError("unauthorized", "Sign in as staff.", 401);
    const raw = await readMessagingBody(request);
    // Long OCR text is sent by POST (action: "match"); anything else is an attach.
    const match = matchSchema.safeParse(raw);
    if (match.success) return messagingJson(await runMatch(match.data));
    const parsed = attachSchema.parse(raw);
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