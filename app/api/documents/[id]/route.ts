import { z } from "zod";
import { canReadDocument } from "@/lib/server/documents";
import { getActor } from "@/lib/server/user-auth";
import { getDb } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  };
  if (
    !z.uuid().safeParse(id).success ||
    !(await canReadDocument(await getActor(), id))
  )
    return new Response("Document unavailable", { status: 404, headers });
  const d = await getDb().privateDocument.findUniqueOrThrow({ where: { id } });
  const inline = new URL(request.url).searchParams.get("preview") === "1";
  return new Response(new Uint8Array(d.content), {
    headers: {
      ...headers,
      "Content-Type": d.mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${d.filename.replace(/["\r\n]/g, "_")}"`,
    },
  });
}
