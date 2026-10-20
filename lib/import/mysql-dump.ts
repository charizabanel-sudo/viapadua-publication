/**
 * Minimal parser for phpMyAdmin/mysqldump INSERT statements.
 * Returns raw cell text (or null for NULL); callers convert types per column.
 */

export type DumpTable = { columns: string[]; rows: (string | null)[][] };

const ESCAPES: Record<string, string> = {
  "0": "\0",
  b: "\b",
  n: "\n",
  r: "\r",
  t: "\t",
  Z: "\x1a",
  "\\": "\\",
  "'": "'",
  '"': '"',
};

class Cursor {
  i = 0;
  constructor(readonly s: string) {}
  skipSpace() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  expect(ch: string) {
    this.skipSpace();
    if (this.s[this.i] !== ch) throw new Error(`Expected "${ch}" at offset ${this.i}, found "${this.s.slice(this.i, this.i + 20)}"`);
    this.i++;
  }
}

function readString(c: Cursor): string {
  c.expect("'");
  let out = "";
  for (;;) {
    if (c.i >= c.s.length) throw new Error("Unterminated string in dump");
    const ch = c.s[c.i++];
    if (ch === "\\") {
      const next = c.s[c.i++];
      // MySQL keeps the backslash for unknown escapes such as \% and \_.
      out += next in ESCAPES ? ESCAPES[next] : next === "%" || next === "_" ? `\\${next}` : next;
    } else if (ch === "'") {
      if (c.s[c.i] === "'") {
        out += "'";
        c.i++;
      } else return out;
    } else out += ch;
  }
}

function readValue(c: Cursor): string | null {
  c.skipSpace();
  if (c.s[c.i] === "'") return readString(c);
  const m = /^(NULL|[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/i.exec(c.s.slice(c.i, c.i + 64));
  if (!m) throw new Error(`Unsupported value at offset ${c.i}: "${c.s.slice(c.i, c.i + 20)}"`);
  c.i += m[1].length;
  return m[1].toUpperCase() === "NULL" ? null : m[1];
}

export function parseMysqlDump(sql: string): Map<string, DumpTable> {
  const tables = new Map<string, DumpTable>();
  const header = /INSERT INTO `([^`]+)` \(([^)]*)\) VALUES/g;
  let match: RegExpExecArray | null;

  while ((match = header.exec(sql))) {
    const table = match[1];
    const columns = match[2].split(",").map((col) => col.trim().replace(/^`|`$/g, ""));
    const c = new Cursor(sql);
    c.i = header.lastIndex;
    const entry = tables.get(table) ?? { columns, rows: [] };
    if (entry.columns.join(",") !== columns.join(",")) throw new Error(`Column mismatch in INSERTs for ${table}`);

    for (;;) {
      c.expect("(");
      const row: (string | null)[] = [];
      for (;;) {
        row.push(readValue(c));
        c.skipSpace();
        if (c.s[c.i] === ",") {
          c.i++;
          continue;
        }
        c.expect(")");
        break;
      }
      if (row.length !== columns.length) throw new Error(`Row has ${row.length} values but ${table} has ${columns.length} columns`);
      entry.rows.push(row);
      c.skipSpace();
      if (c.s[c.i] === ",") {
        c.i++;
        continue;
      }
      c.expect(";");
      break;
    }
    tables.set(table, entry);
    header.lastIndex = c.i;
  }
  return tables;
}

/** Converts a table's rows into objects keyed by column name. */
export function rowsAsObjects(table: DumpTable | undefined): Record<string, string | null>[] {
  if (!table) return [];
  return table.rows.map((row) => Object.fromEntries(table.columns.map((col, i) => [col, row[i]])));
}
