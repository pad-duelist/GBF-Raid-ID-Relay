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

// groups テーブルの「あり得る列名」で UUID を引けるだけ引く（列が無くても落とさない）
async function resolveGroupUuidCandidates(groupIdParam: string) {
  const candidates = new Set<string>();

  // すでにUUIDならそれを使う
  if (isUuidLike(groupIdParam)) {
    candidates.add(groupIdParam);
    return Array.from(candidates);
  }

  // UUIDではない場合は groups テーブルから解決を試みる
  // ※列が無いとSupabaseがエラーを返すので、その場合は握りつぶして次を試す
  const tryColumn = async (col: string) => {
    try {
      const { data, error } = await supabase
        .from("groups")
        .select("id")
        .eq(col as any, groupIdParam)
        .limit(10);

      if (!error && data?.length) {
        for (const row of data) {
          if (row?.id && isUuidLike(String(row.id))) candidates.add(String(row.id));
        }
      }
    } catch {
      // groups テーブルが無い等も含めて無視
    }
  };

  // よくある列名を順に試す（あなたのスキーマに合わせて増やしてOK）
  await tryColumn("slug");
  await tryColumn("name");
  await tryColumn("group_name");

  return Array.from(candidates);
}

export async function GET(req: NextRequest) {
  const groupIdParam = req.nextUrl.searchParams.get("groupId") ?? "";
  const userId = req.nextUrl.searchParams.get("userId") ?? "";
  const debug = req.nextUrl.searchParams.get("debug") === "1";

  if (!groupIdParam || !userId) {
    return NextResponse.json(
      { allowed: false, reason: "missing_params" },
      { status: 400 }
    );
  }

  // ここで UUID 候補に解決（UUID以外は group_memberships に投げない！）
  const groupIds = await resolveGroupUuidCandidates(groupIdParam);

  if (groupIds.length === 0) {
    return NextResponse.json(
      {
        allowed: false,
        reason: "group_not_found",
        ...(debug ? { debug: { groupIdParam, userId, resolvedGroupIds: groupIds } } : {}),
      },
      { status: 404 }
    );
  }

  // どれか1つでも所属していれば OK
  for (const gid of groupIds) {
    // gid は UUID のみ
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
          ...(debug ? { debug: { groupIdParam, userId, resolvedGroupIds: groupIds, error } } : {}),
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
          ...(debug ? { debug: { groupIdParam, userId, resolvedGroupIds: groupIds, matchedGroupId: gid, status } } : {}),
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        allowed: true,
        ...(debug ? { debug: { groupIdParam, userId, resolvedGroupIds: groupIds, matchedGroupId: gid, status: status ?? null } } : {}),
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      allowed: false,
      reason: "not_member",
      ...(debug ? { debug: { groupIdParam, userId, resolvedGroupIds: groupIds } } : {}),
    },
    { status: 403 }
  );
}
