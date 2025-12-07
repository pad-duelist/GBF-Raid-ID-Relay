"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
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
  series?: string | null;
};

const looksLikeUrl = (s: string | null | undefined): boolean =>
  !!s && /^https?:\/\//.test(s);

const NOTIFY_ENABLED_KEY = "gbf-raid-notify-enabled";
const NOTIFY_VOLUME_KEY = "gbf-raid-notify-volume";
const AUTO_COPY_ENABLED_KEY = "gbf-raid-auto-copy-enabled";
const COPIED_IDS_KEY = "gbf-copied-raid-ids";

export default function GroupPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const router = useRouter();

  const [raids, setRaids] = useState<RaidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bossFilter, setBossFilter] = useState<string>("");
  const [seriesFilter, setSeriesFilter] = useState<string>("");
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(true);
  const [notifyVolume, setNotifyVolume] = useState<number>(0.7);

  const [autoCopyEnabled, setAutoCopyEnabled] = useState<boolean>(true);
  const [lastAutoCopiedRaidId, setLastAutoCopiedRaidId] = useState<string | null>(null);
  const seenFilteredRaidIdsRef = useRef<Set<string>>(new Set());
  const autoCopyInitializedRef = useRef<boolean>(false);
  const prevFilterRef = useRef<string>("");

  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set());

  const battleMap = useBattleNameMap();
  const { map: battleMappingMap, loading: mappingLoading } = useBattleMapping();

  // 前回の全レコードIDセット（差分検出用）
  const prevAllIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(COPIED_IDS_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        setCopiedIds(new Set(arr));
      }
    } catch (e) {
      console.warn("copied ids load failed", e);
    }
  }, []);

  const addToCopied = useCallback((id: string) => {
    setCopiedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(COPIED_IDS_KEY, JSON.stringify(Array.from(next)));
        }
      } catch (e) {
        console.warn("failed to save copied ids", e);
      }
      return next;
    });
  }, []);

  const fetchRaids = async () => {
    if (!groupId) {
      setRaids([]);
      setLoading(false);
      return;
    }

    try {
      let userId: string | null = null;
      if (typeof window !== "undefined") {
        userId = localStorage.getItem("extensionUserId");
      }

      const query = new URLSearchParams({
        groupId: String(groupId),
        limit: "50",
      });

      if (userId && userId.trim().length > 0) {
        query.set("excludeUserId", userId.trim());
      }

      const res = await fetch(`/api/raids?${query.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        console.error("failed to fetch raids", res.status);
        setRaids([]);
        return;
      }

      const json = await res.json();

      // デバッグ: 生の API レスポンス（必要ならコンソールで確認）
      console.debug("/api/raids raw:", json);

      const rawData: RaidRow[] = Array.isArray(json) ? json : (json.raids as RaidRow[]) ?? [];

      // マッピングを使って series を注入する（既存の r.series が空ならマッピングを使う）
      const merged = rawData.map((r) => {
        const boss = r.boss_name?.trim() || "";
        const battle = r.battle_name?.trim() || "";
        let displayName = "不明なマルチ";
        if (boss && !looksLikeUrl(boss)) displayName = boss;
        else if (battle && !looksLikeUrl(battle)) displayName = battle;

        const key = normalizeKey(displayName);
        const mapping = battleMappingMap[key];
        const mergedSeries =
          (r.series && r.series.toString().trim().length > 0)
            ? r.series.toString().trim()
            : mapping?.series ?? null;

        return { ...r, series: mergedSeries };
      });

      // デバッグ: merged の sample を出力（コンソールでチェック）
      console.debug(
        "merged sample (first 10):",
        merged.slice(0, 10).map((r) => ({
          id: r.id,
          raid_id: r.raid_id,
          display: r.boss_name || r.battle_name,
          series: r.series,
        }))
      );

      setRaids(merged);
    } catch (e) {
      console.error("fetchRaids error", e);
      setRaids([]);
    } finally {
      setLoading(false);
    }
  };

  // groupId やマッピングが変わったら再取得
  useEffect(() => {
    setLoading(true);
    fetchRaids();
    const timer = setInterval(fetchRaids, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, battleMappingMap]);

  async function copyId(text: string, internalId?: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage(`ID ${text} をコピーしました`);
      setTimeout(() => setCopyMessage(null), 1500);

      if (internalId) {
        addToCopied(internalId);
      }
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    audioRef.current = new Audio("/notify.mp3");

    if (typeof window === "undefined") return;

    const savedEnabled = window.localStorage.getItem(NOTIFY_ENABLED_KEY);
    const savedVolume = window.localStorage.getItem(NOTIFY_VOLUME_KEY);
    const savedAutoCopy = window.localStorage.getItem(AUTO_COPY_ENABLED_KEY);

    if (savedEnabled !== null) setNotifyEnabled(savedEnabled === "true");
    if (savedVolume !== null) {
      const v = Number(savedVolume);
      if (!Number.isNaN(v) && v >= 0 && v <= 1) setNotifyVolume(v);
    }
    if (savedAutoCopy !== null) setAutoCopyEnabled(savedAutoCopy === "true");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(NOTIFY_ENABLED_KEY, String(notifyEnabled));
    window.localStorage.setItem(NOTIFY_VOLUME_KEY, String(notifyVolume));
    window.localStorage.setItem(AUTO_COPY_ENABLED_KEY, String(autoCopyEnabled));
  }, [notifyEnabled, notifyVolume, autoCopyEnabled]);

  const playNotifySound = useCallback(() => {
    if (!notifyEnabled) return;
    if (!audioRef.current) audioRef.current = new Audio("/notify.mp3");

    const audio = audioRef.current;
    audio.volume = notifyVolume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, [notifyEnabled, notifyVolume]);

  const getDisplayName = (raid: RaidRow): string => {
    const boss = raid.boss_name?.trim() || "";
    const battle = raid.battle_name?.trim() || "";
    if (boss && !looksLikeUrl(boss)) return boss;
    if (battle && !looksLikeUrl(battle)) return battle;
    return "不明なマルチ";
  };

  const getImageUrl = (raid: RaidRow): string | undefined => {
    if (looksLikeUrl(raid.battle_name)) return raid.battle_name as string;
    if (looksLikeUrl(raid.boss_name)) return raid.boss_name as string;
    const name = getDisplayName(raid);
    return battleMap[name];
  };

  const uniqueBosses = Array.from(
    new Set(
      raids
        .map((r) => getDisplayName(r))
        .filter((v) => v && v !== "不明なマルチ")
    )
  );

  // series の正規化＋カウント（内部で件数は保持するが表示には使わない）
  const seriesCountMap = raids.reduce<Record<string, number>>((acc, r) => {
    const raw = (r.series ?? "").toString();
    const normalized = raw.replace(/\u3000/g, " ").trim();
    if (!normalized) return acc;
    acc[normalized] = (acc[normalized] || 0) + 1;
    return acc;
  }, {});

  const uniqueSeries = Object.keys(seriesCountMap).sort();

  // 両方のフィルタを適用（表示用）
  const filteredRaids = raids.filter((raid) => {
    const matchBoss = bossFilter ? getDisplayName(raid) === bossFilter : true;
    const raidSeries = (raid.series ?? "").toString().trim();
    const matchSeries = seriesFilter ? raidSeries === seriesFilter : true;
    return matchBoss && matchSeries;
  });

  // --- 通知ロジック（差分検出して、差分の中に現在のフィルタに合致するレコードがあれば通知） ---
  useEffect(() => {
    if (!raids) return;

    const currentIdsSet = new Set(raids.map((r) => r.id));
    const prev = prevAllIdsRef.current;

    // 初回（prev が空）は初期化のみして通知しない
    if (prev.size === 0) {
      prevAllIdsRef.current = currentIdsSet;
      return;
    }

    // 差分（新着ID）を抽出
    const newIds = raids.filter((r) => !prev.has(r.id));
    // 更新しておく（次回用）
    prevAllIdsRef.current = currentIdsSet;

    if (newIds.length === 0) return;

    // 新着のうち、現在のフィルタに合致するものがあるか確認
    const hasMatch = newIds.some((r) => {
      const matchBoss = bossFilter ? getDisplayName(r) === bossFilter : true;
      const raidSeries = (r.series ?? "").toString().trim();
      const matchSeries = seriesFilter ? raidSeries === seriesFilter : true;
      return matchBoss && matchSeries;
    });

    if (hasMatch) {
      playNotifySound();
    }
  }, [raids, bossFilter, seriesFilter, playNotifySound]);

  // --- 自動コピーのロジック（フィルタされた一覧の差分を監視） ---
  useEffect(() => {
    if (!filteredRaids || filteredRaids.length === 0) {
      seenFilteredRaidIdsRef.current = new Set();
      return;
    }

    const currentIds = new Set(filteredRaids.map((r) => r.id));
    const combinedFilterKey = `${bossFilter}|${seriesFilter}`;
    const filterChanged = combinedFilterKey !== prevFilterRef.current;
    prevFilterRef.current = combinedFilterKey;

    if (!autoCopyInitializedRef.current || filterChanged) {
      seenFilteredRaidIdsRef.current = currentIds;
      autoCopyInitializedRef.current = true;
      return;
    }

    if (!autoCopyEnabled) {
      seenFilteredRaidIdsRef.current = currentIds;
      return;
    }

    const newlyAdded = filteredRaids.filter(
      (raid) => !seenFilteredRaidIdsRef.current.has(raid.id)
    );

    if (newlyAdded.length > 0) {
      const target = newlyAdded[0];
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(target.raid_id)
          .then(() => {
            setLastAutoCopiedRaidId(target.id);
            addToCopied(target.id);
            setCopyMessage(`ID ${target.raid_id} をコピーしました`);
            setTimeout(() => setCopyMessage(null), 1500);
          })
          .catch((err) => {
            console.error("自動コピーに失敗しました:", err);
          });
      }
    }

    seenFilteredRaidIdsRef.current = currentIds;
  }, [filteredRaids, bossFilter, seriesFilter, autoCopyEnabled, addToCopied]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold">参戦ID共有ビューア</h1>
            <div className="text-xl font-bold text-white mt-1">グループ: {groupId}</div>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            {/* 並べて表示する行（ボス絞り込み + シリーズ絞り込み） */}
            <div className="flex items-stretch gap-2">
              {/* マルチ絞り込み */}
              <div className="flex flex-col">
                <label className="text-xs sm:text-sm text-slate-300 mb-1">
                  マルチ絞り込み
                </label>
                <select
                  className="bg-slate-800 border border-slate-600 rounded px-3 text-xs sm:text-sm h-9"
                  value={bossFilter}
                  onChange={(e) => setBossFilter(e.target.value)}
                >
                  <option value="">すべて</option>
                  {uniqueBosses.map((boss) => (
                    <option key={boss} value={boss}>
                      {boss}
                    </option>
                  ))}
                </select>
              </div>

              {/* シリーズ絞り込み（高さを boss と揃える） */}
              <div className="flex flex-col">
                <label className="text-xs sm:text-sm text-slate-300 mb-1">
                  シリーズ絞り込み
                </label>
                <select
                  className="bg-slate-800 border border-slate-600 rounded px-3 text-xs sm:text-sm h-9"
                  value={seriesFilter}
                  onChange={(e) => setSeriesFilter(e.target.value)}
                >
                  <option value="">すべて</option>
                  {uniqueSeries.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => playNotifySound()}
                  className="bg-slate-700 hover:bg-slate-600 text-xs px-2 py-1 rounded h-9 flex items-center min-w-[48px] whitespace-nowrap"
                >
                  音テスト
                </button>

                <button
                  type="button"
                  onClick={() => router.push(`/raids/rankings?groupId=${groupId}`)}
                  className="bg-yellow-500 hover:bg-yellow-400 text-black text-xs px-2 py-1 rounded h-9 flex items-center"
                >
                  ランキングを見る
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
              <label className="inline-flex items-center gap-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={notifyEnabled}
                  onChange={(e) => setNotifyEnabled(e.target.checked)}
                />
                <span>通知音</span>
              </label>

              <div className="flex items-center gap-2">
                <span className="whitespace-nowrap">音量</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(notifyVolume * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    const normalized = Math.min(100, Math.max(0, v)) / 100;
                    setNotifyVolume(normalized);
                  }}
                />
                <span className="w-10 text-right">{Math.round(notifyVolume * 100)}%</span>
              </div>

              <label className="inline-flex items-center gap-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={autoCopyEnabled}
                  onChange={(e) => setAutoCopyEnabled(e.target.checked)}
                />
                <span>自動コピー</span>
              </label>
            </div>
          </div>
        </header>

        {copyMessage && (
          <div className="text-sm text-emerald-300">{copyMessage}</div>
        )}

        {loading ? (
          <div>読み込み中...</div>
        ) : filteredRaids.length === 0 ? (
          <div className="text-slate-400 text-sm">まだIDが流れていません。</div>
        ) : (
          <div className="space-y-2">
            {filteredRaids.map((raid) => {
              const created = new Date(raid.created_at);
              const timeAgo = formatTimeAgo(created);

              const labelName = getDisplayName(raid);
              const imageUrl = getImageUrl(raid);

              let hpText = "HP 不明";
              if (raid.hp_value != null && raid.hp_percent != null) {
                hpText = `${formatNumberWithComma(
                  raid.hp_value
                )} HP (${raid.hp_percent.toFixed(1)}%)`;
              }

              const memberText =
                raid.member_current != null && raid.member_max != null
                  ? `${raid.member_current}/${raid.member_max}`
                  : null;

              const isAutoCopied = raid.id === lastAutoCopiedRaidId;
              const isCopied = copiedIds.has(raid.id);

              return (
                <div
                  key={raid.id}
                  onClick={() => copyId(raid.raid_id, raid.id)}
                  className={
                    "flex items-center justify-between bg-slate-800/80 rounded-lg px-3 py-2 text-sm shadow cursor-pointer hover:bg-slate-700/80 transition-colors" +
                    (isAutoCopied ? " ring-2 ring-emerald-400" : "") +
                    (isCopied ? " opacity-60" : "")
                  }
                >
                  <div className="flex items-center gap-3">
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt={labelName}
                        style={{ width: 90, height: 63 }}
                        className="rounded"
                      />
                    )}
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-base underline decoration-dotted">
                          {raid.raid_id}
                        </span>
                        <span className="text-xs text-slate-400">{timeAgo}</span>
                      </div>
                      <div className="text-xs text-slate-300">{labelName}</div>
                      {/* シリーズ表記は削除済み */}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <div className="text-xs text-slate-300">
                      {raid.user_name ?? "匿名"}
                    </div>

                    {memberText && (
                      <div className="text-xs font-mono text-slate-200">{memberText}</div>
                    )}

                    <div className="text-xs text-slate-400">{hpText}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
