// app/hooks/useBattleMapping.tsx
"use client";
import { useEffect, useState } from "react";

type BattleEntry = {
  name: string;      // 表示名キー（正規化済み）
  rawName: string;   // 元の名前
  image?: string;
  series?: string;
};

export function normalizeKey(s: string | null | undefined) {
  if (!s) return "";
  return s.replace(/\u3000/g, " ").trim();
}

export default function useBattleMapping() {
  const [map, setMap] = useState<Record<string, BattleEntry>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const csvUrl = process.env.NEXT_PUBLIC_BATTLE_MAPPING_CSV_URL;

  useEffect(() => {
    if (!csvUrl) {
      console.warn("NEXT_PUBLIC_BATTLE_MAPPING_CSV_URL is not set");
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchCsv = async () => {
      try {
        const res = await fetch(csvUrl, { cache: "no-store" });
        if (!res.ok) {
          console.warn("failed to fetch battle mapping csv", res.status);
          setLoading(false);
          return;
        }
        const text = await res.text();
        // 簡易 CSV パース（ヘッダーありを想定）
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length === 0) {
          setLoading(false);
          return;
        }
        const headers = lines[0].split(",").map((h) => h.trim());
        const idxName = headers.findIndex((h) => /^(name|boss_name|battle_name)$/i.test(h));
        const idxImage = headers.findIndex((h) => /^(image|img|battle_image|url)$/i.test(h));
        const idxSeries = headers.findIndex((h) => /^(series)$/i.test(h));

        const m: Record<string, BattleEntry> = {};
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",");
          const rawName = idxName >= 0 ? (cols[idxName] ?? "").trim() : "";
          if (!rawName) continue;
          const image = idxImage >= 0 ? (cols[idxImage] ?? "").trim() : undefined;
          const series = idxSeries >= 0 ? (cols[idxSeries] ?? "").trim() : undefined;
          const key = normalizeKey(rawName);
          if (!key) continue;
          m[key] = { name: key, rawName, image, series: series && series.length > 0 ? series : undefined };
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
