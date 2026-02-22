export function parseCsv(text: string): string[][] {
  // Simple CSV parser (Google Sheets CSV output intended)
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        const next = text[i + 1];
        if (next === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (c === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }

    if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }

    if (c === "\r") {
      i++;
      continue;
    }

    cell += c;
    i++;
  }

  row.push(cell);
  rows.push(row);

  return rows.filter((r) => r.some((v) => (v ?? "").trim() !== ""));
}
