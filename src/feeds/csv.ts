/** Strict RFC4180-style CSV boundary. No dependencies or network access. */
export type CsvRow = Record<string, string>;
export function parseCsv(input: string): CsvRow[] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; closed = false; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = ""; closed = false;
    } else {
      if (closed || c === '"') throw new Error("Malformed CSV quoting");
      cell += c;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (cell || closed || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift();
  if (!header || header.some(h => !h) || new Set(header).size !== header.length) throw new Error("Invalid CSV header");
  return rows.map((values, i) => {
    if (values.length !== header.length) throw new Error(`CSV row ${i + 2}: column count mismatch`);
    return Object.fromEntries(header.map((h, j) => [h, values[j]]));
  });
}

/** Neutralize spreadsheet formula execution; numeric cells remain numbers. */
export function writeCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (typeof v !== "number" && /^[\s]*[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return "\uFEFF" + [headers, ...rows.map(r => headers.map(h => r[h]))].map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
