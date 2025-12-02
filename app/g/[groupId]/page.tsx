"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { formatTimeAgo } from "@/lib/timeAgo";
import { formatNumberWithComma } from "@/lib/numberFormat";
import { useBattleNameMap } from "@/lib/useBattleNameMap";

type RaidRow = {
  id: string;
  group_id: string;
  raid_id: string;
  boss_name: string | null;
  battle_name: string | null;
  hp_value: number | null;
  hp_percent: number | null;
  user_name: string | null;
  created_at: string;
};

const looksLikeUrl = (s: string | null | undefined): boolean =>
  !!s && /^https?:\/\//.test(s);

const NOTIFY_ENABLED_KEY = "gbf-raid-notify-enabled";
const NOTIFY_VOLUME_KEY = "gbf-raid-notify-volume";

export default function GroupPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const [raids, setRaids] = useState<RaidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bossFilter, setBossFilter] = useState<string>("");
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const [lastNotifiedId, setLastNotifiedId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(true);
  const [notifyVolume, setNotifyVolume] = useState<number>(0.7);

  const battleMap = useBattleNameMap();

  const fetchRaids = async () => {
    if (!groupId) {
      setRaids([]);
      setLoading(false);
      return;
    }

    try {
      // ★ 自分のユーザーIDを localStorage から取得
      let userId: string | null = null;
      try {
        if (typeof window !== "undefined") {
          userId = localStorage.getItem("extensionUserId");
        }
      } catch {
        userId = null;
      }

      const query = new URLSearchParams({
        groupId: String(groupId),
        limit: "50",
      });

      // 自分のユーザーIDがあれば、それを除外条件として渡す
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
      const data: RaidRow[] = Array.isArray(json)
        ? json
        : (json.raids as RaidRow[]) ?? [];

      setRaids(data);
    } catch (e) {
      console.error("fetchRaids error", e);
      setRaids([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchRaids();
    const timer = setInterval(fetchRaids, 1000);
    return () => clearInterval(timer);
  }, [groupId]);

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopyMessage(`ID ${id} をコピーしました`);
      setTimeout(() => setCopyMessage(null), 1500);
    } catch (e) {
      console.error(e);
    }
  }

  // 通知音と設定の初期化
  useEffect(() => {
    // Audio インスタンス初期化
    audioRef.current = new Audio("/notify.mp3");

    if (typeof window === "undefined") return;

    const savedEnabled = window.localStorage.getItem(NOTIFY_ENABLED_KEY);
    const savedVolume = window.localStorage.getItem(NOTIFY_VOLUME_KEY);

    if (savedEnabled !== null) {
      setNotifyEnabled(savedEnabled === "true");
    }
    if (savedVolume !== null) {
      const v = Number(savedVolume);
      if (!Number.isNaN(v) && v >= 0 && v <= 1) {
        setNotifyVolume(v);
      }
    }
  }, []);

  // 設定の保存
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(NOTIFY_ENABLED_KEY, String(notifyEnabled));
    window.localStorage.setItem(NOTIFY_VOLUME_KEY, String(notifyVolume));
  }, [notifyEnabled, notifyVolume]);

  const playNotifySound = useCallback(() => {
    if (!notifyEnabled) return;

    if (!audioRef.current) {
      audioRef.current = new Audio("/notify.mp3");
    }

    const audio = audioRef.current;
    audio.volume = notifyVolume; // 0.0〜1.0
    audio.currentTime = 0;

    audio
      .play()
      .catch(() => {
        /* ignore */
      });
  }, [notifyEnabled, notifyVolume]);

  // 新着IDで通知音を鳴らす
  useEffect(() => {
    if (!raids || raids.length === 0) return;

    const latestRaidId = raids[0].id;

    if (lastNotifiedId === null) {
      setLastNotifiedId(latestRaidId);
      return;
    }

    if (latestRaidId !== lastNotifiedId) {
      playNotifySound();
      setLastNotifiedId(latestRaidId);
    }
  }, [raids, lastNotifiedId, playNotifySound]);

  const getDisplayName = (raid: RaidRow): string => {
    const boss = raid.boss_name?.trim() || "";
    const battle = raid.battle_name?.trim() || "";

    if (boss && !looksLikeUrl(boss)) return boss;
    if (battle && !looksLikeUrl(battle)) return battle;
    return "不明なマルチ";
  };

  const getImageUrl = (raid: RaidRow): string | undefined => {
    if (looksLikeUrl(raid.battle_name)) {
      return raid.battle_name as string;
    }
    if (looksLikeUrl(raid.boss_name)) {
      return raid.boss_name as string;
    }
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

  const filteredRaids = bossFilter
    ? raids.filter((raid) => getDisplayName(raid) === bossFilter)
    : raids;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold">
              参戦ID共有ビューア - グループ: {groupId}
            </h1>
            <p className="text-sm text-slate-400">
              1秒ごとに自動更新 / クリックでIDコピー
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs sm:text-sm text-slate-300">
                  マルチ絞り込み
                </label>
                <select
                  className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs sm:text-sm"
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

              <button
                type="button"
                onClick={() => playNotifySound()}
                className="ml-2 bg-slate-700 hover:bg-slate-600 text-xs px-2 py-1 rounded"
              >
                音テスト
              </button>
            </div>

            {/* 通知音設定 */}
            <div className="flex items-center gap-3 text-xs sm:text-sm">
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
                    const normalized =
                      Math.min(100, Math.max(0, v)) / 100;
                    setNotifyVolume(normalized);
                  }}
                />
                <span className="w-10 text-right">
                  {Math.round(notifyVolume * 100)}%
                </span>
              </div>
            </div>
          </div>
        </header>

        {copyMessage && (
          <div className="text-sm text-emerald-300">{copyMessage}</div>
        )}

        {loading ? (
          <div>読み込み中...</div>
        ) : filteredRaids.length === 0 ? (
          <div className="text-slate-400 text-sm">
            まだIDが流れていません。
          </div>
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

              return (
                <div
                  key={raid.id}
                  onClick={() => copyId(raid.raid_id)}
                  className="flex items-center justify-between bg-slate-800/80 rounded-lg px-3 py-2 text-sm shadow cursor-pointer hover:bg-slate-700/80 transition-colors"
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
                        <span className="text-xs text-slate-400">
                          {timeAgo}
                        </span>
                      </div>
                      <div className="text-xs text-slate-300">
                        {labelName}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <div className="text-xs text-slate-300">
                      {raid.user_name ?? "匿名"}
                    </div>
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
