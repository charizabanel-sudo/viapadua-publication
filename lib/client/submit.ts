"use client";

export const SUBMIT_TIMEOUT_MS = 30_000;

/** The server answered (with any status) and its JSON body, or the outcome is unknown. */
export type SubmitOutcome<T> =
  | { kind: "answered"; status: number; data: T | null }
  | { kind: "uncertain"; reason: "timeout" | "network" };

/**
 * POST that never spins forever: it is aborted after a timeout, and network failures or
 * non-JSON error pages are reported as "uncertain" or as an answered status without a body.
 */
export async function submitJson<T>(url: string, init: RequestInit, timeoutMs = SUBMIT_TIMEOUT_MS): Promise<SubmitOutcome<T>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal });
    let data: T | null = null;
    if ((response.headers.get("content-type") ?? "").includes("application/json")) {
      try {
        data = (await response.json()) as T;
      } catch {
        data = null;
      }
    }
    // A 2xx without a readable body means the outcome is unknown, not failed.
    if (response.ok && data === null) return { kind: "uncertain", reason: "network" };
    return { kind: "answered", status: response.status, data };
  } catch {
    return { kind: "uncertain", reason: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    window.clearTimeout(timer);
  }
}

export const UNCERTAIN_MESSAGE =
  "We couldn't confirm your request because the connection was slow or interrupted. It may already be saved. Press submit again to check — it will not be duplicated.";

/** Readable message for an answered failure without a usable body (e.g. a platform error page). */
export function statusMessage(status: number): string {
  if (status === 413) return "The attached file is too large. Choose a JPEG, PNG or PDF up to 3 MB.";
  if (status === 429) return "Too many requests right now. Please wait a few minutes or contact the parish office.";
  if (status === 401 || status === 403) return "Your session changed. Reload the page and try again; your details were not submitted.";
  return "The parish system could not save your request. Please try again in a moment.";
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
