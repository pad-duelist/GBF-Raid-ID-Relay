import { createClient } from "@/utils/supabase/server"; // 既存に合わせて
import Link from "next/link";

export default async function OwnerRaidsPage() {
  const supabase = await createClient();

  // ownerチェック（直打ち対策：ownerじゃないなら弾く）
  const { data: ownerRow } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("status", "owner")
    .limit(1);

  if (!ownerRow || ownerRow.length === 0) {
    return (
      <div className="p-4">
        <div className="text-sm opacity-70">ownerのみ閲覧できます</div>
        <div className="mt-2">
          <Link className="underline" href="/">
            戻る
          </Link>
        </div>
      </div>
    );
  }

  const { data, error } = await supabase.rpc("get_owner_groups_raids", { p_limit: 300 });

  if (error) {
    return (
      <div className="p-4">
        <div className="font-semibold">Error</div>
        <pre className="mt-2 text-xs whitespace-pre-wrap">{JSON.stringify(error, null, 2)}</pre>
      </div>
    );
  }

  const raids = data ?? [];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-end justify-between">
        <h1 className="text-lg font-semibold">Ownerまとめ（全グループ）</h1>
        <div className="text-xs opacity-70">{raids.length} 件</div>
      </div>

      <div className="space-y-2">
        {raids.map((r: any) => (
          <div key={r.id} className="rounded border p-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <div className="font-mono text-lg">{r.raid_id}</div>
              <div className="text-sm opacity-80">{r.group_name}</div>
              <div className="text-sm">{r.boss_name || r.canonical_boss_name || r.battle_name}</div>
              {typeof r.hp_percent === "number" && (
                <div className="text-xs opacity-70">HP {Math.round(r.hp_percent)}%</div>
              )}
            </div>

            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70">
              <div>{r.user_name}</div>
              <div>{new Date(r.created_at).toLocaleString("ja-JP")}</div>
              {typeof r.member_current === "number" && typeof r.member_max === "number" && (
                <div>
                  {r.member_current}/{r.member_max}
                </div>
              )}
            </div>
          </div>
        ))}

        {raids.length === 0 && (
          <div className="rounded border p-6 text-sm opacity-70">データがありません</div>
        )}
      </div>
    </div>
  );
}