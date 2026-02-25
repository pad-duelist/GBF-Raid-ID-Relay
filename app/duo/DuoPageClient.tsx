"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useBattleNameMap } from "@/lib/useBattleNameMap";
import { formatTimeAgo } from "@/lib/timeAgo";

type FastRow = {
  id: string;
  group_key: string;
  raid_id: string; // battle_idを格納してる想定（8桁）
  monster: string | null;
  created_at: string;
  sender_user_id: string;
};

const looksLikeUrl = (s: string | null | undefined): boolean => !!s && /^https?:\/\//.test(s);

const NOTIFY_ENABLED_KEY = "gbf-raid-notify-enabled";
const NOTIFY_VOLUME_KEY = "gbf-raid-notify-volume";
const AUTO_COPY_ENABLED_KEY = "gbf-raid-auto-copy-enabled";

// raidsと同じキー（互換）
const BOSS_FILTER_KEY = "gbf-raid-boss-filter";

const GROUP_KEY = "duo";
const keyForGroup = (base: string, groupId: string) => `${base}:${groupId}`;

export default function DuoPageClient() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient()!, []);

  // raidsと同じ：extensionUserId（= sender_user_id）で自分の投稿を除外
  const currentUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    currentUserIdRef.current = window.localStorage.getItem("extensionUserId");
    if (!currentUserIdRef.current) {
      // raidsページと同じ導線に寄せる
      router.replace("/extension-token");
    }
  }, [router]);

  const battleMap = useBattleNameMap();

  const [rows, setRows] = useState<FastRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [bossFilter, setBossFilter] = useState<string>("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [notifyVolume, setNotifyVolume] = useState(0.7);

  const [autoCopyEnabled, setAutoCopyEnabled] = useState(true);
  const autoCopyEnabledRef = useRef(true);
  const pendingCopyIdRef = useRef<string | null>(null);

  const lastUserGestureAtRef = useRef(0);
  const markUserGesture = useCallback(() => {
    lastUserGestureAtRef.current = Date.now();

    // 自動コピーが権限制約で弾かれた場合は、次のユーザー操作でコピーを再試行する
    const pending = pendingCopyIdRef.current;
    if (pending) {
      pendingCopyIdRef.current = null;
      void writeClipboard(pending);
    }
  }, []);

  // raidsと同じ：ユーザー操作検知（自動コピー成功率UP）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPointer = () => markUserGesture();
    const onKey = () => markUserGesture();
    window.addEventListener("pointerdown", onPointer, { capture: true });
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onPointer, { capture: true } as any);
      window.removeEventListener("keydown", onKey, { capture: true } as any);
    };
  }, [markUserGesture]);

  const canAttemptAutoClipboard = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    if (!window.isSecureContext) return false;
    if (document.visibilityState !== "visible") return false;
    if (!document.hasFocus()) return false;

    const ms = Date.now() - (lastUserGestureAtRef.current || 0);
    if (ms > 15000) return false;

    try {
      if ("permissions" in navigator && (navigator.permissions as any)?.query) {
        const st = await navigator.permissions.query({ name: "clipboard-write" as PermissionName });
        if (st.state === "denied") return false;
      }
    } catch {}

    return true;
  }, []);

  async function writeClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
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

  // 画像：スプシ由来の battleMap から引く（raidsと同じ）
  const getImageUrl = useCallback(
    (r: FastRow): string | undefined => {
      const name = (r.monster ?? "").trim();
      if (!name) return undefined;
      return (battleMap as any)?.[name];
    },
    [battleMap]
  );

  // 初期ロード（raids_fast）
  const fetchRows = useCallback(async (): Promise<FastRow[]> => {
    try {
      const mine = currentUserIdRef.current?.trim() || "";
      const { data, error } = await supabase
        .from("raids_fast")
        .select("id,group_key,raid_id,monster,created_at,sender_user_id")
        .eq("group_key", GROUP_KEY)
        .order("created_at", { ascending: false })
        .limit(80);

      if (error) {
        console.error("fetch raids_fast error", error);
        setRows([]);
        return [];
      }

      const list = (data ?? []) as FastRow[];

      // 自分の投稿は常に除外（/api/raidsと同じ）
      const filtered = mine ? list.filter((x) => x.sender_user_id !== mine) : list;

      setRows(filtered);
      return filtered;
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // localStorage 初期化（raidsと同じキー）
  useEffect(() => {
    if (typeof window === "undefined") return;

    audioRef.current = new Audio("/notify.mp3");

    const savedEnabled = window.localStorage.getItem(NOTIFY_ENABLED_KEY);
    const savedVolume = window.localStorage.getItem(NOTIFY_VOLUME_KEY);
    const savedAutoCopy = window.localStorage.getItem(AUTO_COPY_ENABLED_KEY);

    if (savedEnabled !== null) setNotifyEnabled(savedEnabled === "true");
    if (savedVolume !== null) {
      const v = Number(savedVolume);
      if (!Number.isNaN(v) && v >= 0 && v <= 1) setNotifyVolume(v);
    }
    if (savedAutoCopy !== null) setAutoCopyEnabled(savedAutoCopy === "true");

    const savedBoss = window.localStorage.getItem(keyForGroup(BOSS_FILTER_KEY, GROUP_KEY));
    if (savedBoss != null) setBossFilter(savedBoss);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(NOTIFY_ENABLED_KEY, String(notifyEnabled));
    window.localStorage.setItem(NOTIFY_VOLUME_KEY, String(notifyVolume));
    window.localStorage.setItem(AUTO_COPY_ENABLED_KEY, String(autoCopyEnabled));
    window.localStorage.setItem(keyForGroup(BOSS_FILTER_KEY, GROUP_KEY), bossFilter);
  }, [notifyEnabled, notifyVolume, autoCopyEnabled, bossFilter]);

  useEffect(() => {
    autoCopyEnabledRef.current = autoCopyEnabled;
  }, [autoCopyEnabled]);

  useEffect(() => {
    setLoading(true);
    void fetchRows();
  }, [fetchRows]);

  // Realtime（postgres_changes INSERT）
  const prevIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const mine = currentUserIdRef.current?.trim() || "";

    const channel = supabase
      .channel(`raids_fast:${GROUP_KEY}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "raids_fast",
          filter: `group_key=eq.${GROUP_KEY}`,
        },
        (payload) => {
          const incoming = payload.new as FastRow;
          if (!incoming?.id) return;

          // 自分の投稿は常に除外
          if (mine && incoming.sender_user_id === mine) return;

          setRows((prev) => {
            if (prev.some((x) => x.id === incoming.id)) return prev;
            const next = [incoming, ...prev].slice(0, 80);
            return next;
          });

          // bossFilterに一致するものだけ「通知＆自動コピー」対象にする（raidsの挙動寄せ）
          const matchBoss = bossFilter ? (incoming.monster ?? "").trim() === bossFilter : true;
          if (!matchBoss) return;

          playNotifySound();

          if (!autoCopyEnabledRef.current) return;

          (async () => {
            const okToTry = await canAttemptAutoClipboard();
            if (!okToTry) {
              // ユーザー操作がないと弾かれる環境があるので予約（次のクリックでコピー）
              pendingCopyIdRef.current = incoming.raid_id;
              return;
            }

            const ok = await writeClipboard(incoming.raid_id);
            if (!ok) {
              // Clipboard APIが弾かれたら予約（次のクリックでコピー）
              pendingCopyIdRef.current = incoming.raid_id;
            }
          })().catch(() => {});
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // bossFilterが変わった時に新しい条件で評価したいので依存に入れる
  }, [supabase, bossFilter, playNotifySound, canAttemptAutoClipboard]);

  // 復帰時の“瞬間コピー”（raidsのロジックを簡略化）
  useEffect(() => {
    let disposed = false;

    const pickLatest = (list: FastRow[]) => (list && list.length > 0 ? list[0] : null);

    const copyLatestOnActive = async () => {
      if (disposed) return;
      if (!autoCopyEnabledRef.current) return;
      if (document.visibilityState !== "visible") return;
      if (!document.hasFocus()) return;

      const list = rows;
      const filtered = bossFilter ? list.filter((r) => (r.monster ?? "").trim() === bossFilter) : list;
      const latest = pickLatest(filtered);
      if (!latest) return;

      const okToTry = await canAttemptAutoClipboard();
      if (!okToTry) {
        pendingCopyIdRef.current = latest.raid_id;
        return;
      }

      const ok = await writeClipboard(latest.raid_id);
      if (!ok) pendingCopyIdRef.current = latest.raid_id;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void copyLatestOnActive();
    };
    const onFocus = () => {
      markUserGesture();
      void copyLatestOnActive();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    void copyLatestOnActive();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [rows, bossFilter, canAttemptAutoClipboard, markUserGesture]);

  const filteredRows = useMemo(() => {
    const list = rows;
    return bossFilter ? list.filter((r) => (r.monster ?? "").trim() === bossFilter) : list;
  }, [rows, bossFilter]);

  const uniqueBosses = useMemo(() => {
    return Array.from(
      new Set(
        rows
          .map((r) => (r.monster ?? "").trim())
          .filter((v) => v && v !== "不明なマルチ")
      )
    ).sort();
  }, [rows]);


  return (
    <div className="min-h-screen bg-slate-900 text-slate-50">
      <div className="max-w-5xl mx-auto p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">GBF Raid ID Relay</div>
            <div className="text-sm text-slate-300">DUO Fast</div>
          </div>

          <button
            className="text-xs px-3 py-2 rounded bg-slate-800 hover:bg-slate-700"
            onClick={() => {
              markUserGesture();
              void fetchRows();
            }}
          >
            更新
          </button>
        </div>

        {/* 上部操作（raids寄せ：通知音 + 自動コピー） */}
        <div className="flex flex-wrap items-center gap-3 bg-slate-800/40 border border-slate-700 rounded-lg p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoCopyEnabled}
              onChange={(e) => {
                markUserGesture();
                setAutoCopyEnabled(e.target.checked);
              }}
            />
            自動コピー
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notifyEnabled}
              onChange={(e) => {
                markUserGesture();
                setNotifyEnabled(e.target.checked);
              }}
            />
            通知音
          </label>

          <label className="flex items-center gap-2 text-sm">
            音量
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={notifyVolume}
              onChange={(e) => setNotifyVolume(Number(e.target.value))}
            />
          </label>

          {/* 特定マルチ非表示/絞り込み（raidsのbossFilter流用） */}
          <div className="flex items-center gap-2 text-sm">
            マルチ
            <select
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
              value={bossFilter}
              onChange={(e) => setBossFilter(e.target.value)}
            >
              <option value="">すべて</option>
              {uniqueBosses.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 一覧（raids寄せ：画像 + 名前 + ID + 手動コピー） */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-4 text-sm text-slate-300">読み込み中...</div>
          ) : filteredRows.length === 0 ? (
            <div className="p-4 text-sm text-slate-300">表示できるIDがありません（自分の投稿は非表示）</div>
          ) : (
            filteredRows.map((r) => {
              const img = getImageUrl(r);
              return (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  className="flex items-center gap-4 px-4 py-3 border-t border-slate-800 hover:bg-slate-800/60 cursor-pointer select-none"
                  onClick={() => {
                    markUserGesture();
                    void writeClipboard(r.raid_id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === \"Enter\" || e.key === \" \") {
                      e.preventDefault();
                      markUserGesture();
                      void writeClipboard(r.raid_id);
                    }
                  }}
                >
                  <div className="w-12 h-12 rounded-md bg-slate-800 overflow-hidden flex items-center justify-center shrink-0">
                    {img ? (
                      // next/imageに寄せたいなら差し替えてOK
                      <img src={img} alt="" className="w-12 h-12 object-cover" />
                    ) : (
                      <div className="text-xs text-slate-500">NoImg</div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{(r.monster ?? "").trim() || "不明なマルチ"}</div>
                    <div className="text-xs text-slate-400">
  {formatTimeAgo(new Date(r.created_at))}
</div>
                  </div>

                  <div className="font-mono text-lg tracking-wide">{r.raid_id}</div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}