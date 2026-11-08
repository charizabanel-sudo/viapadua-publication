import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

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
  guests?: {
    name: string;
    email: string;
    phone: string;
    bookings: number;
    active: number;
    completed: number;
    cancelled: number;
    paidTotal: number;
    lastBooking: string;
  }[];
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
  const W = 841.89;
  const H = 595.28;
  let page = pdf.addPage([W, H]);
  let y = H - 54;

  const color = (c: typeof NAVY) => rgb(c.r, c.g, c.b);
  const text = (value: string, x: number, top: number, size = 10, font = regular, c = INK) =>
    page.drawText(value, { x, y: top, size, font, color: color(c) });

  page.drawRectangle({ x: 0, y: H - 112, width: W, height: 112, color: color(NAVY) });
  try {
    const logoSvg = await readFile(path.join(process.cwd(), "app", "icon.svg"));
    const logoPng = await sharp(logoSvg).resize(128, 128).png().toBuffer();
    const logo = await pdf.embedPng(logoPng);
    page.drawImage(logo, { x: 36, y: H - 88, width: 64, height: 64 });
  } catch {
    page.drawCircle({ x: 68, y: H - 56, size: 28, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 65, y: H - 68, width: 6, height: 25, color: color(GOLD) });
    page.drawRectangle({ x: 57, y: H - 59, width: 22, height: 6, color: color(GOLD) });
  }
  text("VIA PADUA", 112, H - 42, 19, bold, { r: 1, g: 1, b: 1 });
  text("CHURCH OF SAN ANTONIO DE PADUA", 112, H - 61, 9, regular, { r: 1, g: 1, b: 1 });
  text("Ponso, Polangui, Albay", 112, H - 76, 9, regular, { r: 1, g: 1, b: 1 });
  text(input.title.toUpperCase(), 36, H - 96, 11, bold, { r: 1, g: 1, b: 1 });

  y = H - 140;
  text(`Reporting period: ${input.from} to ${input.to}`, 36, y, 11, bold);
  y -= 18;
  text(`Sacraments / service filter: ${input.service === "all" ? "All sacraments and services" : input.service}`, 36, y, 10, regular, MUTED);
  y -= 28;

  text("LIST OF SACRAMENTS / SERVICES", 36, y, 12, bold, NAVY);
  y -= 26;
  if (input.byService.length === 0) {
    text("No sacrament or service records found for this period.", 36, y, 10, regular, MUTED);
    y -= 18;
  } else {
    for (const item of input.byService) {
      if (y < 70) {
        page = pdf.addPage([W, H]);
        y = H - 54;
      }
      page.drawRectangle({ x: 36, y: y - 10, width: W - 72, height: 28, color: rgb(0.94, 0.96, 0.98) });
      text(item.label, 46, y, 10, bold);
      text(String(item.count), W - 58, y, 10, bold, NAVY);
      y -= 38;
    }
  }

  y -= 16;
  if (input.guests?.length) {
    text("USERS / GUESTS WITH BOOKINGS", 36, y, 12, bold, NAVY);
    y -= 22;
    for (const guest of input.guests) {
      if (y < 58) {
        page = pdf.addPage([W, H]);
        y = H - 54;
      }
      page.drawRectangle({ x: 36, y: y - 16, width: W - 72, height: 34, color: rgb(0.97, 0.98, 0.99) });
      text(guest.name, 46, y, 8.5, bold);
      text(`${guest.email}${guest.phone ? ` · ${guest.phone}` : ""}`, 46, y - 10, 7.5, regular, MUTED);
      text(`${guest.bookings} booking(s) · Paid: ${guest.paidTotal.toFixed(2)} · ${guest.lastBooking}`, W - 330, y - 5, 8, bold, NAVY);
      y -= 44;
    }
    y -= 12;
  }
  text("BOOKING DETAILS", 36, y, 12, bold, NAVY);
  y -= 28;

  const detailRows = input.rows.slice(1);
  const columnIndexes = [0, 1, 2, 3, 4, 5, 7, 10, 14];
  const labels = ["Ref.", "Service", "Date", "Time", "Requester", "Email", "Status", "Payment", "Submitted"];
  const widths = [70, 100, 72, 58, 110, 125, 62, 58, 115];
  const gap = 8;
  const available = W - 72 - gap * (widths.length - 1);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const columns = [36];
  for (let i = 0; i < widths.length; i++) {
    widths[i] = (widths[i] / totalWidth) * available;
    if (i > 0) columns.push(columns[i - 1] + widths[i - 1] + gap);
  }
  for (let i = 0; i < widths.length; i++) {
    text(labels[i].toUpperCase(), columns[i], y, 7.5, bold, NAVY);
  }
  y -= 16;

  for (const row of detailRows) {
    if (y < 48) {
      page = pdf.addPage([W, H]);
      y = H - 54;
      text(input.title.toUpperCase(), 36, y, 10, bold, NAVY);
      y -= 24;
    }
    const values = columnIndexes.map((index) => {
      const value = row[index] ?? "";
      if (index === 10) return value.toLowerCase() === "paid" ? "Paid" : "Unpaid";
      return value;
    });
    const lineLimits = widths.map((width) => Math.max(7, Math.floor(width / 4.2)));
    const lineCounts = values.map((value, index) => wrap(value, lineLimits[index]).length);
    const rowHeight = Math.max(13, Math.max(...lineCounts) * 9);
    for (let i = 0; i < values.length; i++) {
      const lines = wrap(values[i], lineLimits[i]);
      lines.forEach((line, index) => text(line, columns[i], y - index * 9, 7.5, regular, INK));
    }
    page.drawLine({ start: { x: 36, y: y - rowHeight + 4 }, end: { x: W - 36, y: y - rowHeight + 4 }, thickness: 0.25, color: rgb(0.78, 0.82, 0.86) });
    y -= rowHeight + 7;
  }

  return pdf.save();
}
