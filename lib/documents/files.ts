import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { PDFDocument } from "pdf-lib";
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export async function validateFile(file: File) {
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw Error("Choose a JPEG, PNG or PDF up to 3 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = await fileTypeFromBuffer(bytes);
  if (
    !type ||
    !["image/jpeg", "image/png", "application/pdf"].includes(type.mime)
  )
    throw Error("The file contents must be JPEG, PNG or PDF.");
  if (type.mime === "application/pdf") {
    const pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
    if (!pdf.getPageCount() || pdf.getPageCount() > 100)
      throw Error("PDFs must contain 1–100 pages.");
  } else {
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(bytes, {
      limitInputPixels: 24_000_000,
    }).metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1)
      throw Error("Choose a single still image.");
    await sharp(bytes, { limitInputPixels: 24_000_000 }).stats();
  }
  return {
    bytes,
    mime: type.mime,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    filename:
      file.name.replace(/[^a-zA-Z0-9_. -]/g, "_").slice(0, 140) ||
      `document.${type.ext}`,
  };
}
