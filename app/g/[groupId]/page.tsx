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
  // Next.js のバージョン差異を吸収（cookies() が同期/非同期どちらでも動くようにする）
  const cookieStore: any = await (cookies() as any);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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
          // Server Component からの set が失敗しても無視してOK
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

  // status 運用がある場合の例（不要なら消してOK）
  const status = (membership as any)?.status as string | null | undefined;
  if (status && ["removed", "banned", "disabled", "inactive"].includes(status)) {
    redirect("/extension-token");
  }

  return <GroupPageClient groupId={groupId} />;
}
