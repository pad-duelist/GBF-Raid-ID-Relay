// app/raids/rankings/page.tsx
"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

type Poster = {
  sender_user_id: string | null; // 表示はしない（キー用途）
  user_name: string | null; // API側で「最後に使った名前」を返す前提
  post_count: number;
  last_used_at?: string | null; // 任意（返ってきても表示はしない）
};

type Battle = {
  battle_name: string;
  post_count: number;
};

function toInt(v: string, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : def;
}

function shortId(id: string, head = 8): string {
  if (!id) return "";
  return id.length <= head ? id : `${id.slice(0, head)}…`;
}

function displayPosterName(p: Poster): string {
  const name = (p.user_name ?? "").trim();
  if (name) return name;

  const uid = (p.sender_user_id ?? "").trim();
  if (uid) return `(不明: ${shortId(uid)})`;
  return "(不明)";
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

  // URL クエリから groupId を読む（?groupId=xxxx）
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
      const fetchLimit = Math.min(Math.max(limit * 5, limit), 50);

      const [pRes, bRes] = await Promise.all([
        fetch(
          `/api/raids/rank/top-posters?group_id=${encodeURIComponent(
            groupId
          )}&days=${days}&limit=${fetchLimit}`,
          { cache: "no-store" }
        ),
        fetch(
          `/api/raids/rank/top-battles?group_id=${encodeURIComponent(
            groupId
          )}&days=${days}&limit=${fetchLimit}`,
          { cache: "no-store" }
        ),
      ]);

      const pj = await pRes.json();
      const bj = await bRes.json();

      const rawPosters: Poster[] = pj?.ok ? (pj.data as Poster[]) : [];
      const rawBattles: Battle[] = bj?.ok ? (bj.data as Battle[]) : [];

      // APIが統合済み・最新名確定済み想定。念のため並び＆limit適用。
      const nextPosters = [...rawPosters]
        .sort((a, b) => (b.post_count ?? 0) - (a.post_count ?? 0))
        .slice(0, limit);

      const nextBattles = [...rawBattles]
        .sort((a, b) => (b.post_count ?? 0) - (a.post_count ?? 0))
        .slice(0, limit);

      setPosters(nextPosters);
      setBattles(nextBattles);
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
        <h1 className="text-xl font-bold">
          ランキング（グループ: {groupId || "未指定"}）
        </h1>

        <button
          onClick={handleBackToGroup}
          className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm"
        >
          グループに戻る
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="text-white">期間(日):</label>
        <select
          value={days}
          onChange={(e) => setDays(toInt(e.target.value, 7))}
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
          onChange={(e) => setLimit(Math.min(Math.max(toInt(e.target.value, 10), 1), 50))}
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
                  <div>
                    <strong>{i + 1}.</strong> {displayPosterName(p)}
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
