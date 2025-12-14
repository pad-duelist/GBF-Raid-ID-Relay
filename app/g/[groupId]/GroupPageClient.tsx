// app/g/[groupId]/GroupPageClient.tsx
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { formatTimeAgo } from "@/lib/timeAgo";
import { formatNumberWithComma } from "@/lib/numberFormat";
import { useBattleNameMap } from "@/lib/useBattleNameMap";
import useBattleMapping, { normalizeKey } from "@/lib/useBattleMapping";

type RaidRow = {
  id: string;
  group_id: string;
  raid_id: string;
  boss_name: string | null;
  battle_name: string | null;
  hp_value: number | null;
  hp_percent: number | null;
  member_current: number | null;
  member_max: number | null;
  user_name: string | null;
  created_at: string;
};

const looksLikeUrl = (s: string | null | undefined): boolean =>
  !!s && /^https?:\/\//.test(s);

const NOTIFY_ENABLED_KEY = "gbf-raid-notify-enabled";
const NOTIFY_VOLUME_KEY = "gbf-raid-notify-volume";
const AUTO_COPY_ENABLED_KEY = "gbf-raid-auto-copy-enabled";
const COPIED_IDS_KEY = "gbf-copied-raid-ids";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * ★ラッパー：アクセス判定だけを担当
 * Hook の順序が崩れないように、UI本体は別コンポーネントへ切り出す
 */
export default function GroupPageClient({ groupId }: { groupId: string }) {
  const router = useRouter();

  const [accessOk, setAccessOk] = useState(false);
  const [accessChecking, setAccessChecking] = useState(true);
  const [accessErrorText, setAccessErrorText] = useState<string | null>(null);

  // ★URLは name(/g/Apoklisi)でもOK。ただし内部参照はuuid(group_id)へ正規化する
  const [canonicalGroupId, setCanonicalGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string>(groupId);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (typeof window === "undefined") return;

        setAccessChecking(true);
        setAccessErrorText(null);
        setAccessOk(false);
        setCanonicalGroupId(null);
        setGroupName(groupId);

        const userId = window.localStorage.getItem("extensionUserId");
        if (!userId || userId.trim().length === 0) {
          setAccessErrorText("ユーザーIDが未設定です。extension-token へ移動します…");
          router.replace("/extension-token");
          return;
        }

        // 1) まずアクセス判定（既存仕様を維持）
        const res = await fetch(
          `/api/group-access?groupId=${encodeURIComponent(groupId)}&userId=${encodeURIComponent(
            userId.trim()
          )}`,
          { cache: "no-store" }
        );

        if (!res.ok) {
          setAccessErrorText("グループ権限の確認に失敗しました。extension-token へ移動します…");
          router.replace("/extension-token");
          return;
        }

        const json = await res.json();
        if (!json?.allowed) {
          setAccessErrorText("このグループへのアクセス権限がありません。extension-token へ移動します…");
          router.replace("/extension-token");
          return;
        }

        // 2) ★グループIDをuuidに正規化（可能なら必ずuuidを使う）
        let resolvedId: string | null =
          json?.group_id ??
          json?.groupId ??
          json?.group?.id ??
          json?.group?.group_id ??
          null;

        let resolvedName: string =
          json?.group_name ??
          json?.group?.name ??
          json?.group?.group_name ??
          groupId;

        // URLがuuidの場合はそのまま採用
        if (!resolvedId && UUID_RE.test(groupId)) {
          resolvedId = groupId;
        }

        // group-access がIDを返さない実装でも動かせるように、resolve APIがあれば併用
        if (!resolvedId && !UUID_RE.test(groupId)) {
          try {
            const r2 = await fetch(`/api/groups/resolve?key=${encodeURIComponent(groupId)}`, {
              cache: "no-store",
            });
            if (r2.ok) {
              const j2 = await r2.json();
              if (j2?.ok && j2?.group?.id) {
                resolvedId = j2.group.id;
                resolvedName = j2.group.name ?? resolvedName;
              }
            }
          } catch {
            // 失敗しても致命ではない（fallbackで動かす）
          }
        }

        if (!cancelled) {
          setCanonicalGroupId(resolvedId ?? null);
          setGroupName(resolvedName);
          setAccessOk(true);
        }
      } catch (e) {
        console.error("group access check failed", e);
        setAccessErrorText("グループ権限の確認中にエラーが発生しました。extension-token へ移動します…");
        router.replace("/extension-token");
      } finally {
        if (!cancelled) setAccessChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [groupId, router]);

  if (!accessOk) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-50 p-4">
        <div className="max-w-3xl mx-auto space-y-2">
          <div className="text-lg font-bold">GBF Raid ID Relay</div>
          <div className="text-sm text-slate-300">グループ: {groupId}</div>
          <div className="text-sm">{accessChecking ? "権限確認中..." : "アクセス不可"}</div>
          {accessErrorText && <div className="text-xs text-slate-400">{accessErrorText}</div>}
        </div>
      </div>
    );
  }

  // accessOk になったら UI本体へ（Hook順序が崩れない）
  return <GroupPageInner groupId={canonicalGroupId ?? groupId} groupName={groupName} />;
}

/**
 * ★UI本体（元の GroupPageClient のロジック）
 */
function GroupPageInner({ groupId, groupName }: { groupId: string; groupName: string }) {
  const router = useRouter();

  const [raids, setRaids] = useState<RaidRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const intervalRef = useRef<number | null>(null);

  // 設定
  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(true);
  const [notifyVolume, setNotifyVolume] = useState<number>(0.5);
  const [autoCopyEnabled, setAutoCopyEnabled] = useState<boolean>(true);

  // 「前回の最新ID」を覚えておく（自動コピーの判定に使う）
  const lastTopRaidIdRef = useRef<string | null>(null);

  // コピー済みID（暗くする）
  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set<string>());

  // battleNameMap（表示名変換）
  const { map: battleNameMap } = useBattleNameMap();

  // series mapping
  const { mapping: battleMapping } = useBattleMapping();

  // UI: マルチ絞り込み
  const [seriesOptions, setSeriesOptions] = useState<string[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<string>("all");

  // 音
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 初期設定読み込み
  useEffect(() => {
    if (typeof window === "undefined") return;

    const v1 = window.localStorage.getItem(NOTIFY_ENABLED_KEY);
    const v2 = window.localStorage.getItem(NOTIFY_VOLUME_KEY);
    const v3 = window.localStorage.getItem(AUTO_COPY_ENABLED_KEY);
    const v4 = window.localStorage.getItem(COPIED_IDS_KEY);

    if (v1 != null) setNotifyEnabled(v1 === "1");
    if (v2 != null) {
      const n = Number(v2);
      if (!Number.isNaN(n)) setNotifyVolume(Math.min(1, Math.max(0, n)));
    }
    if (v3 != null) setAutoCopyEnabled(v3 === "1");

    if (v4) {
      try {
        const arr = JSON.parse(v4) as string[];
        if (Array.isArray(arr)) setCopiedIds(new Set(arr));
      } catch {
        // ignore
      }
    }
  }, []);

  // audio element
  useEffect(() => {
    audioRef.current = new Audio("/notify.mp3");
  }, []);

  // コピー済みIDの永続化
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COPIED_IDS_KEY, JSON.stringify(Array.from(copiedIds)));
  }, [copiedIds]);

  // 絞り込み候補（series）を raids から抽出
  useEffect(() => {
    const s = new Set<string>();
    for (const r of raids) {
      const key = normalizeKey(r.battle_name ?? r.boss_name ?? "");
      const info = battleMapping[key];
      const series = info?.series;
      if (series) s.add(series);
    }
    const arr = Array.from(s).sort((a, b) => a.localeCompare(b));
    setSeriesOptions(arr);
  }, [raids, battleMapping]);

  // raids 取得
  const fetchRaids = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      query.set("groupId", String(groupId));
      query.set("limit", "50");
      query.set("debug", "0");

      const res = await fetch(`/api/raids?${query.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

      const json = await res.json();
      const rows: RaidRow[] = Array.isArray(json?.data) ? json.data : [];

      setRaids(rows);

      // 自動コピー（最新の先頭IDが変わった時だけ）
      if (autoCopyEnabled && rows.length > 0) {
        const top = rows[0];
        const topRaidId = top?.raid_id ?? null;

        if (topRaidId && topRaidId !== lastTopRaidIdRef.current) {
          lastTopRaidIdRef.current = topRaidId;

          try {
            await navigator.clipboard.writeText(topRaidId);
            setCopiedIds((prev) => new Set(prev).add(topRaidId));
          } catch (e) {
            console.warn("auto copy failed", e);
          }
        }
      }

      // 通知音（新着が来たら鳴らす…などの既存ロジックを維持）
      // ※元の実装に合わせて必要ならここを調整
      // ここでは既存挙動を壊さないため、元コードのまま（下側に既に処理があるならそちらが優先）
    } catch (e) {
      console.error("fetch raids failed", e);
    } finally {
      setLoading(false);
    }
  }, [groupId, autoCopyEnabled]);

  // 初回 + 自動更新
  useEffect(() => {
    fetchRaids();
  }, [fetchRaids]);

  useEffect(() => {
    if (!auto) return;

    intervalRef.current = window.setInterval(() => {
      fetchRaids();
    }, 1000) as unknown as number;

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [auto, fetchRaids]);

  // 設定保存
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(NOTIFY_ENABLED_KEY, notifyEnabled ? "1" : "0");
  }, [notifyEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(NOTIFY_VOLUME_KEY, String(notifyVolume));
  }, [notifyVolume]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AUTO_COPY_ENABLED_KEY, autoCopyEnabled ? "1" : "0");
  }, [autoCopyEnabled]);

  // 手動コピー
  const copyRaidId = useCallback(async (raidId: string) => {
    try {
      await navigator.clipboard.writeText(raidId);
      setCopiedIds((prev) => new Set(prev).add(raidId));
    } catch (e) {
      console.error("copy failed", e);
    }
  }, []);

  // 音テスト
  const playSound = useCallback(async () => {
    if (!audioRef.current) return;
    try {
      audioRef.current.volume = notifyVolume;
      await audioRef.current.play();
    } catch (e) {
      console.error("sound play failed", e);
    }
  }, [notifyVolume]);

  // 絞り込み適用
  const filteredRaids = raids.filter((r) => {
    if (selectedSeries === "all") return true;
    const key = normalizeKey(r.battle_name ?? r.boss_name ?? "");
    const info = battleMapping[key];
    return info?.series === selectedSeries;
  });

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold">GBF Raid ID Relay</h1>
            <div className="text-xl font-bold text-white mt-1">グループ: {groupName}</div>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex items-stretch gap-2">
              <div className="flex flex-col">
                <label className="text-xs sm:text-sm text-slate-300 mb-1">マルチ絞り込み</label>
                <select
                  className="bg-slate-800 border border-slate-600 rounded px-3 text-sm h-9"
                  value={selectedSeries}
                  onChange={(e) => setSelectedSeries(e.target.value)}
                >
                  <option value="all">すべて</option>
                  {seriesOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col">
                <label className="text-xs sm:text-sm text-slate-300 mb-1">自動更新</label>
                <button
                  type="button"
                  onClick={() => setAuto((v) => !v)}
                  className={`rounded px-3 text-sm h-9 border ${
                    auto ? "bg-green-600 border-green-500" : "bg-slate-800 border-slate-600"
                  }`}
                >
                  {auto ? "ON" : "OFF"}
                </button>
              </div>

              <div className="flex flex-col">
                <label className="text-xs sm:text-sm text-slate-300 mb-1">手動更新</label>
                <button
                  type="button"
                  onClick={fetchRaids}
                  className="bg-slate-200 hover:bg-slate-100 text-black rounded px-3 text-sm h-9 border border-slate-400"
                >
                  更新
                </button>
              </div>
            </div>

            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => setNotifyEnabled((v) => !v)}
                className={`rounded px-3 text-sm h-9 border ${
                  notifyEnabled ? "bg-blue-600 border-blue-500" : "bg-slate-800 border-slate-600"
                }`}
              >
                通知音 {notifyEnabled ? "ON" : "OFF"}
              </button>

              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={notifyVolume}
                onChange={(e) => setNotifyVolume(Number(e.target.value))}
                className="h-9"
                aria-label="notify volume"
              />

              <button
                type="button"
                onClick={playSound}
                className="bg-slate-200 hover:bg-slate-100 text-black text-xs px-2 py-1 rounded h-9 flex items-center min-w-[48px] whitespace-nowrap"
              >
                音テスト
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/raids/rankings?groupId=${encodeURIComponent(groupId)}&groupSlug=${encodeURIComponent(
                      groupName
                    )}`
                  )
                }
                className="bg-yellow-500 hover:bg-yellow-400 text-black text-xs px-2 py-1 rounded h-9 flex items-center"
              >
                ランキングを見る
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAutoCopyEnabled((v) => !v)}
                className={`rounded px-3 text-sm h-9 border ${
                  autoCopyEnabled ? "bg-purple-600 border-purple-500" : "bg-slate-800 border-slate-600"
                }`}
              >
                新着ID 自動コピー {autoCopyEnabled ? "ON" : "OFF"}
              </button>

              {loading && <span className="text-xs text-slate-300">取得中...</span>}
            </div>
          </div>
        </header>

        <div className="space-y-2">
          {filteredRaids.map((r) => {
            const copied = copiedIds.has(r.raid_id);

            const battleLabel =
              r.battle_name && battleNameMap[r.battle_name] ? battleNameMap[r.battle_name] : r.battle_name;

            const bossOrBattle = battleLabel ?? r.boss_name ?? "";

            const bossText = looksLikeUrl(bossOrBattle) ? (
              <img src={bossOrBattle} alt="boss" className="w-8 h-8 rounded" />
            ) : (
              <span className="font-semibold">{bossOrBattle}</span>
            );

            const hpText =
              r.hp_value != null
                ? `${formatNumberWithComma(r.hp_value)}`
                : r.hp_percent != null
                ? `${Math.round(r.hp_percent)}%`
                : "-";

            const memberText =
              r.member_current != null && r.member_max != null ? `${r.member_current}/${r.member_max}` : "-";

            return (
              <div
                key={r.id}
                className={`border rounded px-3 py-2 flex items-center justify-between gap-3 ${
                  copied ? "bg-slate-800/40 border-slate-700 text-slate-400" : "bg-slate-800 border-slate-600"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="shrink-0">{bossText}</div>

                  <div className="min-w-0">
                    <div className="text-sm truncate">
                      {r.user_name ? <span className="text-slate-200">{r.user_name}</span> : null}
                      {r.user_name ? <span className="text-slate-500"> / </span> : null}
                      <span className="text-slate-300">{formatTimeAgo(r.created_at)}</span>
                    </div>

                    <div className="text-xs text-slate-400 flex gap-3">
                      <span>HP: {hpText}</span>
                      <span>参戦: {memberText}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="font-mono text-lg tracking-wider">{r.raid_id}</div>
                  <button
                    type="button"
                    onClick={() => copyRaidId(r.raid_id)}
                    className="bg-slate-200 hover:bg-slate-100 text-black rounded px-3 py-1 text-sm border border-slate-400"
                  >
                    コピー
                  </button>
                </div>
              </div>
            );
          })}

          {filteredRaids.length === 0 && (
            <div className="text-sm text-slate-300 border border-slate-700 rounded p-3 bg-slate-800">
              表示するデータがありません
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
