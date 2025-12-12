// app/api/boss-name-map/route.ts
import { NextRequest, NextResponse } from "next/server";

const BOSS_MAP_CSV_URL = process.env.BOSS_MAP_CSV_URL ?? process.env.NEXT_PUBLIC_BOSS_MAP_CSV_URL;
const REFRESH_TOKEN = process.env.BOSS_MAP_REFRESH_TOKEN ?? process.env.NEXT_PUBLIC_BOSS_MAP_REFRESH_TOKEN;
const LOCAL_CSV_REL = "data/boss-map.csv"; // ローカルフォールバック（必要なら配置）

let bossMapCache: { map: Record<string, string>; sortedKeys: string[] } | null = null;
let lastBossMapFetched = 0;
const BOSS_MAP_TTL = 5 * 60 * 1000; // 5分

// --- 正規化ユーティリティ（サーバとクライアントで同じロジックを使うことを想定） ---
function toHalfwidthAndLower(s: string) {
  return s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
function removeCommonNoise(s: string) {
  let out = s.replace(/\(.*?\)|（.*?）/g, "");
  out = out.replace(/(no\.?\s?\d+|\#\d+|\d+番?)$/i, "");
  out = out.replace(/[\/:;「」『』"“”'’‘、。,・\-\—]/g, "");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}
function normalizeKey(raw: string) {
  return removeCommonNoise(toHalfwidthAndLower(raw || ""));
}

// --- シンプル CSV パーサ（ダブルクオート対応） ---
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        // エスケープされたダブルクオート
        cur += '"';
        i++;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (ch === "," && !inQuote) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// --- CSV 取得（リモート or ローカルフォールバック） ---
async function fetchCsvText(url: string, noCache = false): Promise<string> {
  // try remote fetch first
  if (url) {
    try {
      const res = await fetch(url, noCache ? { cache: "no-store" } : undefined);
      if (res.ok) {
        const txt = await res.text();
        if (txt && txt.length > 0) return txt;
      } else {
        console.warn("[boss-map] remote csv fetch failed", res.status, res.statusText);
      }
    } catch (e) {
      console.warn("[boss-map] remote csv fetch error", e);
    }
  }

  // fallback to local file (useful for development)
  try {
    // Node fs is not available in some edge runtimes; wrap in try/catch
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const path = require("path");
    const p = path.resolve(process.cwd(), LOCAL_CSV_REL);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf-8");
    }
  } catch (e) {
    // ignore
  }

  return "";
}

// --- キャッシュ付きで map を作る ---
async function fetchBossNameMapCached(force = false): Promise<{ map: Record<string, string>; sortedKeys: string[] }> {
  const now = Date.now();
  if (!force && bossMapCache && now - lastBossMapFetched < BOSS_MAP_TTL) {
    return bossMapCache;
  }

  // default empty
  const empty = { map: {} as Record<string, string>, sortedKeys: [] as string[] };

  if (!BOSS_MAP_CSV_URL) {
    bossMapCache = empty;
    lastBossMapFetched = now;
    return bossMapCache;
  }

  try {
    const text = await fetchCsvText(BOSS_MAP_CSV_URL, force);
    if (!text) {
      bossMapCache = empty;
      lastBossMapFetched = now;
      return bossMapCache;
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      bossMapCache = empty;
      lastBossMapFetched = now;
      return bossMapCache;
    }

    // header detection: before,after
    const headerCols = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
    const beforeIdx = headerCols.indexOf("before");
    const afterIdx = headerCols.indexOf("after");

    const map: Record<string, string> = {};
    if (beforeIdx !== -1 && afterIdx !== -1) {
      // header present
      for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]);
        const before = (cols[beforeIdx] ?? "").trim();
        const after = (cols[afterIdx] ?? "").trim();
        if (before && after) {
          const key = normalizeKey(before);
          map[key] = after;
        }
      }
    } else {
      // fallback: assume two columns per line
      for (let i = 0; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]);
        if (cols.length < 2) continue;
        const before = cols[0].trim();
        const after = cols[1].trim();
        if (before && after) {
          const key = normalizeKey(before);
          map[key] = after;
        }
      }
    }

    const sortedKeys = Object.keys(map).sort((a, b) => b.length - a.length);
    bossMapCache = { map, sortedKeys };
    lastBossMapFetched = now;
    return bossMapCache;
  } catch (e) {
    console.error("[boss-map] parse error", e);
    bossMapCache = empty;
    lastBossMapFetched = now;
    return bossMapCache;
  }
}

// --- API ハンドラ ---
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const refresh = url.searchParams.get("refresh") === "true";
    const token = url.searchParams.get("token") ?? "";

    if (refresh && REFRESH_TOKEN) {
      if (!token || token !== REFRESH_TOKEN) {
        return NextResponse.json({ error: "invalid refresh token" }, { status: 401 });
      }
    }

    const data = await fetchBossNameMapCached(refresh);
    // if refresh was requested, return with no-cache header to indicate freshness
    const cacheHeader = refresh ? "max-age=0, s-maxage=0, stale-while-revalidate=0" : "max-age=0, s-maxage=300, stale-while-revalidate=600";

    return NextResponse.json(data, {
      status: 200,
      headers: {
        "Cache-Control": cacheHeader,
      },
    });
  } catch (e) {
    console.error("/api/boss-name-map error", e);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
