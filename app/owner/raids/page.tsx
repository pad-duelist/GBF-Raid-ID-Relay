"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

type RaidRow = {
  id: string;
  group_id: string;
  group_name: string | null;
  raid_id: string;
  boss_name: string | null;
  canonical_boss_name: string | null;
  battle_name: string | null;
  hp_percent: number | null;
  hp_value: number | null;
  user_name: string | null;
  created_at: string;
  sender_user_id: string | null;
  member_current: number | null;
  member_max: number | null;
};

export default function OwnerRaidsPage() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [raids, setRaids] = useState<RaidRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);

      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user) {
        setLoading(false);
        setError("ログインが必要です。");
        return;
      }

      // owner 判定（自分の membership だけ確認）
      const { data: ownerRow, error: ownerErr } = await supabase
        .from("group_memberships")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "owner")
        .limit(1);

      const owner = !ownerErr && (ownerRow?.length ?? 0) > 0;
      setIsOwner(owner);

      if (!owner) {
        setLoading(false);
        setError("owner のみ閲覧できます。");
        return;
      }

      // RPC（owner の全グループ分）
      const { data, error: rpcErr } = await supabase.rpc("get_owner_groups_raids", {
        p_limit: 300,
      });

      if (rpcErr) {
        setLoading(false);
        setError(rpcErr.message ?? "取得に失敗しました。");
        return;
      }

      setRaids((data ?? []) as RaidRow[]);
      setLoading(false);
    };

    void run();
  }, [supabase]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-end justify-between">
        <h1 className="text-lg font-semibold">Ownerまとめ（全グループ）</h1>
        <div className="text-xs opacity-70">{loading ? "…" : `${raids.length} 件`}</div>
      </div>

      {loading && (
        <div className="rounded border p-6 text-sm opacity-70">読み込み中…</div>
      )}

      {!loading && error && (
        <div className="rounded border p-6 space-y-2">
          <div className="text-sm text-red-300">{error}</div>
          <div className="text-sm">
            <Link className="underline" href="/extension-token">
              戻る
            </Link>
          </div>
        </div>
      )}

      {!loading && !error && raids.length === 0 && (
        <div className="rounded border p-6 text-sm opacity-70">データがありません</div>
      )}

      {!loading && !error && raids.length > 0 && (
        <div className="space-y-2">
          {raids.map((r) => (
            <div key={r.id} className="rounded border p-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <div className="font-mono text-lg">{r.raid_id}</div>
                <div className="text-sm opacity-80">{r.group_name ?? r.group_id}</div>
                <div className="text-sm">
                  {r.boss_name || r.canonical_boss_name || r.battle_name || ""}
                </div>
                {typeof r.hp_percent === "number" && (
                  <div className="text-xs opacity-70">HP {Math.round(r.hp_percent)}%</div>
                )}
              </div>

              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70">
                <div>{r.user_name ?? ""}</div>
                <div>{new Date(r.created_at).toLocaleString("ja-JP")}</div>
                {typeof r.member_current === "number" &&
                  typeof r.member_max === "number" && (
                    <div>
                      {r.member_current}/{r.member_max}
                    </div>
                  )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}