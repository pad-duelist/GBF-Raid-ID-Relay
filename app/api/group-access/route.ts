// app/api/group-access/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

/**
 * groupId(=URL) が以下どれでも membership を確認できるようにする:
 * - そのまま group_memberships.group_id と一致
 * - groups テーブルがある場合: groups.id / groups.slug / groups.name から解決
 *
 * ※ groups テーブルや slug/name が無い環境でも「エラーで落ちない」ようにしてあります
 */
async function resolveGroupIdCandidates(groupId: string): Promise<string[]> {
  const candidates = new Set<string>();
  candidates.add(groupId);

  // UUIDならそれ以上探さなくてもよいケースが多い（ただし一応 candidates は返す）
  // name/slug で来る可能性が高いので、UUIDでない場合は groups を見に行く
  if (!isUuidLike(groupId)) {
    // groups テーブルが存在する場合だけ解決する（無い場合はエラーになるので握りつぶす）
    try {
      // まず slug で探す
      let r1 = await supabase
        .from("groups")
        .select("id")
        .eq("slug", groupId)
        .limit(5);

      if (!r1.error && r1.data?.length) {
        for (const row of r1.data) candidates.add(row.id);
      }

      // 次に name で探す
      let r2 = await supabase
        .from("groups")
        .select("id")
        .eq("name", groupId)
        .limit(5);

      if (!r2.error && r2.data?.length) {
        for (const row of r2.data) candidates.add(row.id);
      }
    } catch {
      // groups テーブルが無い等は無視
    }
  }

  return Array.from(candidates);
}

export async function GET(req: NextRequest) {
  const groupId = req.nextUrl.searchParams.get("groupId") ?? "";
  const userId = req.nextUrl.searchParams.get("userId") ?? "";
  const debug = req.nextUrl.searchParams.get("debug") === "1";

  if (!groupId || !userId) {
    return NextResponse.json(
      { allowed: false, reason: "missing_params" },
      { status: 400 }
    );
  }

  const groupIds = await resolveGroupIdCandidates(groupId);

  // candidates のどれかに所属していればOK
  for (const gid of groupIds) {
    const { data, error } = await supabase
      .from("group_memberships")
      .select("id,status,group_id,user_id")
      .eq("group_id", gid)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          allowed: false,
          reason: "db_error",
          ...(debug ? { debug: { groupId, userId, groupIds, error } } : {}),
        },
        { status: 500 }
      );
    }

    if (!data) continue;

    const status = (data as any)?.status as string | null | undefined;
    if (status && ["removed", "banned", "disabled", "inactive"].includes(status)) {
      return NextResponse.json(
        {
          allowed: false,
          reason: "status_blocked",
          ...(debug ? { debug: { groupId, userId, groupIds, matchedGroupId: gid, status } } : {}),
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        allowed: true,
        ...(debug ? { debug: { groupId, userId, groupIds, matchedGroupId: gid, status: status ?? null } } : {}),
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      allowed: false,
      reason: "not_member",
      ...(debug ? { debug: { groupId, userId, groupIds } } : {}),
    },
    { status: 403 }
  );
}
