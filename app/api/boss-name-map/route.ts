// app/api/boss-name-map/route.ts
import { NextResponse } from "next/server";
import Papa from "papaparse";
import fs from "fs";
import path from "path";

const CSV_URL = process.env.BOSS_MAP_CSV_URL!;
const REFRESH_TOKEN = process.env.BOSS_MAP_REFRESH_TOKEN || ""; // 任意: refresh を叩く時のトークン
const LOCAL_CSV_REL = "data/boss-map.csv"; // ローカル開発用フォールバック

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

async function fetchCsvText(url: string, noCache = false) {
  // noCache === true のときは fetch のキャッシュを無効にして新しいデータを取りに行きます
  try {
    const fetchOpts: RequestInit = noCache ? { cache: "no-store" } : {};
    const res = await fetch(url, fetchOpts);
    if (!res.ok) throw new Error(`remote csv fetch failed ${res.status}`);
    const text = await res.text();
    if (text && text.length > 0) return text;
  } catch (e) {
    // フェール時はローカルフォールバックへ
    console.warn("remote csv fetch failed, falling back to local csv", e);
  }

  // ローカルファイルを読む（開発用）
  try {
    const p = path.resolve(process.cwd(), LOCAL_CSV_REL);
    const txt = fs.readFileSync(p, "utf-8");
    return txt;
  } catch (e) {
    throw new Error("failed to load local csv fallback: " + (e as Error).message);
  }
}

export async function GET(req: Request) {
  try {
    if (!CSV_URL) return NextResponse.json({ error: "BOSS_MAP_CSV_URL is not set" }, { status: 500 });

    // query params
    const urlObj = new URL(req.url);
    const refresh = urlObj.searchParams.get("refresh") === "true";
    const token = urlObj.searchParams.get("token") || "";

    // refresh が true の場合はトークンをチェック（REFRESH_TOKEN を設定しているときのみ）
    if (refresh && REFRESH_TOKEN) {
      if (!token || token !== REFRESH_TOKEN) {
        return NextResponse.json({ error: "invalid refresh token" }, { status: 401 });
      }
    }

    // リモート取得の際、refresh=true なら noCache で取得して直ちに返す (CDN には短いキャッシュを付与)
    const text = await fetchCsvText(CSV_URL, refresh);

    // CSV をパース
    const parsed = Papa.parse<{ before?: string; after?: string }>(text, {
      header: true,
      skipEmptyLines: true,
    });

    // normalizedKey => after の map
    const map: Record<string, string> = {};
    for (const row of parsed.data) {
      if (!row || !row.before || !row.after) continue;
      const key = normalizeKey(row.before);
      map[key] = row.after.trim();
    }

    // 長いキー順にソートした配列を返す（クライアントで長いキー優先マッチを使いたい場合に便利）
    const sortedKeys = Object.keys(map).sort((a, b) => b.length - a.length);

    // Cache-Control の付け方：
    // - 通常: CDN に 5 分キャッシュ (s-maxage=300) させる => 高速化
    // - refresh=true の場合は s-maxage=0 にして最新を返す
    const cacheHeader = refresh ? "max-age=0, s-maxage=0, stale-while-revalidate=0" : "max-age=0, s-maxage=300, stale-while-revalidate=600";

    return NextResponse.json(
      { map, sortedKeys },
      {
        status: 200,
        headers: {
          "Cache-Control": cacheHeader,
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
