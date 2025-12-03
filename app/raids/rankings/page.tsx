"use client";

import { useEffect, useState, useRef } from "react";
import { formatNumberWithComma } from "@/lib/numberFormat";

type RankingRow = {
  rank: number;
  user_name: string;
  points: number;
};

export default function RankingPage() {
  const [rankings, setRankings] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [periodDays, setPeriodDays] = useState<number>(7);
  const [displayCount, setDisplayCount] = useState<number>(50);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  const timerRef = useRef<NodeJS.Timer | null>(null);

  const fetchRanking = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        period: periodDays.toString(),
        limit: displayCount.toString(),
      });
      const res = await fetch(`/api/ranking?${query.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        console.error("failed to fetch rankings", res.status);
        setRankings([]);
        return;
      }
      const data: RankingRow[] = await res.json();
      setRankings(data);
    } catch (e) {
      console.error(e);
      setRankings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRanking();
    if (autoRefresh) {
      timerRef.current = setInterval(fetchRanking, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [periodDays, displayCount, autoRefresh]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-bold">ランキング</h1>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* 期間 */}
            <div className="flex items-center gap-2">
              <span className="text-white text-sm">期間(日):</span>
              <input
                type="number"
                min={1}
                max={365}
                value={periodDays}
                onChange={(e) => setPeriodDays(Number(e.target.value))}
                className="text-black bg-white rounded px-2 py-1 w-20"
              />
            </div>

            {/* 表示数 */}
            <div className="flex items-center gap-2">
              <span className="text-white text-sm">表示数:</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={displayCount}
                onChange={(e) => setDisplayCount(Number(e.target.value))}
                className="text-black bg-white rounded px-2 py-1 w-20"
              />
            </div>

            {/* 自動更新 */}
            <div className="flex items-center gap-2">
              <span className="text-white text-sm">自動更新</span>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-4 h-4"
              />
              <button
                type="button"
                onClick={fetchRanking}
                className="bg-white text-black rounded px-2 py-1 text-sm"
              >
                手動更新
              </button>
            </div>
          </div>
        </header>

        {loading ? (
          <div>読み込み中...</div>
        ) : rankings.length === 0 ? (
          <div className="text-slate-400 text-sm">ランキングがありません。</div>
        ) : (
          <table className="w-full table-auto border-collapse text-sm">
            <thead>
              <tr className="bg-slate-800">
                <th className="border border-slate-700 px-2 py-1">順位</th>
                <th className="border border-slate-700 px-2 py-1">ユーザー名</th>
                <th className="border border-slate-700 px-2 py-1">ポイント</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((row) => (
                <tr key={row.rank} className="hover:bg-slate-700/50">
                  <td className="border border-slate-700 px-2 py-1 text-center">
                    {row.rank}
                  </td>
                  <td className="border border-slate-700 px-2 py-1">{row.user_name}</td>
                  <td className="border border-slate-700 px-2 py-1 text-right">
                    {formatNumberWithComma(row.points)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
