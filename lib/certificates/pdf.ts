"use client";
/** Capture the same artwork, fitted text and fonts used by Print, at 3072×2048. */
export async function certificatePdf(doc: Document): Promise<Blob> {
  await doc.fonts.ready;
  await Promise.all(Array.from(doc.images).map((img) => img.decode()));
  const sheet = doc.querySelector<HTMLElement>(".cert-sheet");
  if (!sheet) throw Error("Certificate preview is not ready.");
  const [{ toPng }, { PDFDocument }] = await Promise.all([
    import("html-to-image"),
    import("pdf-lib"),
  ]);
  // The source lives in an iframe. The capture library's instanceof HTMLElement
  // font traversal skips descendants from another realm; embed every local face explicitly.
  const faces = Array.from(doc.styleSheets)
    .flatMap((s) => Array.from(s.cssRules))
    .filter((r) => r.type === CSSRule.FONT_FACE_RULE);
  if (!faces.length)
    throw Error("Certificate fonts are unavailable. Please reload and retry.");
  const fontEmbedCSS = (
    await Promise.all(
      faces.map(async (rule) => {
        const css = rule.cssText,
          match = css.match(/url\(["']?([^"')]+)["']?\)/);
        if (!match) throw Error("Certificate font source is missing.");
        const response = await fetch(new URL(match[1], doc.baseURI));
        if (!response.ok) throw Error("Certificate font could not be loaded.");
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          void response
            .blob()
            .then((blob) => reader.readAsDataURL(blob), reject);
        });
        return css.replace(match[0], `url("${data}")`);
      }),
    )
  ).join("\n");
  const image = await toPng(sheet, {
    fontEmbedCSS,
    pixelRatio: 2,
    backgroundColor: "#fbfbf2",
    cacheBust: false,
  });
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([(297 / 25.4) * 72, (198 / 25.4) * 72]);
  const png = await pdf.embedPng(image);
  page.drawImage(png, {
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
  });
  return new Blob([new Uint8Array(await pdf.save())], {
    type: "application/pdf",
  });
}
/** Kept for existing callers; see lib/client/download for the shared implementation. */
export { saveBlob as downloadBlob } from "@/lib/client/download";
