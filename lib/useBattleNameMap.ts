"use client";

import { useEffect, useState } from "react";

export type BattleNameMap = Record<string, string>; // boss_name → image URL

export function useBattleNameMap(): BattleNameMap {
  const [map, setMap] = useState<BattleNameMap>({});

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_BATTLE_MAPPING_CSV_URL;
    if (!url) {
      console.warn("NEXT_PUBLIC_BATTLE_MAPPING_CSV_URL が設定されていません");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(
            `battle mapping CSV の取得に失敗しました: ${res.status}`
          );
        }

        const text = await res.text();
        const lines = text
          .replace(/\r\n/g, "\n")
          .split("\n")
          .filter((l) => l.trim().length > 0);

        if (lines.length === 0) return;

        const [headerLine, ...rows] = lines;
        const headers = headerLine.split(",");

        const bossIdx = headers.indexOf("boss_name");
        const imageIdx = headers.indexOf("image");

        if (bossIdx === -1 || imageIdx === -1) {
          console.error("CSV に boss_name または image 列がありません");
          return;
        }

        const nextMap: BattleNameMap = {};

        for (const row of rows) {
          const cols = row.split(",");
          const boss = cols[bossIdx]?.trim();
          const image = cols[imageIdx]?.trim();

          if (!boss || !image) continue;

          nextMap[boss] = image;
        }

        if (!cancelled) {
          console.log("battle name map loaded", nextMap);
          setMap(nextMap);
        }
      } catch (e) {
        console.error("useBattleNameMap error", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return map;
}
