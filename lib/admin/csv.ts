/** RFC 4180 CSV with spreadsheet formula-injection protection (cells starting with = + - @ are prefixed). */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  // BOM so Excel opens UTF-8 (₱, ñ) correctly.
  return "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
