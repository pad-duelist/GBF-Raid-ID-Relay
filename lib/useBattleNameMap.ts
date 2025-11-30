"use client";

import { useEffect, useState } from "react";

export type BattleImageMap = Record<string, string>; // boss_name → image URL

export function useBattleNameMap(): BattleImageMap {
  const [map, setMap] = useState<BattleImageMap>({});

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_BATTLE_MAPPING_CSV_URL;
    if (!url) {
      console.warn("NEXT_PUBLIC_BATTLE_MAPPING_CSV_URL が設定されていません");
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(
            `battle mapping CSV の取得に失敗しました: ${res.status}`
          );
        }

        const text = await res.text();
        const lines = text.trim().split(/\r?\n/);
        if (lines.length === 0) return;

        const [headerLine, ...rows] = lines;
        const headers = headerLine.split(",");

        const bossNameIndex = headers.indexOf("boss_name");
        const imageIndex = headers.indexOf("image");

        if (bossNameIndex === -1) {
          console.error("CSV に boss_name 列がありません");
          return;
        }

        const nextMap: BattleImageMap = {};

        for (const row of rows) {
          if (!row.trim()) continue;
          const cols = row.split(",");

          const bossName = cols[bossNameIndex]?.trim();
          if (!bossName) continue;

          const imageUrl =
            imageIndex >= 0 ? cols[imageIndex]?.trim() : undefined;
          if (imageUrl) {
            nextMap[bossName] = imageUrl;
          }
        }

        if (!cancelled) {
          setMap(nextMap);
        }
      } catch (e) {
        console.error(e);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return map;
}
