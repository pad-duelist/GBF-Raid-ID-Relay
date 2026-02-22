"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { formatTimeAgo } from "@/lib/timeAgo";
import { formatNumberWithComma } from "@/lib/numberFormat";
import { useBattleNameMap } from "@/lib/useBattleNameMap";

type RaidRow = {
  id: string;
  group_id: string;
  group_name: string | null;
  raid_id: string;
  boss_name: string | null;
  battle_name: string | null;
  canonical_boss_name: string | null;
  hp_value: number | null;
  hp_percent: number | null;
  member_current: number | null;
  member_max: number | null;
  user_name: string | null;
  created_at: string;
  sender_user_id: string | null;
};

const looksLikeUrl = (s: string | null | undefined): boolean => !!s && /^https?:\/\//.test(s);

export default function OwnerRaidsPage() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const battleMap = useBattleNameMap();

  const [loading, setLoading] = useState(true);
  const [raids, setRaids] = useState<RaidRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // --- グループページに寄せた helper ---
  const getDisplayName = useCallback((raid: RaidRow): string => {
    const boss = raid.boss_name?.trim() || "";
    const battle = raid.battle_name?.trim() || "";
    const canonical = raid.canonical_boss_name?.trim() || "";

    // まずは表示名として素直に採用（URLは弾く）
    if (boss && !looksLikeUrl(boss)) return boss;
    if (canonical && !looksLikeUrl(canonical)) return canonical;
    if (battle && !looksLikeUrl(battle)) return battle;
    return "不明なマルチ";
  }, []);

  const getImageUrl = useCallback(
    (raid: RaidRow): string | undefined => {
      // battle_name / boss_name に画像URLが入ってる互換ケースに対応
      if (looksLikeUrl(raid.battle_name)) return raid.battle_name as string;
      if (looksLikeUrl(raid.boss_name)) return raid.boss_name as string;

      const name = getDisplayName(raid);
      return (battleMap as any)?.[name];
    },
    [battleMap, getDisplayName]
  );

  const normalizePercent = (raw: number | null | undefined): number | null => {
    if (raw == null) return null;
    if (raw <= 1) return raw * 100;
    return raw;
  };

  const hpPercentStyle = (raw: number | null | undefined): React.CSSProperties => {
    const p = normalizePercent(raw);
    if (p == null) return { color: "#94a3b8" };
    if (p >= 99) return { color: "#50d552", fontWeight: 600 };
    if (p >= 90) return { color: "#b9d5b2", fontWeight: 500 };
    if (p <= 25) return { color: "#ff6347", fontWeight: 600 };
    if (p <= 50) return { color: "#e8d979", fontWeight: 500 };
    return { color: "#cbd5e1" };
  };

  const memberCountStyle = (count: number | null | undefined): React.CSSProperties => {
    if (count == null) return { color: "#94a3b8" };
    if (count <= 2) return { color: "#50d552", fontWeight: 600 };
    return { color: "#94a3b8" };
  };

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

  const playClickSound = useCallback(() => {
    // グループページほどの設定は持たせず、最低限だけ（必要なら後で通知設定も移植できる）
    if (!audioRef.current) audioRef.current = new Audio("/notify.mp3");
    const audio = audioRef.current;
    audio.volume = 0.7;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, []);

  const copyId = useCallback(
    async (raidId: string) => {
      const ok = await writeClipboard(raidId);
      if (ok) {
        playClickSound();
        setCopyMessage(`ID ${raidId} をコピーしました`);
        setTimeout(() => setCopyMessage(null), 1500);
      }
    },
    [playClickSound]
  );

  const fetchOwnerRaids = useCallback(async () => {
    if (!supabase) {
      setError(
        "Supabase の初期化に失敗しました。環境変数(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)を確認してください。"
      );
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      setError("ログインが必要です。");
      setLoading(false);
      return;
    }

    // owner 判定
    const { data: ownerRow, error: ownerErr } = await supabase
      .from("group_memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "owner")
      .limit(1);

    const owner = !ownerErr && (ownerRow?.length ?? 0) > 0;
    if (!owner) {
      setError("owner のみ閲覧できます。");
      setLoading(false);
      return;
    }

    const { data, error: rpcErr } = await supabase.rpc("get_owner_groups_raids", { p_limit: 300 });
    if (rpcErr) {
      setError(rpcErr.message ?? "取得に失敗しました。");
      setLoading(false);
      return;
    }

    setRaids((data ?? []) as RaidRow[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void fetchOwnerRaids();
  }, [fetchOwnerRaids]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-4">
      <div className="max-w-3xl mx-auto space-y-3">
        <header className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-lg font-bold">GBF Raid ID Relay</div>
            <div className="text-sm text-slate-300">Ownerまとめ（全グループ）</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchOwnerRaids()}
              className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-2 rounded"
            >
              更新
            </button>
            <Link
              href="/extension-token"
              className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-2 rounded"
            >
              戻る
            </Link>
          </div>
        </header>

        {copyMessage && <div className="text-sm text-emerald-300">{copyMessage}</div>}

        {loading ? (
          <div>読み込み中...</div>
        ) : error ? (
          <div className="text-sm text-red-300">{error}</div>
        ) : raids.length === 0 ? (
          <div className="text-slate-400 text-sm">まだIDが流れていません。</div>
        ) : (
          <div className="space-y-2">
            {raids.map((raid) => {
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

              return (
                <div
                  key={raid.id}
                  onPointerDown={(e) => {
                    // テキスト選択（ドラッグ選択）による反転を防ぐ
                    e.preventDefault();
                  }}
                  onClick={() => void copyId(raid.raid_id)}
                  className="flex items-center justify-between bg-slate-800/80 rounded-lg px-3 py-2 text-sm shadow cursor-pointer hover:bg-slate-700/80 transition-colors select-none"
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-base underline decoration-dotted">
                          {raid.raid_id}
                        </span>
                        <span className="text-xs text-slate-400">{timeAgo}</span>

                        {/* ★Ownerまとめならでは：グループ名を追加表示（控えめに） */}
                        {raid.group_name && (
                          <span className="text-xs text-slate-300 bg-slate-700/60 px-2 py-0.5 rounded">
                            {raid.group_name}
                          </span>
                        )}
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
                        <span style={hpPercentStyle(percentRaw)} className="mr-2 font-mono">
                          {formatNumberWithComma(hpValueNumber)} HP
                        </span>
                      ) : (
                        <span className="text-slate-400 mr-2">HP 不明</span>
                      )}
                      {percentDisplay ? (
                        <span style={hpPercentStyle(percentRaw)} className="text-xs font-mono">
                          {percentDisplay}
                        </span>
                      ) : null}
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