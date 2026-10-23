import "server-only";

const PRIVATE = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

/** RFC 6266 header with an ASCII fallback and a UTF-8 `filename*`. */
export function contentDisposition(kind: "attachment" | "inline", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;\r\n]/g, "_") || "download";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Plain-text refusal. Never carries a filename, so it cannot be saved as the requested document. */
export function fileError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { ...PRIVATE, "Content-Type": "text/plain; charset=utf-8", "Content-Security-Policy": "sandbox; default-src 'none'" },
  });
}

/**
 * Private file response. Attachments stay sandboxed. Inline previews of validated PDFs/images
 * drop the CSP sandbox because browser PDF viewers refuse to render inside one.
 */
export function fileResponse(body: Uint8Array | string, options: { mime: string; filename: string; inline?: boolean }): Response {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const inline = options.inline === true && /^(?:application\/pdf|image\/(?:png|jpeg))$/.test(options.mime);
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...PRIVATE,
      "Content-Type": options.mime,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", options.filename),
      // Content was validated as PDF/PNG/JPEG on upload and is served with nosniff.
      "Content-Security-Policy": inline ? "frame-ancestors 'none'" : "sandbox; default-src 'none'",
    },
  });
}
