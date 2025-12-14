// app/raids/rankings/page.tsx
"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Poster = {
  sender_user_id: string | null;
  user_name: string | null;
  post_count: number;
};

type Battle = {
  battle_name: string;
  post_count: number;
};

export default function RaidRankingsPage() {
  const router = useRouter();

  const [groupId, setGroupId] = useState<string>("");
  const [groupSlug, setGroupSlug] = useState<string>("");

  const [posters, setPosters] = useState<Poster[]>([]);
  const [battles, setBattles] = useState<Battle[]>([]);

  const [days, setDays] = useState<number>(7);
  const [limit, setLimit] = useState<number>(10);
  const [auto, setAuto] = useState<boolean>(true);

  const [loading, setLoading] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const intervalRef = useRef<number | null>(null);

  // URLクエリを読む（groupId=uuid / groupSlug=name）
  useEffect(() => {
    const readFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setGroupId(params.get("groupId") || "");
      setGroupSlug(params.get("groupSlug") || "");
    };

    readFromUrl();
    window.addEventListener("popstate", readFromUrl);
    return () => window.removeEventListener("popstate", readFromUrl);
  }, []);

  const displayGroup = useMemo(() => groupSlug || groupId || "未指定", [groupSlug, groupId]);

  const fetchRankings = async () => {
    if (!groupId) {
      setErrorText("groupId が未指定です（URLに groupId が必要です）");
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      const qs = new URLSearchParams();
      qs.set("group_id", groupId);
      qs.set("days", String(days));
      qs.set("limit", String(limit));

      const [r1, r2] = await Promise.all([
        fetch(`/api/raids/rank/top-posters?${qs.toString()}`, { cache: "no-store" }),
        fetch(`/api/raids/rank/top-battles?${qs.toString()}`, { cache: "no-store" }),
      ]);

      if (!r1.ok) throw new Error(`top-posters fetch failed: ${r1.status}`);
      if (!r2.ok) throw new Error(`top-battles fetch failed: ${r2.status}`);

      const j1 = await r1.json();
      const j2 = await r2.json();

      if (!j1?.ok) throw new Error(j1?.error || "top-posters error");
      if (!j2?.ok) throw new Error(j2?.error || "top-battles error");

      setPosters(Array.isArray(j1.data) ? j1.data : []);
      setBattles(Array.isArray(j2.data) ? j2.data : []);
      setLastUpdated(new Date());
    } catch (e: any) {
      console.error(e);
      setErrorText(e?.message ?? "ランキング取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  // 初回取得
  useEffect(() => {
    if (!groupId) return;
    fetchRankings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // 自動更新
  useEffect(() => {
    if (!auto) return;
    if (!groupId) return;

    intervalRef.current = window.setInterval(() => {
      fetchRankings();
    }, 5000) as unknown as number;

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, groupId, days, limit]);

  const handleBackToGroup = () => {
    const key = groupSlug || displayGroup;
    if (key && key !== "未指定") router.push(`/g/${encodeURIComponent(key)}`);
    else router.back();
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xl font-bold">ランキング</div>
            <div className="text-sm text-slate-300">グループ: {displayGroup}</div>
          </div>

          <button
            type="button"
            onClick={handleBackToGroup}
            className="bg-slate-200 hover:bg-slate-100 text-black rounded px-3 py-2 text-sm border border-slate-400"
          >
            グループに戻る
          </button>
        </header>

        <div className="border border-slate-700 rounded p-3 bg-slate-800 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col">
              <label className="text-sm text-white">期間(日)</label>
              <input
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="bg-white text-black rounded px-2 py-1 w-24 border border-slate-400"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-sm text-white">表示数</label>
              <input
                type="number"
                min={1}
                max={50}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="bg-white text-black rounded px-2 py-1 w-24 border border-slate-400"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm text-white">自動更新</label>
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => setAuto(e.target.checked)}
                className="w-5 h-5"
              />
            </div>

            <button
              type="button"
              onClick={fetchRankings}
              className="bg-yellow-500 hover:bg-yellow-400 text-black rounded px-3 py-2 text-sm border border-yellow-600"
            >
              手動更新
            </button>

            <div className="text-xs text-slate-300">
              {loading ? "取得中..." : lastUpdated ? `更新: ${lastUpdated.toLocaleTimeString()}` : ""}
            </div>
          </div>

          {errorText && <div className="text-sm text-red-300">{errorText}</div>}
        </div>

        <section className="grid grid-cols-1 gap-4">
          <div className="border border-slate-700 rounded p-3 bg-slate-800">
            <div className="text-lg font-bold mb-2">投稿者ランキング</div>
            <div className="space-y-2">
              {posters.map((p, i) => (
                <div
                  key={`${p.user_name ?? "noname"}-${i}`}
                  className="flex items-center justify-between border border-slate-700 rounded px-3 py-2 bg-slate-900/30"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {p.user_name && p.user_name.trim().length > 0 ? p.user_name : "（名無し）"}
                    </div>
                  </div>
                  <div className="text-sm font-mono">{p.post_count}</div>
                </div>
              ))}
              {posters.length === 0 && <div className="text-sm text-slate-300">データがありません</div>}
            </div>
          </div>

          <div className="border border-slate-700 rounded p-3 bg-slate-800">
            <div className="text-lg font-bold mb-2">マルチランキング</div>
            <div className="space-y-2">
              {battles.map((b, i) => (
                <div
                  key={`${b.battle_name}-${i}`}
                  className="flex items-center justify-between border border-slate-700 rounded px-3 py-2 bg-slate-900/30"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{b.battle_name}</div>
                  </div>
                  <div className="text-sm font-mono">{b.post_count}</div>
                </div>
              ))}
              {battles.length === 0 && <div className="text-sm text-slate-300">データがありません</div>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
