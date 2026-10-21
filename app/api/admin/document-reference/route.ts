import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { getCurrentAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import {
  readMessagingBody,
  messagingJson,
  messagingFailure,
} from "@/lib/server/messaging-http";
import { MessagingError } from "@/lib/messaging/store";
export async function POST(request: Request) {
  try {
    if (!(await getCurrentAdmin()))
      throw new MessagingError("unauthorized", "Sign in as staff.", 401);
    const input = z
      .object({
        bookingId: z.number().int().positive().optional(),
        requestId: z.uuid().optional(),
      })
      .strict()
      .refine((v) => Boolean(v.bookingId) !== Boolean(v.requestId))
      .parse(await readMessagingBody(request));
    const db = getDb();
    let reference: string;
    if (input.requestId) {
      reference = (
        await db.certificateRequest.findUniqueOrThrow({
          where: { id: input.requestId },
          select: { id: true },
        })
      ).id;
    } else {
      const b = await db.booking.findUniqueOrThrow({
        where: { id: input.bookingId! },
        select: { documentReference: true },
      });
      reference = b.documentReference ?? randomUUID();
      if (!b.documentReference) {
        await db.booking.updateMany({
          where: { id: input.bookingId!, documentReference: null },
          data: { documentReference: reference },
        });
        reference = (
          await db.booking.findUniqueOrThrow({
            where: { id: input.bookingId! },
            select: { documentReference: true },
          })
        ).documentReference!;
      }
    }
    const url = new URL("/admin/scanner", request.url);
    url.searchParams.set("reference", reference);
    return messagingJson({
      reference,
      qr: await QRCode.toDataURL(url.toString(), { width: 160, margin: 1 }),
    });
  } catch (e) {
    return messagingFailure(e);
  }
}
