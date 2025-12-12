// app/raids/rankings/page.tsx
"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

type Poster = {
  user_id: string | null;
  user_id_text: string;
  last_used_name: string | null;
  post_count: number;
  last_post_at?: string | null;
};
type Battle = { battle_name: string; post_count: number; };

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
    function readGroupIdFromUrl() {
      const params = new URLSearchParams(window.location.search);
      setGroupId(params.get("groupId") || "");
    }
    readGroupIdFromUrl();
    window.addEventListener("popstate", readGroupIdFromUrl);
    return () => window.removeEventListener("popstate", readGroupIdFromUrl);
  }, []);

  async function fetchRankings() {
    if (!groupId) return;
    setLoading(true);
    try {
      // poster-ranking API を呼ぶ（存在する API）
      const pRes = await fetch(
        `/api/poster-ranking?group_id=${encodeURIComponent(groupId)}&days=${days}&limit=${limit}`
      );
      // 旧コードで呼んでいた top-battles は存在しないとのことなので例外的に空にする
      // 将来 API があればここを差し替えてください
      let bResData: Battle[] = [];

      const pj = await pRes.json().catch(() => null);

      if (pj && Array.isArray(pj.data)) {
        // route.ts は { data } を返す想定
        setPosters(pj.data as Poster[]);
      } else if (pj && pj.error) {
        console.error("poster-ranking API error:", pj.error);
        setPosters([]);
      } else {
        // 想定外のレスポンス
        console.warn("unexpected poster-ranking response:", pj);
        setPosters([]);
      }

      setBattles(bResData);
    } catch (e) {
      console.error(e);
      setPosters([]);
      setBattles([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!groupId) return;
    fetchRankings();
    if (auto) {
      // intervalRef を安全に扱う
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      intervalRef.current = window.setInterval(fetchRankings, 30_000) as unknown as number;
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      intervalRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <h1 className="text-xl font-bold">ランキング（グループ: {groupId || "未指定"})</h1>
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
              posters.map((p, i) => {
                // 安定した key を生成：可能なら user_id を使い、なければ user_id_text+index を使う
                const safeKey = p.user_id ?? `${p.user_id_text ?? "anonymous"}-${i}`;
                const displayName = p.last_used_name ?? p.user_id_text ?? "(不明)";
                return (
                  <li key={safeKey} className="flex justify-between items-center bg-slate-800 rounded px-2 py-1">
                    <div>
                      <strong>{i + 1}.</strong> {displayName}
                      {/* デバッグ表示: ID をすぐ確認したいときに有効（運用時は削除可） */}
                      <span className="ml-2 text-xs text-gray-400">[{p.user_id ?? "no-id"}]</span>
                    </div>
                    <div>{p.post_count}</div>
                  </li>
                );
              })
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
                <li key={b.battle_name ?? i} className="flex justify-between items-center bg-slate-800 rounded px-2 py-1">
                  <div><strong>{i + 1}.</strong> {b.battle_name}</div>
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
