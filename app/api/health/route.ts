import { getDb } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return Response.json({ ok: true, database: "connected" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    return Response.json(
      { ok: false, database: "unavailable", error: message },
      { status: 503 },
    );
  }
}
