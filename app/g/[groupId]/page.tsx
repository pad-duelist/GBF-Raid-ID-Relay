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
  member_current: number | null; // ★ 追加
  member_max: number | null;     // ★ 追加
  user_name: string | null;
  created_at: string;
};

const looksLikeUrl = (s: string | null | undefined): boolean =>
  !!s && /^https?:\/\//.test(s);

const NOTIFY_ENABLED_KEY = "gbf-raid-notify-enabled";
const NOTIFY_VOLUME_KEY = "gbf-raid-notify-volume";
const AUTO_COPY_ENABLED_KEY = "gbf-raid-auto-copy-enabled";

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

  // 自動コピー関連
  const [autoCopyEnabled, setAutoCopyEnabled] = useState<boolean>(true);
  const [lastAutoCopiedRaidId, setLastAutoCopiedRaidId] = useState<string | null>(null);
  const seenFilteredRaidIdsRef = useRef<Set<string>>(new Set());
  const autoCopyInitializedRef = useRef<boolean>(false);
  const prevBossFilterRef = useRef<string>("");

  const battleMap = useBattleNameMap();

  const fetchRaids = async () => {
    if (!groupId) {
      setRaids([]);
      setLoading(false);
      return;
    }

    try {
      let userId: string | null = null;
      try {
        userId = localStorage.getItem("extensionUserId");
      } catch {}

      const query = new URLSearchParams({
        groupId: String(groupId),
        limit: "50",
      });

      if (userId) {
        query.set("excludeUserId", userId);
      }

      const res = await fetch(`/api/raids?${query.toString()}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        setRaids([]);
        return;
      }

      const json = await res.json();
      setRaids(Array.isArray(json) ? json : []);
    } catch {
      setRaids([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRaids();
    const timer = setInterval(fetchRaids, 1000);
    return () => clearInterval(timer);
  }, [groupId]);

  async function copyId(id: string) {
    await navigator.clipboard.writeText(id);
    setCopyMessage(`ID ${id} をコピーしました`);
    setTimeout(() => setCopyMessage(null), 1500);
  }

  useEffect(() => {
    audioRef.current = new Audio("/notify.mp3");

    const e = localStorage.getItem(NOTIFY_ENABLED_KEY);
    const v = localStorage.getItem(NOTIFY_VOLUME_KEY);
    const a = localStorage.getItem(AUTO_COPY_ENABLED_KEY);

    if (e !== null) setNotifyEnabled(e === "true");
    if (v !== null) setNotifyVolume(Number(v));
    if (a !== null) setAutoCopyEnabled(a === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem(NOTIFY_ENABLED_KEY, String(notifyEnabled));
    localStorage.setItem(NOTIFY_VOLUME_KEY, String(notifyVolume));
    localStorage.setItem(AUTO_COPY_ENABLED_KEY, String(autoCopyEnabled));
  }, [notifyEnabled, notifyVolume, autoCopyEnabled]);

  const playNotifySound = useCallback(() => {
    if (!notifyEnabled) return;
    if (!audioRef.current) audioRef.current = new Audio("/notify.mp3");
    audioRef.current.volume = notifyVolume;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
  }, [notifyEnabled, notifyVolume]);

  useEffect(() => {
    if (raids.length === 0) return;
    const latest = raids[0].id;
    if (lastNotifiedId && latest !== lastNotifiedId) playNotifySound();
    setLastNotifiedId(latest);
  }, [raids, lastNotifiedId, playNotifySound]);

  const getDisplayName = (raid: RaidRow): string => {
    if (raid.boss_name && !looksLikeUrl(raid.boss_name)) return raid.boss_name;
    if (raid.battle_name && !looksLikeUrl(raid.battle_name)) return raid.battle_name;
    return "不明なマルチ";
  };

  const getImageUrl = (raid: RaidRow): string | undefined => {
    if (looksLikeUrl(raid.battle_name)) return raid.battle_name!;
    if (looksLikeUrl(raid.boss_name)) return raid.boss_name!;
    return battleMap[getDisplayName(raid)];
  };

  const filteredRaids = bossFilter
    ? raids.filter((r) => getDisplayName(r) === bossFilter)
    : raids;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-4">
      <div className="max-w-3xl mx-auto space-y-3">
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
              const timeAgo = formatTimeAgo(new Date(raid.created_at));
              const label = getDisplayName(raid);
              const imageUrl = getImageUrl(raid);

              const hpText =
                raid.hp_value != null && raid.hp_percent != null
                  ? `${formatNumberWithComma(raid.hp_value)} HP (${raid.hp_percent.toFixed(1)}%)`
                  : "HP 不明";

              const memberText =
                raid.member_current != null && raid.member_max != null
                  ? `${raid.member_current}/${raid.member_max}`
                  : null;

              return (
                <div
                  key={raid.id}
                  onClick={() => copyId(raid.raid_id)}
                  className="flex justify-between items-center bg-slate-800/80 rounded-lg px-3 py-2 cursor-pointer hover:bg-slate-700"
                >
                  <div className="flex items-center gap-3">
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt={label}
                        style={{ width: 90, height: 63 }}
                        className="rounded"
                      />
                    )}
                    <div>
                      <div className="font-mono underline">{raid.raid_id}</div>
                      <div className="text-xs text-slate-400">{label}</div>
                      <div className="text-xs text-slate-500">{timeAgo}</div>
                    </div>
                  </div>

                  <div className="text-right text-xs">
                    <div>{raid.user_name ?? "匿名"}</div>
                    {memberText && (
                      <div className="font-mono text-slate-200">
                        {memberText}
                      </div>
                    )}
                    <div className="text-slate-400">{hpText}</div>
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
