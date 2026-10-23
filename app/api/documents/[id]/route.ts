import { z } from "zod";
import { canReadDocument } from "@/lib/server/documents";
import { fileError, fileResponse } from "@/lib/server/file-response";
import { getActor } from "@/lib/server/user-auth";
import { getDb } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const actor = await getActor();
  // Without any session the visitor must sign in again; existence of the file is not revealed.
  if (!actor.adminId && !actor.userId && !actor.guestHash)
    return fileError("Sign in again to open this document.", 401);
  if (!z.uuid().safeParse(id).success || !(await canReadDocument(actor, id)))
    return fileError("Document unavailable", 404);
  const d = await getDb().privateDocument.findUnique({
    where: { id },
    select: { content: true, mime: true, filename: true },
  });
  if (!d?.content?.length) return fileError("Document unavailable", 404);
  return fileResponse(d.content, {
    mime: d.mime,
    filename: d.filename,
    inline: new URL(request.url).searchParams.get("preview") === "1",
  });
}
