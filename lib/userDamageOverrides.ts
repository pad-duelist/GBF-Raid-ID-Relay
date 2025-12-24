// lib/userDamageOverrides.ts
import Papa from "papaparse";

type Row = {
  user_id?: string;
  damage?: string | number;
};

let cache: { at: number; map: Map<string, number> } | null = null;
const TTL_MS = 60_000;

function norm(s: unknown): string | null {
  if (s == null) return null;
  const v = String(s).trim();
  return v ? v : null;
}
function toInt(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export async function getUserDamageOverrideMap(): Promise<Map<string, number>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.map;

  const url = process.env.USER_DAMAGE_CSV_URL;
  if (!url) {
    const empty = new Map<string, number>();
    cache = { at: now, map: empty };
    return empty;
  }

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
    const csv = await res.text();

    const parsed = Papa.parse<Row>(csv, {
      header: true,
      skipEmptyLines: true,
    });

    const map = new Map<string, number>();
    for (const r of parsed.data ?? []) {
      const userId = norm((r as any).user_id);
      const dmg = toInt((r as any).damage);
      if (!userId || dmg == null || dmg <= 0) continue;
      map.set(userId, dmg);
    }

    cache = { at: now, map };
    return map;
  } catch {
    const empty = new Map<string, number>();
    cache = { at: now, map: empty };
    return empty;
  }
}
