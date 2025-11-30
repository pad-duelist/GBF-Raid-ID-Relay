"use client";

import { useEffect, useState, useRef } from "react";
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

// URL 判定（battle_name / boss_name のどちらかが URL の場合もケア）
const looksLikeUrl = (s: string | null | undefined): boolean =>
  !!s && /^https?:\/\//.test(s);

export default function GroupPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const [raids, setRaids] = useState<RaidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bossFilter, setBossFilter] = useState<string>("");
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  // 🔔 新着ID用: 最後に通知したレコードID
  const [lastNotifiedId, setLastNotifiedId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ★ スプレッドシートの対応表（boss_name → 画像URL）
  const battleMap = useBattleNameMap();

  const fetchRaids = async () => {
    if (!groupId) {
      setRaids([]);
      setLoading(false);
      return;
    }

    try {
      const query = new URLSearchParams({
        groupId: String(groupId),
        limit: "50",
      });

      const res = await fetch(`/api/raids?${query.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        console.error("failed to fetch raids", res.status);
        setRaids([]);
        return;
      }

      const data: RaidRow[] = await res.json();
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
    // ✅ 1秒ごとの自動更新
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

  // 🔔 効果音の読み込み（初回のみ）
  useEffect(() => {
    audioRef.current = new Audio("/notify.mp3");
  }, []);

  // 🔔 新しいIDが流れたときに音を鳴らす
  useEffect(() => {
    if (!raids || raids.length === 0) return;

    const latestRaidId = raids[0].id; // 一番新しいレコード

    // 初回ロード時は基準だけセットして音は鳴らさない
    if (lastNotifiedId === null) {
      setLastNotifiedId(latestRaidId);
      return;
    }

    // 前回と違うレコードIDなら「新しいIDが流れた」とみなす
    if (latestRaidId !== lastNotifiedId) {
      audioRef.current
        ?.play()
        .catch(() => {
          // 自動再生制限に引っかかった場合は握りつぶす
        });
      setLastNotifiedId(latestRaidId);
    }
  }, [raids, lastNotifiedId]);

  // 表示用ボス名（URL は除外して、純粋な名前を優先）
  const getDisplayName = (raid: RaidRow): string => {
    const boss = raid.boss_name?.trim() || "";
    const battle = raid.battle_name?.trim() || "";

    if (boss && !looksLikeUrl(boss)) return boss;
    if (battle && !looksLikeUrl(battle)) return battle;
    return "不明なマルチ";
  };

  // 画像URLの決定
  const getImageUrl = (raid: RaidRow): string | undefined => {
    // 1. battle_name が URL ならそれを優先（今のDB仕様に対応）
    if (looksLikeUrl(raid.battle_name)) {
      return raid.battle_name as string;
    }
    // 2. boss_name が URL の場合
    if (looksLikeUrl(raid.boss_name)) {
      return raid.boss_name as string;
    }
    // 3. どちらも URL でなければ、表示名からスプレッドシートのマップを引く
    const name = getDisplayName(raid);
    return battleMap[name];
  };

  // ★ 絞り込み候補：表示名でユニーク化
  const uniqueBosses = Array.from(
    new Set(
      raids
        .map((r) => getDisplayName(r))
        .filter((v) => v && v !== "不明なマルチ")
    )
  );

  // ★ 表示用だけフィルタする
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

            {/* 🔔 自動再生制限対策用のサウンドテストボタン */}
            <button
              type="button"
              onClick={() =>
                audioRef.current?.play().catch(() => {
                  /* 無視 */
                })
              }
              className="ml-2 bg-slate-700 hover:bg-slate-600 text-xs px-2 py-1 rounded"
            >
              音テスト
            </button>
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
                  {/* 左側：画像＋ID＋ボス名 */}
                  <div className="flex items-center gap-3">
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt={labelName}
                        className="w-12 h-12 rounded"
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

                  {/* 右側：投稿者＋HP */}
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
