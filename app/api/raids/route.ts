// app/api/raids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ===== ボス名ブロックリスト =====
const BOSS_BLOCKLIST_CSV_URL =
  process.env.BOSS_BLOCKLIST_CSV_URL ??
  process.env.NEXT_PUBLIC_BOSS_BLOCKLIST_CSV_URL;

let bossBlockList: Set<string> | null = null;
let lastBossBlockListFetched = 0;
const BOSS_BLOCKLIST_TTL = 5 * 60 * 1000; // 5分

function normalizeBossName(name: string): string {
  return name.trim();
}

async function loadBossBlockList(): Promise<Set<string>> {
  const now = Date.now();

  if (bossBlockList && now - lastBossBlockListFetched < BOSS_BLOCKLIST_TTL) {
    return bossBlockList;
  }

  const set = new Set<string>();

  if (!BOSS_BLOCKLIST_CSV_URL) {
    console.warn("[boss blocklist] BOSS_BLOCKLIST_CSV_URL が設定されていません");
    bossBlockList = set;
    lastBossBlockListFetched = now;
    return set;
  }

  try {
    const res = await fetch(BOSS_BLOCKLIST_CSV_URL);
    if (res.ok) {
      const text = await res.text();
      const lines = text.split(/\r?\n/);
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const bossName = line.split(",")[0];
        if (bossName) set.add(normalizeBossName(bossName));
      }
    } else {
      console.error(
        "[boss blocklist] fetch failed:",
        res.status,
        res.statusText
      );
    }
  } catch (e) {
    console.error("[boss blocklist] 取得に失敗しました", e);
  }

  bossBlockList = set;
  lastBossBlockListFetched = now;
  return set;
}

async function isBlockedBoss(
  bossName: string | null | undefined
): Promise<boolean> {
  if (!bossName) return false;
  const list = await loadBossBlockList();
  const normalized = normalizeBossName(bossName);
  return list.has(normalized);
}

// ===== グループ承認 / ユーザー識別系 =====

function getUserIdFromRequest(req: NextRequest): string | null {
  const headerUserId =
    req.headers.get("x-user-id") ?? req.headers.get("X-User-Id");
  if (headerUserId && headerUserId.trim().length > 0) {
    return headerUserId.trim();
  }
  return null;
}

async function getUserIdFromExtensionToken(
  extensionToken: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("extension_token", extensionToken)
    .maybeSingle();

  if (error && (error as any).code !== "PGRST116") {
    console.error("[profiles] select error", error);
  }

  return data?.user_id ?? null;
}

async function isUserMemberOfGroup(
  groupId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("group_memberships")
    .select("id, status")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .in("status", ["member", "owner"])
    .maybeSingle();

  if (error && (error as any).code !== "PGRST116") {
    console.error("[group_memberships] select error", error);
  }

  return !!data;
}

// -------- GET /api/raids --------
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const groupIdSingle = searchParams.get("groupId"); // 旧仕様
  const groupIdsParam = searchParams.get("groupIds"); // 新仕様（カンマ区切り）
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
    .in("group_id", allowedGroupIds) // 複数グループ
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

// -------- POST /api/raids --------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      groupId,
      raidId,
      bossName,
      battleName,
      hpValue,
      hpPercent,
      userName,
      memberCurrent,
      memberMax,
      extensionToken,
      extension_token,
    } = body ?? {};

    const tokenFromHeader =
      req.headers.get("x-extension-token") ??
      req.headers.get("X-Extension-Token");
    const effectiveExtensionToken =
      tokenFromHeader ?? extensionToken ?? extension_token ?? null;

    if (await isBlockedBoss(bossName)) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: "blocked_boss", bossName },
        { status: 200 }
      );
    }

    if (!groupId || !raidId) {
      return NextResponse.json(
        { error: "groupId and raidId are required" },
        { status: 400 }
      );
    }

    if (!effectiveExtensionToken) {
      return NextResponse.json(
        { error: "extension token is required" },
        { status: 401 }
      );
    }

    const senderUserId = await getUserIdFromExtensionToken(
      effectiveExtensionToken
    );

    if (!senderUserId) {
      return NextResponse.json(
        { error: "invalid extension token" },
        { status: 401 }
      );
    }

    const isMember = await isUserMemberOfGroup(groupId, senderUserId);
    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: existing, error: selectError } = await supabase
      .from("raids")
      .select("id")
      .eq("group_id", groupId)
      .eq("raid_id", raidId)
      .limit(1)
      .maybeSingle();

    if (selectError && (selectError as any).code !== "PGRST116") {
      console.error("select error", selectError);
    }

    if (existing) {
      return NextResponse.json(
        { ok: true, duplicated: true },
        { status: 200 }
      );
    }

    const { error: insertError } = await supabase.from("raids").insert({
      group_id: groupId,
      raid_id: raidId,
      boss_name: bossName ?? null,
      battle_name: battleName ?? null,
      hp_value:
        hpValue !== undefined && hpValue !== null ? Number(hpValue) : null,
      hp_percent:
        hpPercent !== undefined && hpPercent !== null
          ? Number(hpPercent)
          : null,
      user_name: userName ?? null,
      member_current:
        memberCurrent !== undefined && memberCurrent !== null
          ? Number(memberCurrent)
          : null,
      member_max:
        memberMax !== undefined && memberMax !== null
          ? Number(memberMax)
          : null,
      sender_user_id: senderUserId,
    });

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("POST /api/raids error", e);
    return NextResponse.json(
      { error: "Unexpected error" },
      { status: 500 }
    );
  }
}
