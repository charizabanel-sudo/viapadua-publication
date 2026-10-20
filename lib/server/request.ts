import "server-only";
import { headers } from "next/headers";

/** Client IP for rate limiting. On Vercel, x-forwarded-for is set by the platform. */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip")?.trim() || "unknown";
}

export async function getUserAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}
