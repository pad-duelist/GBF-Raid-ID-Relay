// app/raids/rankings/page.tsx
"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";

type Poster = { sender_user_id: string | null; user_name: string | null; post_count: number; };
type Battle = { battle_name: string; post_count: number; };

export default function RaidRankingsPage() {
  const sp = useSearchParams();
  const groupId = sp.get("groupId") || "";
  const [posters, setPosters] = useState<Poster[]>([]);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [days, setDays] = useState<number>(7);
  const [limit, setLimit] = useState<number>(10);
  const [auto, setAuto] = useState<boolean>(true);
  const intervalRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchRankings() {
    if (!groupId) return;
    setLoading(true);
    try {
      const [pRes, bRes] = await Promise.all([
        fetch(`/api/raids/rank/top-posters?group_id=${encodeURIComponent(groupId)}&days=${days}&limit=${limit}`),
        fetch(`/api/raids/rank/top-battles?group_id=${encodeURIComponent(groupId)}&days=${days}&limit=${limit}`)
      ]);
      const pj = await pRes.json();
      const bj = await bRes.json();
      if (pj.ok) setPosters(pj.data as Poster[]);
      if (bj.ok) setBattles(bj.data as Battle[]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRankings();
    if (auto) {
      // window.setInterval を使うことで clearInterval と型が合うようにする
      intervalRef.current = window.setInterval(fetchRankings, 30_000) as unknown as number;
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, days, limit, auto]);

  function anonymize(name: string | null) {
    if (!name) return "(不明)";
    if (name.length <= 3) return name[0] + "*".repeat(Math.max(0, name.length - 1));
    return name.slice(0, 2) + "*".repeat(Math.min(6, name.length - 2));
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-3">ランキング（グループ: {groupId || "未指定"})</h1>
      <div className="flex items-center gap-3 mb-4">
        <label>期間(日):</label>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="border rounded px-2 py-1">
          <option value={1}>1</option>
          <option value={7}>7</option>
          <option value={30}>30</option>
          <option value={365}>全期間</option>
        </select>

        <label>表示数:</label>
        <input type="number" value={limit} min={1} max={50} onChange={(e) => setLimit(Number(e.target.value))} className="w-20 border rounded px-2 py-1" />

        <label className="ml-4">
          <input type="checkbox" checked={auto} onChange={() => setAuto((s) => !s)} /> 自動更新
        </label>

        <button onClick={fetchRankings} className="ml-2 px-3 py-1 bg-gray-200 rounded">手動更新</button>
        {loading && <span className="ml-2 text-sm text-gray-500">読み込み中…</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section>
          <h2 className="font-semibold mb-2">投稿者ランキング</h2>
          <ol className="space-y-2">
            {posters.length === 0 && <li>データがありません</li>}
            {posters.map((p, i) => (
              <li key={p.sender_user_id ?? i} className="flex justify-between items-center">
                <div><strong>{i + 1}.</strong> {anonymize(p.user_name)}</div>
                <div>{p.post_count}</div>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2 className="font-semibold mb-2">人気バトルランキング</h2>
          <ol className="space-y-2">
            {battles.length === 0 && <li>データがありません</li>}
            {battles.map((b, i) => (
              <li key={b.battle_name ?? i} className="flex justify-between items-center">
                <div><strong>{i + 1}.</strong> {b.battle_name}</div>
                <div>{b.post_count}</div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
