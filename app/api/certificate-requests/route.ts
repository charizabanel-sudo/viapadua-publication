import { randomUUID } from "node:crypto";
import { requestSchema, certificateTypes } from "@/lib/certificates/requests";
import { ownsRecord } from "@/lib/portal/access";
import { bucketKey, countEvents, recordEvents } from "@/lib/auth/rate-limit";
import { generateBookingReference } from "@/lib/booking/reference";
import { getDb } from "@/lib/server/db";
import { getActor, guestAccess } from "@/lib/server/user-auth";
import { getClientIp } from "@/lib/server/request";
import { getAuthSecret } from "@/lib/server/env";
import {
  messagingJson,
  messagingFailure,
  readMessagingBody,
} from "@/lib/server/messaging-http";
import { MessagingError } from "@/lib/messaging/store";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor.userId && !actor.guestHash)
      return messagingJson({ requests: [] });
    const rows = await getDb().certificateRequest.findMany({
      where: {
        OR: [
          ...(actor.userId ? [{ userId: actor.userId }] : []),
          ...(actor.guestHash
            ? [
                {
                  userId: null,
                  guestHash: actor.guestHash,
                  guestExpiresAt: { gt: new Date() },
                },
              ]
            : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        documents: {
          where: { kind: "certificate", released: true },
          select: { id: true },
        },
      },
    });
    return messagingJson({
      requests: rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        type: r.type,
        status: r.status,
        note: r.adminNote,
        fee: Number(r.fee),
        documents: r.documents,
      })),
    });
  } catch (e) {
    return messagingFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await readMessagingBody(request));
    if (!parsed.success)
      throw new MessagingError(
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Check the request.",
      );
    const db = getDb(),
      actor = await getActor(),
      input = parsed.data;
    const guest = actor.userId ? undefined : await guestAccess(true);
    const owner = { ...actor, guestHash: guest?.hash ?? actor.guestHash };
    const bucket = bucketKey(
      getAuthSecret(),
      "certificate:ip",
      await getClientIp(),
    );
    const saved = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bucket}))`;
      const previous = await tx.certificateRequest.findUnique({
        where: { clientRequestId: input.clientRequestId },
      });
      if (previous) {
        if (!ownsRecord(owner, previous))
          throw new MessagingError("not_found", "Request unavailable.", 404);
        return previous;
      }
      if ((await countEvents(tx, bucket, 3600000)) >= 10)
        throw new MessagingError(
          "rate_limited",
          "Please contact the parish office or try again later.",
          429,
        );
      const { requesterName, email, phone, type, clientRequestId, ...details } =
        input;
      const row = await tx.certificateRequest.create({
        data: {
          id: randomUUID(),
          clientRequestId,
          reference: generateBookingReference(),
          userId: actor.userId,
          guestHash: guest?.hash,
          guestExpiresAt: guest?.expiresAt,
          type,
          requesterName,
          email,
          phone,
          details,
          fee: certificateTypes.find((c) => c.type === type)!.fee,
        },
      });
      await tx.portalAudit.create({
        data: {
          action: "certificate_requested",
          targetId: row.id,
          userId: actor.userId,
        },
      });
      await recordEvents(tx, [bucket], true);
      return row;
    });
    return messagingJson({
      ok: true,
      id: saved.id,
      reference: saved.reference,
      status: saved.status,
    });
  } catch (e) {
    return messagingFailure(e);
  }
}
