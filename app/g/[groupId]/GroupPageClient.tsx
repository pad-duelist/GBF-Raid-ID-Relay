// app/g/[groupId]/GroupPageClient.tsx
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { formatTimeAgo } from "@/lib/timeAgo";
import { formatNumberWithComma } from "@/lib/numberFormat";
import { useBattleNameMap } from "@/lib/useBattleNameMap";
import useBattleMapping, { normalizeKey } from "@/lib/useBattleMapping";

type RaidRow = {
  id: string;
  group_id: string;
  group_name?: string | null; // あっても使わない（互換のため）
  raid_id: string;
  boss_name: string | null;
  battle_name: string | null;
  hp_value: number | null;
  hp_percent: number | null;
  member_current: number | null;
  member_max: number | null;
  user_name: string | null;
  created_at: string;
  sender_user_id?: string | null; // Realtime受信時の自分除外用（あってもなくてもOK）
  series?: string | null;
};

const looksLikeUrl = (s: string | null | undefined): boolean =>
  !!s && /^https?:\/\//.test(s);

const NOTIFY_ENABLED_KEY = "gbf-raid-notify-enabled";
const NOTIFY_VOLUME_KEY = "gbf-raid-notify-volume";
const AUTO_COPY_ENABLED_KEY = "gbf-raid-auto-copy-enabled";
const COPIED_IDS_KEY = "gbf-copied-raid-ids";
const MEMBER_MAX_FILTER_KEY = "gbf-raid-member-max-filter";

/**
 * ★ラッパー：アクセス判定だけを担当
 * Hook の順序が崩れないように、UI本体は別コンポーネントへ切り出す
 */
export default function GroupPageClient({ groupId }: { groupId: string }) {
  const router = useRouter();

  const [accessOk, setAccessOk] = useState(false);
  const [accessChecking, setAccessChecking] = useState(true);
  const [accessErrorText, setAccessErrorText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (typeof window === "undefined") return;

        setAccessChecking(true);
        setAccessErrorText(null);
        setAccessOk(false);

        const userId = window.localStorage.getItem("extensionUserId");
        if (!userId || userId.trim().length === 0) {
          setAccessErrorText("ユーザーIDが未設定です。extension-token へ移動します…");
          router.replace("/extension-token");
          return;
        }

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

        if (!cancelled) setAccessOk(true);
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
          <div className="text-sm">{accessChecking ? "権限確認中." : "アクセス不可"}</div>
          {accessErrorText && <div className="text-xs text-slate-400">{accessErrorText}</div>}
        </div>
      </div>
    );
  }

  // accessOk になったら UI本体へ（Hook順序が崩れない）
  return <GroupPageInner groupId={groupId} />;
}

/**
 * ★UI本体（Realtime対応）
 * - 初回は /api/raids で取得
 * - 以降は /api/raids?mode=channel で得たチャンネルを Realtime(broadcast)購読
 */
function GroupPageInner({ groupId }: { groupId: string }) {
  const router = useRouter();

  const [raids, setRaids] = useState<RaidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bossFilter, setBossFilter] = useState<string>("");
  const [seriesFilter, setSeriesFilter] = useState<string>("");
  // ★参戦者数（現在）がこの人数以下のみ表示（""=無制限）
  const [memberMaxFilter, setMemberMaxFilter] = useState<number | null>(null);

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
  const { map: battleMappingMap } = useBattleMapping();

  const battleMappingMapRef = useRef<Record<string, any>>({});
  useEffect(() => {
    battleMappingMapRef.current = battleMappingMap as any;
  }, [battleMappingMap]);

  const prevAllIdsRef = useRef<Set<string>>(new Set());

  // ===== アクティブ復帰時の「最新IDコピー」用 =====
  const lastActiveCopiedRaidInternalIdRef = useRef<string | null>(null);
  const filteredRaidsRef = useRef<RaidRow[]>([]);
  const autoCopyEnabledRef = useRef<boolean>(true);
  const fetchRaidsRef = useRef<() => Promise<RaidRow[]>>(async () => []);
  const bossFilterRef = useRef<string>("");
  const seriesFilterRef = useRef<string>("");
  const memberMaxFilterRef = useRef<number | null>(null);

  const currentUserIdRef = useRef<string | null>(null);

  // Supabase client / Realtime channel 管理
  const sbRef = useRef<SupabaseClient | null>(null);
  const channelRef = useRef<any>(null);
  const subscribedGroupIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    currentUserIdRef.current = window.localStorage.getItem("extensionUserId");
  }, []);

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

  async function writeClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // フォールバック（古い環境など）
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  }

  const playNotifySound = useCallback(() => {
    if (!notifyEnabled) return;
    if (!audioRef.current) audioRef.current = new Audio("/notify.mp3");

    const audio = audioRef.current;
    audio.volume = notifyVolume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, [notifyEnabled, notifyVolume]);

  const getDisplayName = useCallback((raid: RaidRow): string => {
    const boss = raid.boss_name?.trim() || "";
    const battle = raid.battle_name?.trim() || "";
    if (boss && !looksLikeUrl(boss)) return boss;
    if (battle && !looksLikeUrl(battle)) return battle;
    return "不明なマルチ";
  }, []);

  const enrichSeries = useCallback((r: RaidRow): RaidRow => {
    const boss = r.boss_name?.trim() || "";
    const battle = r.battle_name?.trim() || "";
    let displayName = "不明なマルチ";
    if (boss && !looksLikeUrl(boss)) displayName = boss;
    else if (battle && !looksLikeUrl(battle)) displayName = battle;

    const key = normalizeKey(displayName);
    const mapping = (battleMappingMapRef.current as any)?.[key];
    const mergedSeries =
      r.series && r.series.toString().trim().length > 0
        ? r.series.toString().trim()
        : mapping?.series ?? null;

    return { ...r, series: mergedSeries };
  }, []);

  // battleMappingMap が更新されたら、既存リストの series を再計算（ポーリング無しでも表示が追従）
  useEffect(() => {
    setRaids((prev) => prev.map((r) => enrichSeries(r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleMappingMap]);

  const fetchRaids = useCallback(async (): Promise<RaidRow[]> => {
    if (!groupId) {
      setRaids([]);
      setLoading(false);
      return [];
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
        return [];
      }

      const json = await res.json();
      const rawData: RaidRow[] = Array.isArray(json) ? json : (json.raids as RaidRow[]) ?? [];
      const merged = rawData.map((r) => enrichSeries(r));

      setRaids(merged);
      return merged;
    } catch (e) {
      console.error("fetchRaids error", e);
      setRaids([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [enrichSeries, groupId]);

  // fetchRaids をイベントハンドラから呼べるようにref同期
  useEffect(() => {
    fetchRaidsRef.current = fetchRaids;
  }, [fetchRaids]);

  // 初回ロード（ポーリングはしない）
  useEffect(() => {
    setLoading(true);
    void fetchRaids();
  }, [groupId, fetchRaids]);

  async function copyId(text: string, internalId?: string) {
    try {
      const ok = await writeClipboard(text);
      if (!ok) return;

      setCopyMessage(`ID ${text} をコピーしました`);
      setTimeout(() => setCopyMessage(null), 1500);

      if (internalId) addToCopied(internalId);
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
    const savedMemberMax = window.localStorage.getItem(MEMBER_MAX_FILTER_KEY);

    if (savedEnabled !== null) setNotifyEnabled(savedEnabled === "true");
    if (savedVolume !== null) {
      const v = Number(savedVolume);
      if (!Number.isNaN(v) && v >= 0 && v <= 1) setNotifyVolume(v);
    }
    if (savedAutoCopy !== null) setAutoCopyEnabled(savedAutoCopy === "true");

    // ★参戦者数フィルタ復元（""/null = 無制限）
    if (savedMemberMax !== null) {
      const n = Number(savedMemberMax);
      if (!Number.isNaN(n) && n >= 2 && n <= 5) setMemberMaxFilter(n);
      else setMemberMaxFilter(null);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(NOTIFY_ENABLED_KEY, String(notifyEnabled));
    window.localStorage.setItem(NOTIFY_VOLUME_KEY, String(notifyVolume));
    window.localStorage.setItem(AUTO_COPY_ENABLED_KEY, String(autoCopyEnabled));
    window.localStorage.setItem(
      MEMBER_MAX_FILTER_KEY,
      memberMaxFilter == null ? "" : String(memberMaxFilter)
    );
  }, [notifyEnabled, notifyVolume, autoCopyEnabled, memberMaxFilter]);

  // ref同期（イベントハンドラで最新値を参照するため）
  useEffect(() => {
    autoCopyEnabledRef.current = autoCopyEnabled;
  }, [autoCopyEnabled]);
  useEffect(() => {
    bossFilterRef.current = bossFilter;
  }, [bossFilter]);
  useEffect(() => {
    seriesFilterRef.current = seriesFilter;
  }, [seriesFilter]);
  useEffect(() => {
    memberMaxFilterRef.current = memberMaxFilter;
  }, [memberMaxFilter]);

  const getImageUrl = (raid: RaidRow): string | undefined => {
    if (looksLikeUrl(raid.battle_name)) return raid.battle_name as string;
    if (looksLikeUrl(raid.boss_name)) return raid.boss_name as string;
    const name = getDisplayName(raid);
    return (battleMap as any)?.[name];
  };

  const matchesMemberMax = (raid: RaidRow, max: number | null): boolean => {
    if (max == null) return true;
    // 参戦者数が取れないものは判定不能なので表示（必要なら false に変更可能）
    if (raid.member_current == null) return true;
    return raid.member_current <= max;
  };

  // ===== Realtime購読セットアップ =====
  const teardownRealtime = useCallback(async () => {
    try {
      const sb = sbRef.current;
      const ch = channelRef.current;
      if (sb && ch) {
        await sb.removeChannel(ch);
      }
    } catch {
      // noop
    } finally {
      channelRef.current = null;
      subscribedGroupIdRef.current = null;
    }
  }, []);

  const upsertIncomingRaid = useCallback(
    (incoming: RaidRow) => {
      const mine = currentUserIdRef.current?.trim();
      if (mine && incoming.sender_user_id && incoming.sender_user_id === mine) return;

      setRaids((prev) => {
        // 重複排除
        if (prev.some((r) => r.id === incoming.id)) return prev;

        const enriched = enrichSeries(incoming);

        const next = [enriched, ...prev];

        // created_at 降順に整列（念のため）
        next.sort((a, b) => {
          const ta = Date.parse(a.created_at);
          const tb = Date.parse(b.created_at);
          if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
          return tb - ta;
        });

        // 表示上限（従来のfetchと合わせて50件）
        return next.slice(0, 50);
      });
    },
    [enrichSeries]
  );

  const setupRealtime = useCallback(async () => {
    if (!groupId) return;

    // supabase client 初期化（1回だけ）
    if (!sbRef.current) {
      sbRef.current = supabaseBrowser;
    }

    // すでに同一groupで購読中なら何もしない
    if (subscribedGroupIdRef.current === groupId && channelRef.current) return;

    // 既存購読は破棄
    await teardownRealtime();

    // チャンネル名をサーバーから取得（membershipチェック済みのもの）
    let userId = currentUserIdRef.current?.trim() || "";
    if (!userId && typeof window !== "undefined") {
      userId = window.localStorage.getItem("extensionUserId")?.trim() || "";
      currentUserIdRef.current = userId || null;
    }
    if (!userId) {
      console.warn("userId missing for channel fetch");
      return;
    }

    const q = new URLSearchParams({
      groupId: String(groupId),
      mode: "channel",
      userId,
    });

    const res = await fetch(`/api/raids?${q.toString()}`, { cache: "no-store" });
    if (!res.ok) {
      console.error("failed to fetch realtime channel", res.status);
      return;
    }

    const json = await res.json();
    const channelName = json?.channel as string | undefined;
    if (!channelName) {
      console.error("channel name not returned");
      return;
    }

    const sb = sbRef.current;

    // broadcast購読
    const ch = sb
      .channel(channelName)
      .on("broadcast", { event: "raid" }, (payload: any) => {
        // payload.payload に INSERTされた行が入る想定
        const row = (payload as any)?.payload as RaidRow | undefined;
        if (!row?.id) return;
        if (!row.raid_id) return;
        upsertIncomingRaid(row);
      });

    channelRef.current = ch;
    subscribedGroupIdRef.current = groupId;

    ch.subscribe((status: string) => {
      // SUBSCRIBED / TIMED_OUT / CLOSED / CHANNEL_ERROR
      if (status === "SUBSCRIBED") {
        // OK（表示は変えない：既存UI維持）
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("realtime subscribe failed:", status);
      }
    });
  }, [groupId, teardownRealtime, upsertIncomingRaid]);

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        if (disposed) return;
        await setupRealtime();
      } catch (e) {
        console.error("setupRealtime error", e);
      }
    })();

    return () => {
      disposed = true;
      void teardownRealtime();
    };
  }, [groupId, setupRealtime, teardownRealtime]);

  // ===== タブ/ウィンドウ復帰時の「瞬間コピー」ロジック（既存維持） =====
  useEffect(() => {
    let disposed = false;

    const pickLatestByCreatedAt = (list: RaidRow[]) => {
      if (!list || list.length === 0) return null;
      return list.reduce((a, b) => {
        const ta = Date.parse(a.created_at);
        const tb = Date.parse(b.created_at);
        if (Number.isNaN(ta)) return b;
        if (Number.isNaN(tb)) return a;
        return tb > ta ? b : a;
      });
    };

    const tryAutoCopyOnFocus = async () => {
      if (disposed) return;
      if (!autoCopyEnabledRef.current) return;

      const list = filteredRaidsRef.current || [];
      const latest = pickLatestByCreatedAt(list);
      if (!latest?.id) return;

      // 同じものを連続コピーしない
      if (lastActiveCopiedRaidInternalIdRef.current === latest.id) return;

      const ok = await writeClipboard(latest.raid_id);
      if (!ok) return;

      lastActiveCopiedRaidInternalIdRef.current = latest.id;
      setLastAutoCopiedRaidId(latest.id);
      addToCopied(latest.id);
      setCopyMessage(`ID ${latest.raid_id} をコピーしました`);
      setTimeout(() => setCopyMessage(null), 1500);
    };

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        void tryAutoCopyOnFocus();
      }
    };

    const onFocus = () => {
      void tryAutoCopyOnFocus();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("focus", onFocus);
    }

    return () => {
      disposed = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [addToCopied]);

  // ===== フィルタ＆表示用 =====
  const filteredRaids = raids.filter((raid) => {
    const displayName = getDisplayName(raid);
    const matchBoss = bossFilter ? displayName === bossFilter : true;

    const raidSeries = (raid.series ?? "").toString().trim();
    const matchSeries = seriesFilter ? raidSeries === seriesFilter : true;

    const matchMember = matchesMemberMax(raid, memberMaxFilter);

    return matchBoss && matchSeries && matchMember;
  });

  useEffect(() => {
    filteredRaidsRef.current = filteredRaids;
  }, [filteredRaids]);

  useEffect(() => {
    if (!filteredRaids || filteredRaids.length === 0) {
      seenFilteredRaidIdsRef.current = new Set();
      return;
    }

    const currentIds = new Set(filteredRaids.map((r) => r.id));
    const combinedFilterKey = `${bossFilter}|${seriesFilter}|${memberMaxFilter ?? ""}`;
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

    // 自動コピーは「このタブが前面」のときだけ実行（ブラウザの制限で失敗しやすいため）
    if (typeof document !== "undefined") {
      if (document.visibilityState !== "visible" || !document.hasFocus()) {
        seenFilteredRaidIdsRef.current = currentIds;
        return;
      }
    }

    const newlyAdded = filteredRaids.filter((raid) => !seenFilteredRaidIdsRef.current.has(raid.id));

    if (newlyAdded.length > 0) {
      const target = newlyAdded[0];
      (async () => {
        const ok = await writeClipboard(target.raid_id);
        if (!ok) {
          return;
        }
        setLastAutoCopiedRaidId(target.id);
        addToCopied(target.id);
        setCopyMessage(`ID ${target.raid_id} をコピーしました`);
        setTimeout(() => setCopyMessage(null), 1500);
      })().catch((err) => console.error("自動コピーに失敗しました:", err));
    }

    seenFilteredRaidIdsRef.current = currentIds;
  }, [filteredRaids, bossFilter, seriesFilter, memberMaxFilter, autoCopyEnabled, addToCopied]);

  const normalizePercent = (raw: number | null | undefined): number | null => {
    if (raw == null) return null;
    if (raw <= 1) return raw * 100;
    return raw;
  };

  const hpPercentStyle = (raw: number | null | undefined): React.CSSProperties => {
    const p = normalizePercent(raw);
    if (p == null) return { color: "#94a3b8" };
    if (p >= 99) return { color: "#50d552", fontWeight: 600 };
    if (p >= 90) return { color: "#b9d5b2 ", fontWeight: 500 };
    if (p <= 25) return { color: "#ff6347", fontWeight: 600 };
    if (p <= 50) return { color: "#e8d979", fontWeight: 500 };
    return { color: "#cbd5e1" };
  };

  const memberCountStyle = (count: number | null | undefined): React.CSSProperties => {
    if (count == null) return { color: "#94a3b8" };
    if (count <= 2) return { color: "#50d552", fontWeight: 600 };
    return { color: "#94a3b8" };
  };

  const uniqueBosses = Array.from(
    new Set(
      raids
        .map((r) => getDisplayName(r))
        .filter((v) => v && v !== "不明なマルチ")
    )
  );

  const seriesCountMap = raids.reduce<Record<string, number>>((acc, r) => {
    const raw = (r.series ?? "").toString();
    const normalized = raw.replace(/\u3000/g, " ").trim();
    if (!normalized) return acc;
    acc[normalized] = (acc[normalized] || 0) + 1;
    return acc;
  }, {});

  const uniqueSeries = Object.keys(seriesCountMap).sort();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-bold">GBF Raid ID Relay</h1>
            <div className="text-xl font-bold text-white mt-1">グループ: {groupId}</div>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex items-stretch gap-2">
              <div className="flex flex-col">
                <label className="text-xs sm:text-sm text-slate-300 mb-1">マルチ絞り込み</label>
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

              <div className="flex flex-col">
                <label className="text-xs sm:text-sm text-slate-300 mb-1">シリーズ</label>
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

              {/* ★参戦者数フィルタ（現在人数がN以下） */}
              <div className="flex flex-col">
                <label className="text-xs sm:text-sm text-slate-300 mb-1">参戦者数</label>
                <select
                  className="bg-slate-800 border border-slate-600 rounded px-3 text-xs sm:text-sm h-9"
                  value={memberMaxFilter == null ? "" : String(memberMaxFilter)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) setMemberMaxFilter(null);
                    else {
                      const n = Number(v);
                      if (!Number.isNaN(n)) setMemberMaxFilter(n);
                      else setMemberMaxFilter(null);
                    }
                  }}
                >
                  <option value="">すべて</option>
                  <option value="5">5人以下</option>
                  <option value="4">4人以下</option>
                  <option value="3">3人以下</option>
                  <option value="2">2人以下</option>
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

              {/* 任意：手動更新（Realtimeが瞬断した時の保険として有用。既存UXを壊さず追加） */}
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  void fetchRaidsRef.current();
                }}
                className="bg-slate-700 hover:bg-slate-600 text-xs px-2 py-1 rounded h-9 flex items-center"
              >
                更新
              </button>
            </div>
          </div>
        </header>

        {copyMessage && <div className="text-sm text-emerald-300">{copyMessage}</div>}

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

              const percentRaw = raid.hp_percent;
              const percentNorm = normalizePercent(percentRaw);
              const percentDisplay = percentNorm == null ? null : `${percentNorm.toFixed(1)}%`;

              const hpValueNumber = raid.hp_value != null ? raid.hp_value : null;

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
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <div className="text-xs text-slate-300">{raid.user_name ?? "匿名"}</div>

                    {memberText && (
                      <div style={memberCountStyle(raid.member_current)} className="text-xs font-mono">
                        {memberText}
                      </div>
                    )}

                    <div className="text-xs">
                      {hpValueNumber != null ? (
                        <span className="font-mono">
                          {formatNumberWithComma(hpValueNumber)}
                          {percentDisplay ? (
                            <span style={hpPercentStyle(percentRaw)} className="ml-2">
                              HP {percentDisplay}
                            </span>
                          ) : (
                            <span className="ml-2 text-slate-400">HP ?</span>
                          )}
                        </span>
                      ) : percentDisplay ? (
                        <span style={hpPercentStyle(percentRaw)} className="font-mono">
                          HP {percentDisplay}
                        </span>
                      ) : (
                        <span className="text-slate-400">HP ?</span>
                      )}
                    </div>
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
