"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import GroupPageClient from "@/app/g/[groupId]/GroupPageClient";

export default function OwnerRaidsPage() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [groupIds, setGroupIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setError(
        "Supabase の初期化に失敗しました。NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を確認してください。"
      );
      return;
    }

    (async () => {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user) {
        setError("ログインが必要です。");
        return;
      }

      const { data, error: qErr } = await supabase
        .from("group_memberships")
        .select("group_id")
        .eq("user_id", user.id)
        .eq("status", "owner");

      if (qErr) {
        setError(qErr.message);
        return;
      }

      const ids = (data ?? [])
        .map((r: any) => r.group_id)
        .filter((x: any) => typeof x === "string" && x.length > 0);

      if (ids.length === 0) {
        setError("owner のグループがありません。");
        return;
      }

      setGroupIds(ids);
    })().catch((e) => {
      console.error(e);
      setError("owner グループの取得に失敗しました。");
    });
  }, [supabase]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-50 p-4">
        <div className="max-w-3xl mx-auto space-y-2">
          <div className="text-lg font-bold">GBF Raid ID Relay</div>
          <div className="text-sm text-red-300">{error}</div>
        </div>
      </div>
    );
  }

  if (!groupIds) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-50 p-4">
        <div className="max-w-3xl mx-auto">読み込み中...</div>
      </div>
    );
  }

  return (
    <GroupPageClient
      groupIds={groupIds}
      pageTitle="Ownerまとめ（全グループ）"
      storageKey="owner_all"
      skipAccessCheck
    />
  );
}