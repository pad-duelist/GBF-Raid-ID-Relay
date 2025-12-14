// app/g/[groupId]/page.tsx
export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/auth-helpers-nextjs";

import GroupPageClient from "./GroupPageClient";

export default async function GroupPage({
  params,
}: {
  params: { groupId: string };
}) {
  // Next.js のバージョンによって cookies() が Promise の場合があるため、両対応
  const cookieStore: any = await (cookies() as any);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: any[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Component からの set は失敗し得るので無視（公式の移行例でも同様の扱い）
        }
      },
    },
  });

  // ログイン必須
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/extension-token");
  }

  const groupId = params.groupId;

  // グループ所属チェック
  const { data: membership } = await supabase
    .from("group_memberships")
    .select("id,status")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    redirect("/extension-token");
  }

  const status = (membership as any)?.status as string | null | undefined;
  if (status && ["removed", "banned", "disabled", "inactive"].includes(status)) {
    redirect("/extension-token");
  }

  return <GroupPageClient groupId={groupId} />;
}
