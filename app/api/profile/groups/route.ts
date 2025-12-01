// app/api/profile/groups/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// ヘッダーから user_id を取得
function getUserIdFromRequest(req: NextRequest): string | null {
  const headerUserId =
    req.headers.get("x-user-id") ?? req.headers.get("X-User-Id");
  if (headerUserId && headerUserId.trim().length > 0) {
    return headerUserId.trim();
  }
  return null;
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized (user id missing)" },
      { status: 401 }
    );
  }

  // 1. このユーザーが所属しているグループID + status を取得
  const { data: memberships, error: mError } = await supabase
    .from("group_memberships")
    .select("group_id, status")
    .eq("user_id", userId)
    .in("status", ["member", "owner"]);

  if (mError) {
    console.error("[profile/groups] memberships error", mError);
    return NextResponse.json(
      { error: "グループ情報の取得に失敗しました。(membership)" },
      { status: 500 }
    );
  }

  if (!memberships || memberships.length === 0) {
    // 所属グループなし
    return NextResponse.json({ groups: [] }, { status: 200 });
  }

  const groupIds = memberships.map((m) => m.group_id as string);

  // 2. groups テーブルから名前を取得
  const { data: groups, error: gError } = await supabase
    .from("groups")
    .select("id, name")
    .in("id", groupIds);

  if (gError) {
    console.error("[profile/groups] groups error", gError);
    return NextResponse.json(
      { error: "グループ情報の取得に失敗しました。(groups)" },
      { status: 500 }
    );
  }

  // 3. group_id ごとに name + status を合成
  const groupsWithStatus = groupIds.map((gid) => {
    const g = groups?.find((x: any) => x.id === gid);
    const m = memberships.find((x: any) => x.group_id === gid);
    return {
      id: gid,
      name: g?.name ?? gid,
      status: m?.status ?? "member",
    };
  });

  return NextResponse.json({ groups: groupsWithStatus }, { status: 200 });
}
