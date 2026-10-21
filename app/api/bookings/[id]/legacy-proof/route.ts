import { fileTypeFromBuffer } from "file-type";
import { getActor } from "@/lib/server/user-auth";
import { canAccessBooking } from "@/lib/server/documents";
import { getDb } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id),
    headers = {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    };
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    !(await canAccessBooking(await getActor(), id))
  )
    return new Response("Document unavailable", { status: 404, headers });
  const b = await getDb().booking.findUnique({
    where: { id },
    select: { paymentProof: true },
  });
  const match = b?.paymentProof?.match(
    /^data:(?:image\/(?:png|jpeg)|application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/,
  );
  if (!match || match[1].length > 16 * 1024 * 1024)
    return new Response("No supported historical payment evidence", {
      status: 404,
      headers,
    });
  const bytes = Buffer.from(match[1], "base64"),
    type = await fileTypeFromBuffer(bytes);
  if (
    !type ||
    !["image/png", "image/jpeg", "application/pdf"].includes(type.mime)
  )
    return new Response("Document unavailable", { status: 404, headers });
  return new Response(bytes, {
    headers: {
      ...headers,
      "Content-Type": type.mime,
      "Content-Disposition": `attachment; filename="historical-payment-evidence.${type.ext}"`,
    },
  });
}
