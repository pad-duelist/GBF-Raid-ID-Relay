// lib/useBattleNameMap.ts
"use client";

import { useEffect, useState } from "react";

export type BattleNameMap = Record<string, string>;

/**
 * Googleスプレッドシートの CSV から
 * boss_name -> battle_name の対応表を読み込むカスタムフック
 */
export function useBattleNameMap(): BattleNameMap {
  const [map, setMap] = useState<BattleNameMap>({});

  useEffect(() => {
    let cancelled = false;

    async function fetchMap() {
      try {
        const url = process.env.NEXT_PUBLIC_BATTLE_MAPPING_CSV_URL;

        // 環境変数が未設定の場合
        if (!url) {
          console.error(
            "NEXT_PUBLIC_BATTLE_MAPPING_CSV_URL が設定されていません。battle name map は空のままになります。"
          );
          return;
        }

        const res = await fetch(url, { cache: "no-store" });

        if (!res.ok) {
          console.error(
            "battle mapping csv fetch error",
            res.status,
            res.statusText
          );
          return;
        }

        const csvText = await res.text();
        if (cancelled) return;

        const lines = csvText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        if (lines.length === 0) {
          setMap({});
          return;
        }

        // 1行目をヘッダとして解釈
        const header = lines[0].split(",");

        const bossNameIndex = header.findIndex(
          (h) => h === "boss_name" || h === "bossName"
        );
        const battleNameIndex = header.findIndex(
          (h) => h === "battle_name" || h === "battleName"
        );

        if (bossNameIndex === -1 || battleNameIndex === -1) {
          console.error(
            "battle mapping csv: ヘッダ行に boss_name / battle_name カラムが見つかりません。"
          );
          setMap({});
          return;
        }

        const nextMap: BattleNameMap = {};

        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",");
          const boss = cols[bossNameIndex]?.trim();
          const battle = cols[battleNameIndex]?.trim();
          if (!boss || !battle) continue;
          nextMap[boss] = battle;
        }

        if (!cancelled) {
          setMap(nextMap);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("failed to load battle mapping csv", e);
        }
      }
    }

    fetchMap();

    return () => {
      cancelled = true;
    };
  }, []);

  return map;
}
