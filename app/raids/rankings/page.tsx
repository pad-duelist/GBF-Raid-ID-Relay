// app/raids/rankings/page.tsx
"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

type Poster = {
  sender_user_id: string | null;
  // API側で「期間内にそのユーザーが最後に使った user_name」を返す想定
  user_name: string | null;
  post_count: number;

  // （任意）もしAPIが返せるなら、統合時に「本当に最後に使った名前」を厳密に選べます
  // ※無くても動きます
  last_used_at?: string | null;
};

type Battle = { battle_name: string; post_count: number };

function shortId(id: string, head = 8): string {
  if (!id) return "";
  return id.length <= head ? id : `${id.slice(0, head)}…`;
}

function displayPosterName(p: Poster): string {
  // 表示名は「最後に使用した user_name」
  // null/空の場合は sender_user_id をフォールバック（表示名として）
  const name = (p.user_name ?? "").trim();
  if (name) return name;

  const uid = (p.sender_user_id ?? "").trim();
  if (uid) return `(不明: ${shortId(uid)})`;
  return "(不明)";
}

// ==== sender_user_id 統合（例外ルール）====
// 指定の2つは同一ユーザー扱いにしてランキングを統合する
const MERGE_SENDER_IDS = new Set<string>([
  "8cf84c8f-2052-47fb-a3a9-cf7f2980eef4",
  "86f9ace9-dad7-4daa-9c28-adb44759c252",
]);

// 代表ID（DBには保存せず、フロント側の集計キーとしてのみ使用）
const CANONICAL_SENDER_ID = "8cf84c8f-2052-47fb-a3a9-cf7f2980eef4";

function normalizeSenderId(id: string | null): string | null {
  if (!id) return id;
  return MERGE_SENDER_IDS.has(id) ? CANONICAL_SENDER_ID : id;
}

function mergePosters(posters: Poster[]): Poster[] {
  const map = new Map<string, Poster>();

  for (const p of posters) {
    const normalized = normalizeSenderId(p.sender_user_id);
    const key = normalized ?? "__NULL__";

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...p,
        sender_user_id: key === "__NULL__" ? null : key,
      });
      continue;
    }

    // 件数は合算
    existing.post_count += p.post_count;

    // 表示名は「最後に使った名前」優先
    // APIが last_used_at を返せるならそれで厳密に比較し、無い場合は安全なフォールバック
    const pTime = p.last_used_at ?? null;
    const eTime = existing.last_used_at ?? null;

    if (pTime && (!eTime || new Date(pTime).getTime() > new Date(eTime).getTime())) {
      existing.user_name = p.user_name;
      existing.last_used_at = p.last_used_at ?? existing.last_used_at;
    } else {
      // フォールバック:
      // 1) 既存が空で、新しい方が名前を持っていれば採用
      // 2) 両方名前があるなら、代表ID側の名前を優先（揺れを防ぐ）
      const existingName = (existing.user_name ?? "").trim();
      const pName = (p.user_name ?? "").trim();

      if (!existingName && pName) {
        existing.user_name = p.user_name;
      } else if (existingName && pName) {
        const existingWasCanonical = existing.sender_user_id === CANONICAL_SENDER_ID;
        const pWasCanonical = normalized === CANONICAL_SENDER_ID;

        if (!existingWasCanonical && pWasCanonical) {
          existing.user_name = p.user_name;
          existing.last_used_at = p.last_used_at ?? existing.last_used_at;
        }
      }
    }
  }

  return Array.from(map.values());
}

export default function RaidRankingsPage() {
  const router = useRouter();
  const [groupId, setGroupId] = useState<string>("");
  const [posters, setPosters] = useState<Poster[]>([]);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [days, setDays] = useState<number>(7);
  const [limit, setLimit] = useState<number>(10);
  const [auto, setAuto] = useState<boolean>(true);
  const intervalRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const readGroupIdFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setGroupId(params.get("groupId") || "");
    };
    readGroupIdFromUrl();
    window.addEventListener("popstate", readGroupIdFromUrl);
    return () => window.removeEventListener("popstate", readGroupIdFromUrl);
  }, []);

  async function fetchRankings() {
    if (!groupId) return;
    setLoading(true);
    try {
      // 統合で「11位と1位を足したら本来1位」みたいなケースを取りこぼさないため、
      // 取得は最大50件にして、表示は limit で切ります（表示ルールはそのまま）
      const fetchLimit = 50;

      const [pRes, bRes] = await Promise.all([
        fetch(
          `/api/raids/rank/top-posters?group_id=${encodeURIComponent(
            groupId
          )}&days=${days}&limit=${fetchLimit}`
        ),
        fetch(
          `/api/raids/rank/top-battles?group_id=${encodeURIComponent(
            groupId
          )}&days=${days}&limit=${fetchLimit}`
        ),
      ]);

      const pj = await pRes.json();
      const bj = await bRes.json();

      const rawPosters = pj.ok ? (pj.data as Poster[]) : [];
      const mergedPosters = mergePosters(rawPosters)
        .sort((a, b) => b.post_count - a.post_count)
        .slice(0, limit);

      const rawBattles = bj.ok ? (bj.data as Battle[]) : [];
      const limitedBattles = rawBattles
        .sort((a, b) => b.post_count - a.post_count)
        .slice(0, limit);

      setPosters(mergedPosters);
      setBattles(limitedBattles);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!groupId) return;

    fetchRankings();

    if (auto) {
      intervalRef.current = window.setInterval(fetchRankings, 30_000) as unknown as number;
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [groupId, days, limit, auto]);

  function handleBackToGroup() {
    if (groupId) {
      router.push(`/g/${encodeURIComponent(groupId)}`);
    } else {
      router.back();
    }
  }

  return (
    <div className="p-4 bg-slate-900 min-h-screen text-slate-50">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">
          ランキング（グループ: {groupId || "未指定"}）
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleBackToGroup}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm"
          >
            グループに戻る
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="text-white">期間(日):</label>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="border rounded px-2 py-1 text-black"
        >
          <option value={1}>1</option>
          <option value={7}>7</option>
          <option value={30}>30</option>
          <option value={365}>全期間</option>
        </select>

        <label className="text-white">表示数:</label>
        <input
          type="number"
          value={limit}
          min={1}
          max={50}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="w-20 border rounded px-2 py-1 text-black"
        />

        <label className="text-white flex items-center gap-1">
          <input
            type="checkbox"
            checked={auto}
            onChange={() => setAuto((s) => !s)}
            className="w-4 h-4"
          />
          自動更新
        </label>

        <button
          onClick={fetchRankings}
          className="ml-2 px-3 py-1 bg-white text-black rounded"
        >
          手動更新
        </button>

        {loading && <span className="ml-2 text-sm text-gray-300">読み込み中…</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section>
          <h2 className="font-semibold mb-2">投稿者ランキング</h2>
          <ol className="space-y-2">
            {posters.length === 0 ? (
              <li>データがありません</li>
            ) : (
              posters.map((p, i) => (
                <li
                  key={`${p.sender_user_id ?? "unknown"}-${i}`}
                  className="flex justify-between items-center bg-slate-800 rounded px-2 py-1"
                >
                  <div className="flex flex-col">
                    <div>
                      <strong>{i + 1}.</strong> {displayPosterName(p)}
                    </div>
                  </div>
                  <div>{p.post_count}</div>
                </li>
              ))
            )}
          </ol>
        </section>

        <section>
          <h2 className="font-semibold mb-2">人気バトルランキング</h2>
          <ol className="space-y-2">
            {battles.length === 0 ? (
              <li>データがありません</li>
            ) : (
              battles.map((b, i) => (
                <li
                  key={`${b.battle_name ?? "unknown"}-${i}`}
                  className="flex justify-between items-center bg-slate-800 rounded px-2 py-1"
                >
                  <div>
                    <strong>{i + 1}.</strong> {b.battle_name}
                  </div>
                  <div>{b.post_count}</div>
                </li>
              ))
            )}
          </ol>
        </section>
      </div>
    </div>
  );
}
