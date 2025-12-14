// app/api/group-access/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ここは無理に型を付けない（ビルド安定優先）
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

async function resolveGroupUuidCandidates(groupIdParam: string): Promise<string[]> {
  const candidates = new Set<string>();

  // すでにUUIDならそれを使う
  if (isUuidLike(groupIdParam)) {
    candidates.add(groupIdParam);
    return Array.from(candidates);
  }

  // UUIDでない場合は groups テーブルから解決を試す（列が無い/テーブルが無い場合は握りつぶす）
  // ※ 動的カラム指定を避けて、固定カラムで3回投げる（TSの深い型エラー回避）
  try {
    const r = await (supabase as any)
      .from("groups")
      .select("id")
      .eq("slug", groupIdParam)
      .limit(10);

    if (!r.error && r.data?.length) {
      for (const row of r.data) {
        const id = String(row?.id ?? "");
        if (id && isUuidLike(id)) candidates.add(id);
      }
    }
  } catch {
    // ignore
  }

  try {
    const r = await (supabase as any)
      .from("groups")
      .select("id")
      .eq("name", groupIdParam)
      .limit(10);

    if (!r.error && r.data?.length) {
      for (const row of r.data) {
        const id = String(row?.id ?? "");
        if (id && isUuidLike(id)) candidates.add(id);
      }
    }
  } catch {
    // ignore
  }

  try {
    const r = await (supabase as any)
      .from("groups")
      .select("id")
      .eq("group_name", groupIdParam)
      .limit(10);

    if (!r.error && r.data?.length) {
      for (const row of r.data) {
        const id = String(row?.id ?? "");
        if (id && isUuidLike(id)) candidates.add(id);
      }
    }
  } catch {
    // ignore
  }

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

  const resolvedGroupIds = await resolveGroupUuidCandidates(groupIdParam);

  if (resolvedGroupIds.length === 0) {
    return NextResponse.json(
      {
        allowed: false,
        reason: "group_not_found",
        ...(debug ? { debug: { groupIdParam, userId, resolvedGroupIds } } : {}),
      },
      { status: 404 }
    );
  }

  for (const gid of resolvedGroupIds) {
    // gid は UUID のみ
    const { data, error } = await (supabase as any)
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
          ...(debug ? { debug: { groupIdParam, userId, resolvedGroupIds, error } } : {}),
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
          ...(debug
            ? { debug: { groupIdParam, userId, resolvedGroupIds, matchedGroupId: gid, status } }
            : {}),
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        allowed: true,
        ...(debug
          ? { debug: { groupIdParam, userId, resolvedGroupIds, matchedGroupId: gid, status: status ?? null } }
          : {}),
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      allowed: false,
      reason: "not_member",
      ...(debug ? { debug: { groupIdParam, userId, resolvedGroupIds } } : {}),
    },
    { status: 403 }
  );
}
