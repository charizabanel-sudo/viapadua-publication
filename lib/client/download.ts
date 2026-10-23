"use client";

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DownloadError";
  }
}

export type FetchedFile = { blob: Blob; filename: string; type: string };

/** Filename from Content-Disposition, preferring RFC 5987 `filename*`. */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through to the plain filename */
    }
  }
  const plain = /filename\s*=\s*"([^"]+)"/.exec(header) ?? /filename\s*=\s*([^;]+)/.exec(header);
  return plain?.[1].trim() || fallback;
}

/**
 * Fetches a same-origin file with the session cookie and checks that the response is the
 * expected file type, so a sign-in prompt or error page is never saved as a document.
 */
export async function fetchFile(href: string, accept: readonly string[], fallbackName: string): Promise<FetchedFile> {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) throw new DownloadError("Downloads must come from this website.");
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", cache: "no-store", redirect: "error" });
  } catch {
    throw new DownloadError("Download failed. Check your connection and try again.");
  }
  if (response.status === 401)
    throw new DownloadError("Your session expired. Sign in again, then retry the download.", 401);
  if (response.status === 403 || response.status === 404)
    throw new DownloadError("This file is not available to your account.", response.status);
  if (!response.ok) throw new DownloadError("The server could not prepare this file. Please retry.", response.status);
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!accept.includes(type)) throw new DownloadError("The server returned an unexpected response instead of the file. Please retry.", response.status);
  const blob = await response.blob();
  if (!blob.size) throw new DownloadError("The downloaded file was empty. Please retry.");
  return { blob, filename: filenameFromDisposition(response.headers.get("content-disposition"), fallbackName), type };
}

const OBJECT_URL_LIFETIME_MS = 5 * 60 * 1000;

/** Saves a blob through a temporary link. The object URL outlives slow mobile save sheets. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
}

/** Opens a blob in a new tab. Call directly from a click handler so the browser allows it. */
export function openBlob(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
  return true;
}

export function canShareFile(blob: Blob, filename: string): boolean {
  try {
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] });
  } catch {
    return false;
  }
}

/** Native share sheet (save to Files, send to a printer app). Must run inside a click handler. */
export async function shareBlob(blob: Blob, filename: string): Promise<"shared" | "cancelled"> {
  try {
    await navigator.share({ files: [new File([blob], filename, { type: blob.type })], title: filename });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    throw new DownloadError("Sharing is not available here. Use Open instead.");
  }
}
