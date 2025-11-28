// lib/useBattleNameMap.ts
"use client";

import { useEffect, useState } from "react";

export type BattleNameMap = Record<string, string>;

/**
 * GoogleスプレッドシートのCSVから
 * boss_name -> battle_name の対応表を読み込む
 */
export function useBattleNameMap(): BattleNameMap {
  const [map, setMap] = useState<BattleNameMap>({});

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_BATTLE_MAPPING_CSV_URL;
    if (!url) {
      console.warn("NEXT_PUBLIC_BATTLE_MAPPING_CSV_URL が未設定です");
      return;
    }

    let cancelled = false;

    async function fetchMap() {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          console.error("battle mapping csv fetch error", res.status);
          return;
        }
        const text = await res.text();

        const lines = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        if (lines.length <= 1) return;

        const result: BattleNameMap = {};
        // 1行目はヘッダー（boss_name,battle_name）なのでスキップ
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          const parts = line.split(",");
          if (parts.length < 2) continue;
          const bossName = parts[0].trim();
          const battleName = parts[1].trim();
          if (!bossName || !battleName) continue;
          result[bossName] = battleName;
        }

        if (!cancelled) {
          setMap(result);
        }
      } catch (e) {
        console.error("failed to load battle mapping csv", e);
      }
    }

    fetchMap();

    return () => {
      cancelled = true;
    };
  }, []);

  return map;
}
