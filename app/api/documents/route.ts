import { z } from "zod";
import { validateFile, MAX_FILE_BYTES } from "@/lib/documents/files";
import { ownsRecord } from "@/lib/portal/access";
import { getActor } from "@/lib/server/user-auth";
import { canAccessBooking } from "@/lib/server/documents";
import { getDb } from "@/lib/server/db";
import { isSameOriginMutation } from "@/lib/messaging/validation";
import { MessagingError } from "@/lib/messaging/store";
import { messagingJson, messagingFailure } from "@/lib/server/messaging-http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    if (!isSameOriginMutation(request))
      throw new MessagingError("origin", "Use this website to upload.", 403);
    const actor = await getActor(),
      db = getDb();
    if (!actor.adminId && !actor.userId && !actor.guestHash)
      throw new MessagingError(
        "unauthorized",
        "Sign in or submit a booking first.",
        401,
      );
    if (Number(request.headers.get("content-length")) > MAX_FILE_BYTES + 20000)
      throw new MessagingError("size", "Files must be up to 3 MB.", 413);
    // Enforce the bound even when a client omits Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw Error("Choose a file.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_FILE_BYTES + 20000) {
          await reader.cancel();
          throw new MessagingError("size", "Files must be up to 3 MB.", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      body: Buffer.concat(chunks),
    }).formData();
    const file = form.get("file"),
      kind = String(form.get("kind") ?? "payment_proof");
    if (!(file instanceof File)) throw Error("Choose a file.");
    if (!actor.adminId && kind !== "payment_proof")
      throw new MessagingError("forbidden", "Staff approval is required.", 403);
    if (!["payment_proof", "receipt", "certificate", "scan"].includes(kind))
      throw Error("Choose a document type.");
    const bookingId = form.get("bookingId")
      ? z.coerce.number().int().positive().parse(form.get("bookingId"))
      : undefined;
    const requestId = form.get("requestId")
      ? z.uuid().parse(form.get("requestId"))
      : undefined;
    if (bookingId && !(await canAccessBooking(actor, bookingId)))
      throw new MessagingError("not_found", "Booking unavailable.", 404);
    const cert = requestId
      ? await db.certificateRequest.findUnique({ where: { id: requestId } })
      : null;
    if (requestId && (!cert || !ownsRecord(actor, cert)))
      throw new MessagingError("not_found", "Request unavailable.", 404);
    if (!actor.adminId && !bookingId && !requestId)
      throw Error("Select your booking or request.");
    const valid = await validateFile(file);
    if (kind === "certificate" && valid.mime !== "application/pdf")
      throw Error("Released certificates must be PDF files.");
    if (
      ["certificate", "receipt"].includes(kind) &&
      form.get("verified") !== "true"
    )
      throw Error(
        "Confirm that you checked the parish record or official receipt.",
      );
    const release = ["certificate", "receipt"].includes(kind);
    const result = await db.$transaction(async (tx) => {
      if (bookingId)
        await tx.$executeRaw`SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE`;
      if (requestId)
        await tx.$executeRaw`SELECT id FROM certificate_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
      const booking = bookingId
        ? await tx.booking.findUnique({ where: { id: bookingId } })
        : null;
      const current = requestId
        ? await tx.certificateRequest.findUnique({ where: { id: requestId } })
        : null;
      if (
        kind === "certificate" &&
        (requestId
          ? !current || current.status !== "processing"
          : !booking ||
            (booking.status !== "completed" && !booking.certificate))
      )
        throw Error("Verify and process the parish record before release.");
      if (kind === "receipt" && (!booking || booking.paymentStatus !== "paid"))
        throw Error("Verify payment before releasing an official receipt.");
      // One active receipt per payment: a generated parish receipt already covers this booking.
      if (kind === "receipt" && booking && (await tx.paymentReceipt.count({ where: { bookingId: booking.id } })))
        throw Error("This payment already has a parish payment receipt.");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`upload:${actor.adminId ? "a" + actor.adminId : actor.userId ? "u" + actor.userId : actor.guestHash}`}))`;
      // Bound private storage abuse per owner/network credential and retain immutable payment evidence.
      const scope = actor.adminId
        ? { uploadedById: actor.adminId }
        : actor.userId
          ? { userId: actor.userId }
          : { guestHash: actor.guestHash! };
      if (
        (await tx.privateDocument.count({
          where: {
            ...scope,
            createdAt: { gt: new Date(Date.now() - 3600000) },
          },
        })) >= 30
      )
        throw new MessagingError(
          "rate_limited",
          "Upload limit reached. Please try again later.",
          429,
        );
      const d = await tx.privateDocument.create({
        data: {
          kind,
          filename: valid.filename,
          mime: valid.mime,
          size: valid.size,
          sha256: valid.sha256,
          content: valid.bytes,
          bookingId,
          requestId,
          userId: booking?.userId ?? current?.userId ?? actor.userId,
          guestHash: actor.guestHash,
          uploadedById: actor.adminId,
          released: release,
          extractedText: actor.adminId
            ? String(form.get("extractedText") ?? "").slice(0, 12000)
            : null,
        },
      });
      if (current && kind === "certificate")
        await tx.certificateRequest.update({
          where: { id: current.id },
          data: {
            status: "released",
            reviewedById: actor.adminId,
            releasedAt: new Date(),
          },
        });
      await tx.portalAudit.create({
        data: {
          action: release ? `${kind}_released` : `${kind}_uploaded`,
          targetId: d.id,
          adminId: actor.adminId,
          userId: actor.userId,
          detail: {
            bookingId: bookingId ?? null,
            requestId: requestId ?? null,
            sha256: valid.sha256,
          },
        },
      });
      return d.id;
    });
    return messagingJson({ ok: true, id: result });
  } catch (e) {
    return messagingFailure(
      e instanceof MessagingError
        ? e
        : new MessagingError(
            "invalid_upload",
            e instanceof Error ? e.message : "Upload failed.",
          ),
    );
  }
}
