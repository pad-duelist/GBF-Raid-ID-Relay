// /lib/useBattleMapping.ts
"use client";
import { useEffect, useState } from "react";

export type BattleEntry = {
  name: string;      // 正規化したキー
  rawName: string;   // 元の表記
  image?: string | null;
  series?: string | null;
};

export function normalizeKey(s: string | null | undefined) {
  if (!s) return "";
  return s.replace(/\u3000/g, " ").trim();
}

/**
 * シンプルだが堅牢な CSV パーサ（行ごと、引用符対応）
 * 戻り値は 2 次元配列（rows x cols）
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let curRow: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : null;

    if (ch === '"') {
      if (inQuotes && next === '"') {
        // 連続する "" は " として取り扱う
        cur += '"';
        i++; // skip next
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      curRow.push(cur);
      cur = "";
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // handle \r\n or \n or \r
      // if \r\n, skip the \n part by continuing loop
      if (ch === '\r' && next === '\n') {
        // push and skip; loop will increment i and skip \n automatically next iter
      }
      // end of row
      curRow.push(cur);
      rows.push(curRow);
      curRow = [];
      cur = "";
      // if \r\n we just consumed \r; next iteration will see \n and push empty row — avoid that by checking next
      if (ch === '\r' && next === '\n') {
        i++; // skip the \n
      }
      continue;
    }

    // normal char
    cur += ch;
  }
  // push last cell/row if any
  if (cur.length > 0 || inQuotes) {
    curRow.push(cur);
  }
  if (curRow.length > 0) rows.push(curRow);
  return rows;
}

export default function useBattleMapping() {
  const [map, setMap] = useState<Record<string, BattleEntry>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const csvUrl = process.env.NEXT_PUBLIC_BATTLE_MAPPING_CSV_URL;

  useEffect(() => {
    let cancelled = false;
    if (!csvUrl) {
      console.warn("useBattleMapping: NEXT_PUBLIC_BATTLE_MAPPING_CSV_URL is not set");
      setLoading(false);
      return;
    }

    const fetchCsv = async () => {
      try {
        const res = await fetch(csvUrl, { cache: "no-store" });
        if (!res.ok) {
          console.warn("useBattleMapping: failed to fetch csv", res.status);
          if (!cancelled) setLoading(false);
          return;
        }
        const text = await res.text();
        const rows = parseCsv(text);
        if (rows.length === 0) {
          if (!cancelled) setLoading(false);
          return;
        }

        const headers = rows[0].map((h) => (h ?? "").toString().trim().toLowerCase());
        // 対応するヘッダ名を柔軟に検出
        const idxName =
          headers.findIndex((h) => /^(name|boss_name|battle_name|display_name)$/.test(h));
        const idxImage =
          headers.findIndex((h) => /^(image|img|url|battle_image|image_url)$/.test(h));
        const idxSeries = headers.findIndex((h) => /^(series|series_name)$/.test(h));

        const m: Record<string, BattleEntry> = {};
        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i];
          const rawName = idxName >= 0 ? (cols[idxName] ?? "").toString().trim() : (cols[0] ?? "").toString().trim();
          if (!rawName) continue;
          const image = idxImage >= 0 ? (cols[idxImage] ?? "").toString().trim() : undefined;
          const seriesRaw = idxSeries >= 0 ? (cols[idxSeries] ?? "").toString().trim() : undefined;
          const series = seriesRaw && seriesRaw.length > 0 ? seriesRaw : undefined;
          const key = normalizeKey(rawName);
          if (!key) continue;
          m[key] = {
            name: key,
            rawName,
            image: image && image.length > 0 ? image : undefined,
            series: series ?? undefined,
          };
        }

        if (!cancelled) {
          setMap(m);
          setLoading(false);
        }
      } catch (e) {
        console.error("useBattleMapping fetch error", e);
        if (!cancelled) setLoading(false);
      }
    };

    fetchCsv();
    return () => {
      cancelled = true;
    };
  }, [csvUrl]);

  return { map, loading };
}
