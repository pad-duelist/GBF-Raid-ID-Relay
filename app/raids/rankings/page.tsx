// app/raids/rankings/page.tsx
"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Poster = {
  sender_user_id: string | null;
  user_name: string | null;
  post_count: number;
  // もしAPI側で返しているなら（最後に使った名前の厳密判定に使う）
  last_posted_at?: string | null;
};

type Battle = { battle_name: string; post_count: number };

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function RaidRankingsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  // --- グループID/名前はクエリから取得（テキストボックス廃止） ---
  const groupKey = useMemo(() => {
    // 互換のため複数キーを許容
    const g =
      sp.get("groupId") ??
      sp.get("group") ??
      sp.get("group_name") ??
      sp.get("group_id") ??
      "";
    return g.trim();
  }, [sp]);

  const [posters, setPosters] = useState<Poster[]>([]);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [days, setDays] = useState<number>(7);
  const [limit, setLimit] = useState<number>(10);
  const [auto, setAuto] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");

  const intervalRef = useRef<number | null>(null);

  // --- 統合したいユーザーID（同一ユーザー扱い） ---
  const MERGE_A = "86f9ace9-dad7-4daa-9c28-adb44759c252";
  const MERGE_B = "8cf84c8f-2052-47fb-a3a9-cf7f2980eef4";

  const canonicalUserId = (id: string | null) => {
    if (!id) return id;
    if (id === MERGE_A || id === MERGE_B) return MERGE_A; // Aに寄せる
    return id;
  };

  const mergePosters = (rows: Poster[]): Poster[] => {
    const map = new Map<string, Poster>();

    for (const r of rows) {
      const rawId = r.sender_user_id ?? "";
      const key = canonicalUserId(rawId) ?? rawId;

      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          sender_user_id: key || null,
          user_name: r.user_name ?? null,
          post_count: toInt(r.post_count, 0),
          last_posted_at: r.last_posted_at ?? null,
        });
        continue;
      }

      // 合算
      const nextCount = toInt(prev.post_count, 0) + toInt(r.post_count, 0);

      // 名前は「最後に使った名前」を優先
      // - APIが last_posted_at を返すなら、より新しい方の名前を採用
      // - 無い場合は、nullでない方/より“後勝ち”を採用（フォールバック）
      let nextName = prev.user_name ?? null;
      let nextLast = prev.last_posted_at ?? null;

      const aT = safeStr(prev.last_posted_at);
      const bT = safeStr(r.last_posted_at);

      if (aT && bT) {
        if (new Date(bT).getTime() >= new Date(aT).getTime()) {
          nextName = r.user_name ?? nextName;
          nextLast = r.last_posted_at ?? nextLast;
        }
      } else if (!aT && bT) {
        nextName = r.user_name ?? nextName;
        nextLast = r.last_posted_at ?? nextLast;
      } else if (!nextName && r.user_name) {
        nextName = r.user_name;
      } else if (r.user_name) {
        // フォールバック：後勝ち（「最後に使った名前」に寄せる意図）
        nextName = r.user_name;
      }

      map.set(key, {
        sender_user_id: key || null,
        user_name: nextName,
        post_count: nextCount,
        last_posted_at: nextLast,
      });
    }

    return Array.from(map.values()).sort((a, b) => b.post_count - a.post_count);
  };

  const fetchRankings = async () => {
    setLoading(true);
    setErr("");

    try {
      if (!groupKey) {
        setPosters([]);
        setBattles([]);
        setErr("グループが指定されていません（URLに ?groupId=... を付けて開いてください）。");
        return;
      }

      const qs = new URLSearchParams();
      qs.set("groupId", groupKey);
      qs.set("days", String(days));
      qs.set("limit", String(limit));

      // ※既存実装に合わせてください（以前の構成のままの想定）
      const res = await fetch(`/api/raids/rankings?${qs.toString()}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Fetch failed: ${res.status} ${res.statusText} ${t}`);
      }

      const json = await res.json().catch(() => ({} as any));

      const rawPosters: Poster[] = Array.isArray(json?.posters) ? json.posters : [];
      const rawBattles: Battle[] = Array.isArray(json?.battles) ? json.battles : [];

      const merged = mergePosters(rawPosters);

      // limit適用（統合後に上位を切る）
      setPosters(merged.slice(0, Math.max(1, limit)));
      setBattles(rawBattles);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setPosters([]);
      setBattles([]);
    } finally {
      setLoading(false);
    }
  };

  // 初回/条件変更時に取得
  useEffect(() => {
    fetchRankings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, days, limit]);

  // 自動更新
  useEffect(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!auto) return;

    intervalRef.current = window.setInterval(() => {
      fetchRankings();
    }, 1000);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, groupKey, days, limit]);

  const goBackToRankingsRoot = () => {
    router.push("/raids/rankings");
  };

  const goBackToGroup = () => {
    if (!groupKey) {
      router.push("/"); // 迷子対策
      return;
    }
    router.push(`/g/${encodeURIComponent(groupKey)}`);
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-4xl p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">ランキング</h1>
          <div className="flex gap-2">
            <button
              onClick={goBackToGroup}
              className="rounded bg-white px-3 py-2 text-sm font-semibold text-black hover:opacity-90"
            >
              グループへ戻る
            </button>
            <button
              onClick={goBackToRankingsRoot}
              className="rounded bg-white px-3 py-2 text-sm font-semibold text-black hover:opacity-90"
              title="クエリを消してランキングページに戻ります"
            >
              ランキングへ戻る
            </button>
          </div>
        </div>

        <div className="mt-2 text-sm opacity-90">
          <span className="font-semibold">グループ: </span>
          <span>{groupKey || "(未指定)"}</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* ラベル白、入力黒（以前の指定に寄せる） */}
          <label className="text-white">
            期間(日):
            <input
              className="ml-2 w-20 rounded bg-white px-2 py-1 text-black"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Math.max(1, Number(e.target.value)))}
            />
          </label>

          <label className="text-white">
            表示数:
            <select
              className="ml-2 rounded bg-white px-2 py-1 text-black"
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Number(e.target.value)))}
            >
              {[5, 10, 20, 30, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-white">
            自動更新
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              className="h-4 w-4"
            />
          </label>

          <button
            onClick={fetchRankings}
            className="rounded bg-white px-3 py-2 text-sm font-semibold text-black hover:opacity-90"
          >
            手動更新
          </button>

          {loading && <span className="text-sm opacity-80">更新中…</span>}
        </div>

        {err && (
          <div className="mt-4 rounded border border-red-500 bg-red-950 p-3 text-sm">
            {err}
          </div>
        )}

        {/* 投稿者ランキング */}
        <div className="mt-6">
          <h2 className="text-lg font-bold">投稿者ランキング</h2>
          <div className="mt-2 overflow-hidden rounded border border-white/15">
            <table className="w-full text-sm">
              <thead className="bg-white/10">
                <tr>
                  <th className="w-16 px-3 py-2 text-left">順位</th>
                  <th className="px-3 py-2 text-left">名前</th>
                  <th className="w-24 px-3 py-2 text-right">投稿数</th>
                </tr>
              </thead>
              <tbody>
                {posters.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 opacity-80" colSpan={3}>
                      データがありません
                    </td>
                  </tr>
                ) : (
                  posters.map((p, i) => (
                    <tr key={`${p.sender_user_id ?? "null"}-${i}`} className="border-t border-white/10">
                      <td className="px-3 py-2">{i + 1}</td>
                      <td className="px-3 py-2">
                        {p.user_name?.trim() ? p.user_name : "(no name)"}
                      </td>
                      <td className="px-3 py-2 text-right">{p.post_count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-2 text-xs opacity-70">
            ※ {MERGE_A} と {MERGE_B} は同一ユーザーとして合算しています。
          </div>
        </div>

        {/* バトルランキング */}
        <div className="mt-8">
          <h2 className="text-lg font-bold">バトルランキング</h2>
          <div className="mt-2 overflow-hidden rounded border border-white/15">
            <table className="w-full text-sm">
              <thead className="bg-white/10">
                <tr>
                  <th className="px-3 py-2 text-left">バトル名</th>
                  <th className="w-24 px-3 py-2 text-right">投稿数</th>
                </tr>
              </thead>
              <tbody>
                {battles.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 opacity-80" colSpan={2}>
                      データがありません
                    </td>
                  </tr>
                ) : (
                  battles.map((b, i) => (
                    <tr key={`${b.battle_name}-${i}`} className="border-t border-white/10">
                      <td className="px-3 py-2">{b.battle_name}</td>
                      <td className="px-3 py-2 text-right">{b.post_count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* フッター補助 */}
        <div className="mt-10 text-xs opacity-60">
          URL例: <span className="select-all">/raids/rankings?groupId=Apoklisi</span>
        </div>
      </div>
    </div>
  );
}
