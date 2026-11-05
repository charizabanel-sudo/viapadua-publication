const NAVY = { r: 0.071, g: 0.196, b: 0.36 };
const GOLD = { r: 0.79, g: 0.62, b: 0.22 };
const INK = { r: 0.12, g: 0.18, b: 0.25 };
const MUTED = { r: 0.35, g: 0.42, b: 0.49 };

type ReportPdfInput = {
  title: string;
  from: string;
  to: string;
  service: string;
  rows: string[][];
  byService: { label: string; count: number }[];
};

function wrap(text: string, limit: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > limit && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderSacramentReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setAuthor("Via Padua Parish");
  pdf.setSubject(`Parish report from ${input.from} to ${input.to}`);
  pdf.setCreator("Via Padua Parish Management System");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  let page = pdf.addPage([W, H]);
  let y = H - 54;

  const color = (c: typeof NAVY) => rgb(c.r, c.g, c.b);
  const text = (value: string, x: number, top: number, size = 10, font = regular, c = INK) =>
    page.drawText(value, { x, y: top, size, font, color: color(c) });

  page.drawRectangle({ x: 0, y: H - 112, width: W, height: 112, color: color(NAVY) });
  page.drawCircle({ x: 49, y: H - 53, size: 24, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 46, y: H - 64, width: 6, height: 25, color: color(GOLD) });
  page.drawRectangle({ x: 38, y: H - 55, width: 22, height: 6, color: color(GOLD) });
  text("VIA PADUA", 84, H - 42, 19, bold, { r: 1, g: 1, b: 1 });
  text("CHURCH OF SAN ANTONIO DE PADUA", 84, H - 61, 9, regular, { r: 1, g: 1, b: 1 });
  text("Ponso, Polangui, Albay", 84, H - 76, 9, regular, { r: 1, g: 1, b: 1 });
  text(input.title.toUpperCase(), 36, H - 96, 11, bold, { r: 1, g: 1, b: 1 });

  y = H - 140;
  text(`Reporting period: ${input.from} to ${input.to}`, 36, y, 11, bold);
  y -= 18;
  text(`Sacraments / service filter: ${input.service === "all" ? "All sacraments and services" : input.service}`, 36, y, 10, regular, MUTED);
  y -= 28;

  text("LIST OF SACRAMENTS / SERVICES", 36, y, 12, bold, NAVY);
  y -= 18;
  if (input.byService.length === 0) {
    text("No sacrament or service records found for this period.", 36, y, 10, regular, MUTED);
    y -= 18;
  } else {
    for (const item of input.byService) {
      if (y < 70) {
        page = pdf.addPage([W, H]);
        y = H - 54;
      }
      page.drawRectangle({ x: 36, y: y - 5, width: W - 72, height: 24, color: rgb(0.94, 0.96, 0.98) });
      text(item.label, 46, y + 2, 10, bold);
      text(String(item.count), W - 58, y + 2, 10, bold, NAVY);
      y -= 30;
    }
  }

  y -= 8;
  text("BOOKING DETAILS", 36, y, 12, bold, NAVY);
  y -= 20;

  const headers = input.rows[0] ?? [];
  const detailRows = input.rows.slice(1);
  const columns = [
    Math.min(headers.length, 1) ? 36 : 36,
    118,
    205,
    258,
    330,
    410,
    500,
  ];
  const widths = [82, 87, 53, 72, 80, 90, 57];
  for (let i = 0; i < Math.min(headers.length, widths.length); i++) {
    text(headers[i].toUpperCase(), columns[i], y, 7, bold, NAVY);
  }
  y -= 12;

  for (const row of detailRows) {
    if (y < 48) {
      page = pdf.addPage([W, H]);
      y = H - 54;
      text(input.title.toUpperCase(), 36, y, 10, bold, NAVY);
      y -= 24;
    }
    const values = row.slice(0, widths.length);
    let rowHeight = 0;
    for (let i = 0; i < values.length; i++) {
      rowHeight = Math.max(rowHeight, wrap(values[i] ?? "", 18).length);
    }
    rowHeight *= 9;
    for (let i = 0; i < values.length; i++) {
      const lines = wrap(values[i] ?? "", 18);
      lines.forEach((line, index) => text(line, columns[i], y - index * 8, 7, regular, INK));
    }
    page.drawLine({ start: { x: 36, y: y - Math.max(rowHeight, 9) + 6 }, end: { x: W - 36, y: y - Math.max(rowHeight, 9) + 6 }, thickness: 0.25, color: rgb(0.78, 0.82, 0.86) });
    y -= Math.max(rowHeight, 9) + 6;
  }

  return pdf.save();
}
