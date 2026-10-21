export class ChatHttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function chatRequest<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch(url, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  }); } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("We could not reach the parish office. Please try again.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new ChatHttpError(result?.error || "Messages could not be loaded. Please try again.", response.status);
  return result as T;
}

export function messageTime(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}
