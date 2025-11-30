// -------- GET /api/raids --------
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const groupIdSingle = searchParams.get("groupId");          // 旧仕様
  const groupIdsParam = searchParams.get("groupIds");         // 新仕様（カンマ区切り）
  const bossName = searchParams.get("bossName");
  const limitParam = searchParams.get("limit") ?? "50";
  const limit = Number(limitParam);

  // 要求されたグループ一覧を決定
  let requestedGroupIds: string[] = [];

  if (groupIdsParam) {
    requestedGroupIds = groupIdsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (groupIdSingle) {
    requestedGroupIds = [groupIdSingle];
  }

  if (requestedGroupIds.length === 0) {
    return NextResponse.json(
      { error: "groupId or groupIds is required" },
      { status: 400 }
    );
  }

  // ログインユーザー
  const viewerUserId =
    getUserIdFromRequest(req) ?? searchParams.get("userId") ?? undefined;

  if (!viewerUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ユーザーが所属している requestedGroupIds を取得
  const { data: memberships, error: mError } = await supabase
    .from("group_memberships")
    .select("group_id, status")
    .eq("user_id", viewerUserId)
    .in("group_id", requestedGroupIds);

  if (mError && (mError as any).code !== "PGRST116") {
    console.error("[group_memberships] select error", mError);
  }

  const allowedGroupIds = (memberships ?? [])
    .filter((m) => m.status === "member" || m.status === "owner")
    .map((m) => m.group_id as string);

  if (allowedGroupIds.length === 0) {
    // 要求されたグループのどれにも所属していない
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let query = supabase
    .from("raids")
    .select(
      [
        "id",
        "group_id",
        "raid_id",
        "boss_name",
        "battle_name",
        "hp_value",
        "hp_percent",
        "user_name",
        "created_at",
        "member_current",
        "member_max",
      ].join(",")
    )
    .in("group_id", allowedGroupIds)    // 複数グループ
    .neq("sender_user_id", viewerUserId)
    .order("created_at", { ascending: false })
    .limit(isNaN(limit) ? 50 : limit);

  if (bossName) {
    query = query.eq("boss_name", bossName);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
