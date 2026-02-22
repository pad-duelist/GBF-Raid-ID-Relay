import { NextResponse } from "next/server";
import { weaponsFromCsv } from "@/domain/masters/weapons";

// Source CSV (Google Sheets published)
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSAOkkA_XUu8whEeFIOPKhsW8armUTtc8AeNjrmgKYbjSlhbt7iWOprO4ldJeqI6C32dv2WZQxj3fLM/pub?gid=593550027&single=true&output=csv";

// Cache on the server via Next's data cache
export const revalidate = 60 * 60; // 1 hour

export async function GET() {
  const res = await fetch(CSV_URL, { next: { revalidate } });

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `CSV fetch failed: ${res.status}` },
      { status: 500 }
    );
  }

  const csvText = await res.text();
  const rows = weaponsFromCsv(csvText);

  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: "CSV parse failed or empty (check headers m/s/ls)" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, rows });
}
