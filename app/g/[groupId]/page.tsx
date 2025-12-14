// app/g/[groupId]/page.tsx
export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";

import GroupPageClient from "./GroupPageClient";

export default async function GroupPage({
  params,
}: {
  params: { groupId: string };
}) {
  const supabase = createServerComponentClient({ cookies });

  // ログイン必須
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/extension-token");
  }

  const groupId = params.groupId;

  // グループ所属チェック（status の運用がある場合はここで絞り込み）
  const { data: membership } = await supabase
    .from("group_memberships")
    .select("id,status")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  // 「グループに割り振られていない」なら弾く
  if (!membership) {
    redirect("/extension-token");
  }

  // もし status で無効扱いがあるならここで弾く（必要なら調整してください）
  const status = (membership as any)?.status as string | null | undefined;
  if (status && ["removed", "banned", "disabled", "inactive"].includes(status)) {
    redirect("/extension-token");
  }

  return <GroupPageClient groupId={groupId} />;
}
