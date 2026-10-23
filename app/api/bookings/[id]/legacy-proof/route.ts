import { fileTypeFromBuffer } from "file-type";
import { getActor } from "@/lib/server/user-auth";
import { canAccessBooking } from "@/lib/server/documents";
import { fileError, fileResponse } from "@/lib/server/file-response";
import { getDb } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  const actor = await getActor();
  if (!actor.adminId && !actor.userId && !actor.guestHash)
    return fileError("Sign in again to open this document.", 401);
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    !(await canAccessBooking(actor, id))
  )
    return fileError("Document unavailable", 404);
  const b = await getDb().booking.findUnique({
    where: { id },
    select: { paymentProof: true },
  });
  const match = b?.paymentProof?.match(
    /^data:(?:image\/(?:png|jpeg)|application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/,
  );
  if (!match || match[1].length > 16 * 1024 * 1024)
    return fileError("No supported historical payment evidence", 404);
  const bytes = Buffer.from(match[1], "base64"),
    type = await fileTypeFromBuffer(bytes);
  if (
    !type ||
    !["image/png", "image/jpeg", "application/pdf"].includes(type.mime)
  )
    return fileError("Document unavailable", 404);
  return fileResponse(bytes, {
    mime: type.mime,
    filename: `historical-payment-evidence.${type.ext}`,
    inline: new URL(request.url).searchParams.get("preview") === "1",
  });
}
