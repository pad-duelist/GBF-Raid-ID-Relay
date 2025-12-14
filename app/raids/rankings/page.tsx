// app/raids/rankings/page.tsx
"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

export default function RaidRankingsPage() {
  const router = useRouter();

  // URLから読んだ生の値（UUIDでもグループ名でもOKにする）
  const [groupParam, setGroupParam] = useState<string>(""); // 旧 groupId 相当
  const [userId, setUserId] = useState<string>("");

  // 解決した UUID / 表示名
  const [resolvedGroupId, setResolvedGroupId] = useState<string>("");
  const [resolvedGroupName, setResolvedGroupName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const [posters, setPosters] = useState<Poster[]>([]);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [days, setDays] = useState<number>(7);
  const [limit, setLimit] = useState<number>(10);
  const [auto, setAuto] = useState<boolean>(true);
  const intervalRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // URL クエリから groupId / group_name / userId を読む
  useEffect(() => {
    const readFromUrl = () => {
      const params = new URLSearchParams(window.location.search);

      // 互換：?groupId=... を優先、無ければ ?group_name=...
      const gp = params.get("groupId") || params.get("group_name") || "";
      setGroupParam(gp);

      // グループ名→UUID解決に必要（既にURLに入っている想定）
      setUserId(params.get("userId") || params.get("user_id") || "");
    };

    readFromUrl();
    window.addEventListener("popstate", readFromUrl);
    return () => window.removeEventListener("popstate", readFromUrl);
  }, []);

  // groupParam が「UUIDかグループ名か」を判定し、必要なら UUID を解決する
  useEffect(() => {
    let cancelled = false;

    async function resolveGroup() {
      setErrorMsg("");
      setResolvedGroupName(null);

      if (!groupParam) {
        setResolvedGroupId("");
        return;
      }

      // すでにUUIDならそのまま使う
      if (isUuidLike(groupParam)) {
        setResolvedGroupId(groupParam);
        return;
      }

      // UUIDでない（=グループ名っぽい）ので解決を試みる
      // userId が無いと所属チェック系APIに弾かれる可能性があるため、無ければ諦めてそのまま進める
      if (!userId) {
        setResolvedGroupId(""); // ここが空だと effectiveGroupId は groupParam を使う（＝サーバ側対応があれば動く）
        setErrorMsg("userId がURLに無いため、グループ名→UUID解決ができません。");
        return;
      }

      setResolving(true);
      try {
        // 1) group-access がある想定：所属チェック＋解決（レスポンス形は環境差があるので柔軟に読む）
        const r = await fetch(
          `/api/group-access?groupId=${encodeURIComponent(groupParam)}&userId=${encodeURIComponent(
            userId
          )}&debug=1`,
          { cache: "no-store" }
        );

        const j = await r.json().catch(() => ({} as any));

        if (cancelled) return;

        // 期待しうるキーを順番に拾う
        const matched =
          (j?.matchedGroupId as string | undefined) ||
          (j?.group_id as string | undefined) ||
          (j?.groupId as string | undefined) ||
          (j?.id as string | undefined) ||
          (Array.isArray(j?.resolvedGroupIds) ? (j.resolvedGroupIds[0] as string | undefined) : undefined) ||
          "";

        const name =
          (j?.group_name as string | undefined) ||
          (j?.groupName as string | undefined) ||
          (j?.name as string | undefined) ||
          (j?.group?.name as string | undefined) ||
          null;

        if (matched && isUuidLike(matched)) {
          setResolvedGroupId(matched);
          setResolvedGroupName(name ?? groupParam);
          return;
        }

        // 2) 念のため raids API から推測（データが1件でもあれば group_id が取れる）
        const r2 = await fetch(
          `/api/raids?groupId=${encodeURIComponent(groupParam)}&userId=${encodeURIComponent(
            userId
          )}&limit=1`,
          { cache: "no-store" }
        );
        const j2 = (await r2.json().catch(() => [])) as any[];

        if (cancelled) return;

        const inferred = Array.isArray(j2) && j2[0]?.group_id ? String(j2[0].group_id) : "";
        const inferredName =
          Array.isArray(j2) && (j2[0]?.group_name || j2[0]?.groups?.name)
            ? String(j2[0]?.group_name || j2[0]?.groups?.name)
            : null;

        if (inferred && isUuidLike(inferred)) {
          setResolvedGroupId(inferred);
          setResolvedGroupName(inferredName ?? groupParam);
          return;
        }

        // 解決できなかった
        setResolvedGroupId("");
        setResolvedGroupName(groupParam);
        setErrorMsg("グループ名からUUIDを解決できませんでした（group-access / raids の応答を確認してください）。");
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setResolvedGroupId("");
          setResolvedGroupName(groupParam);
          setErrorMsg("グループ名→UUID解決中にエラーが発生しました。");
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    }

    resolveGroup();
    return () => {
      cancelled = true;
    };
  }, [groupParam, userId]);

  // ランキング取得に使う実効 group_id（UUIDが解決できたらそれ、できなければ生の値）
  const effectiveGroupId = useMemo(() => resolvedGroupId || groupParam, [resolvedGroupId, groupParam]);

  const groupLabel = useMemo(() => {
    if (resolvedGroupName) return resolvedGroupName;
    if (!groupParam) return "未指定";
    return isUuidLike(groupParam) ? shortId(groupParam) : groupParam;
  }, [groupParam, resolvedGroupName]);

  async function fetchRankings() {
    if (!effectiveGroupId) return;

    setLoading(true);
    setErrorMsg("");
    try {
      const fetchLimit = Math.min(Math.max(limit * 5, limit), 50);

      // 互換のため:
      // - group_id=UUID（可能なら） で投げる
      // - groupId=元の値（UUID/名前どちらでも） も付ける（サーバ側が groupIdParam を見る実装でも対応できる）
      // - userId も付ける（サーバ側で所属チェックする実装に備える）
      const common =
        `days=${days}&limit=${fetchLimit}` +
        `&group_id=${encodeURIComponent(effectiveGroupId)}` +
        `&groupId=${encodeURIComponent(groupParam)}` +
        (userId ? `&userId=${encodeURIComponent(userId)}` : "");

      const [pRes, bRes] = await Promise.all([
        fetch(`/api/raids/rank/top-posters?${common}`, { cache: "no-store" }),
        fetch(`/api/raids/rank/top-battles?${common}`, { cache: "no-store" }),
      ]);

      const pj = await pRes.json().catch(() => ({} as any));
      const bj = await bRes.json().catch(() => ({} as any));

      const rawPosters: Poster[] = pj?.ok ? (pj.data as Poster[]) : [];
      const rawBattles: Battle[] = bj?.ok ? (bj.data as Battle[]) : [];

      const nextPosters = [...rawPosters]
        .sort((a, b) => (b.post_count ?? 0) - (a.post_count ?? 0))
        .slice(0, limit);

      const nextBattles = [...rawBattles]
        .sort((a, b) => (b.post_count ?? 0) - (a.post_count ?? 0))
        .slice(0, limit);

      setPosters(nextPosters);
      setBattles(nextBattles);

      if (!pj?.ok || !bj?.ok) {
        // どちらかが失敗した場合は軽く出す
        const msg =
          pj?.error || bj?.error || pj?.message || bj?.message || "ランキング取得に失敗しました。";
        setErrorMsg(String(msg));
      }
    } catch (e) {
      console.error(e);
      setErrorMsg("ランキング取得中にエラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!effectiveGroupId) return;

    fetchRankings();

    if (auto) {
      intervalRef.current = window.setInterval(fetchRankings, 30_000) as unknown as number;
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveGroupId, days, limit, auto]);

  function handleBackToGroup() {
    // 戻る先は「元の groupParam」を優先（/g/[groupId] が名前でも動く想定）
    if (groupParam) {
      router.push(`/g/${encodeURIComponent(groupParam)}`);
    } else {
      router.back();
    }
  }

  return (
    <div className="p-4 bg-slate-900 min-h-screen text-slate-50">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">
          ランキング（グループ: {groupLabel}）
          {resolving && <span className="ml-2 text-sm text-gray-300">（解決中…）</span>}
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

        <button onClick={fetchRankings} className="ml-2 px-3 py-1 bg-white text-black rounded">
          手動更新
        </button>

        {loading && <span className="ml-2 text-sm text-gray-300">読み込み中…</span>}
      </div>

      {errorMsg && (
        <div className="mb-4 text-sm text-amber-200 bg-slate-800 rounded px-3 py-2">
          {errorMsg}
        </div>
      )}

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
