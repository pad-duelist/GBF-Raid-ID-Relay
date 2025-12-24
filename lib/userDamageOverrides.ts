// lib/userDamageOverrides.ts
import Papa from "papaparse";

// 60秒キャッシュ（リクエスト毎にスプシへ行かない）
let cache: { at: number; map: Map<string, number> } | null = null;
const TTL_MS = 60_000;

function normalizeUserId(s: unknown): string | null {
  if (s == null) return null;
  const v = String(s).trim();
  return v.length > 0 ? v : null;
}

function toInt(v: unknown): number | null {
  if (v == null) return null;
  // "77,000,000" みたいなのも許容
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

    // ★ 型引数は使わない（papaparse が any 扱いでもビルドが通る）
    const parsed = Papa.parse(csv, {
      header: true,
      skipEmptyLines: true,
    }) as { data?: any[] };

    const map = new Map<string, number>();

    for (const r of parsed.data ?? []) {
      const userId = normalizeUserId(r?.user_id);
      const damage = toInt(r?.damage);

      if (!userId || damage == null || damage <= 0) continue;
      map.set(userId, damage);
    }

    cache = { at: now, map };
    return map;
  } catch {
    const empty = new Map<string, number>();
    cache = { at: now, map: empty };
    return empty;
  }
}
