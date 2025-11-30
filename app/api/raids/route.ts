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

console.log("[env debug] BOSS_BLOCKLIST_CSV_URL =", BOSS_BLOCKLIST_CSV_URL);

let bossBlockList: Set<string> | null = null;
let lastBossBlockListFetched = 0;
const BOSS_BLOCKLIST_TTL = 5 * 60 * 1000; // 5分

function normalizeBossName(name: string): string {
  // とりあえず trim だけ（必要ならここでスペース除去ロジックを追加）
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
    console.log("[boss blocklist] fetching from", BOSS_BLOCKLIST_CSV_URL);
    const res = await fetch(BOSS_BLOCKLIST_CSV_URL);
    if (!res.ok) {
      console.error(
        "[boss blocklist] fetch failed:",
        res.status,
        res.statusText
      );
    } else {
      const text = await res.text();

      const lines = text.split(/\r?\n/);
      // 1行目はヘッダー boss_name
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const bossName = line.split(",")[0];
        if (bossName) {
          set.add(normalizeBossName(bossName));
        }
      }

      console.log("[boss blocklist] loaded names:", Array.from(set.values()));
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
  const blocked = list.has(normalized);
  console.log("[boss blocklist] check", { bossName, normalized, blocked });
  return blocked;
}

// ===== グループ承認 / ユーザー識別系 =====

// ビューア側（サイト）から送られてくるユーザーID
// フロント側で Supabase の user.id を取得して
// fetch のヘッダーに X-User-Id として付けてもらう想定です。
function getUserIdFromRequest(req: NextRequest): string | null {
  const headerUserId =
    req.headers.get("x-user-id") ?? req.headers.get("X-User-Id");
  if (headerUserId && headerUserId.trim().length > 0) {
    return headerUserId.trim();
  }
  return null;
}

// 拡張機能用トークンから Supabase の user_id を取得
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

// 指定ユーザーが指定グループの承認済みメンバーかどうか
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
  const groupId = searchParams.get("groupId");
  const bossName = searchParams.get("bossName");
  const limitParam = searchParams.get("limit") ?? "50";

  const limit = Number(limitParam);

  if (!groupId) {
    return NextResponse.json(
      { error: "groupId is required" },
      { status: 400 }
    );
  }

  // ログインユーザー（Discord / Supabase）のID
  const viewerUserId =
    getUserIdFromRequest(req) ?? searchParams.get("userId") ?? undefined;

  if (!viewerUserId) {
    console.warn("[GET /api/raids] userId missing");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 承認済みメンバーかチェック
  const isMember = await isUserMemberOfGroup(groupId, viewerUserId);
  if (!isMember) {
    console.warn("[GET /api/raids] forbidden (not member)", {
      groupId,
      viewerUserId,
    });
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
    .eq("group_id", groupId)
    // 自分が送信したIDは除外
    .neq("sender_user_id", viewerUserId)
    .order("created_at", { ascending: false })
    .limit(isNaN(limit) ? 50 : limit);

  if (bossName) {
    query = query.eq("boss_name", bossName);
  }

  const { data, error } = await query;

  if (error) {
    console.error("GET /api/raids error", error);
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

    // ヘッダー優先で拡張機能トークンを取得
    const tokenFromHeader =
      req.headers.get("x-extension-token") ??
      req.headers.get("X-Extension-Token");
    const effectiveExtensionToken =
      tokenFromHeader ?? extensionToken ?? extension_token ?? null;

    // ★ボスブロック（デバッグ付き）
    if (await isBlockedBoss(bossName)) {
      console.log("[boss blocklist] ブロック対象ボスをスキップ:", bossName);
      return NextResponse.json(
        { ok: true, skipped: true, reason: "blocked_boss", bossName },
        { status: 200 }
      );
    }

    if (!groupId || !raidId) {
      console.warn("[POST /api/raids] groupId or raidId missing", {
        groupId,
        raidId,
      });
      return NextResponse.json(
        { error: "groupId and raidId are required" },
        { status: 400 }
      );
    }

    if (!effectiveExtensionToken) {
      console.warn("[POST /api/raids] extension token missing");
      return NextResponse.json(
        { error: "extension token is required" },
        { status: 401 }
      );
    }

    // 拡張機能トークンから送信者ユーザーIDを特定
    const senderUserId = await getUserIdFromExtensionToken(
      effectiveExtensionToken
    );

    if (!senderUserId) {
      console.warn("[POST /api/raids] invalid extension token", {
        effectiveExtensionToken,
      });
      return NextResponse.json(
        { error: "invalid extension token" },
        { status: 401 }
      );
    }

    // 送信者がこのグループの承認済みメンバーかチェック
    const isMember = await isUserMemberOfGroup(groupId, senderUserId);
    if (!isMember) {
      console.warn("[POST /api/raids] forbidden (not member)", {
        groupId,
        senderUserId,
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 同じ groupId + raidId が既に存在するかチェック（重複IDを弾く）
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
      console.log("[POST /api/raids] duplicate raid id", { groupId, raidId });
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
      // ★ここで送信者の Supabase ユーザーIDを紐づけ
      sender_user_id: senderUserId,
    });

    if (insertError) {
      console.error("insert error", insertError);
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    console.log("[POST /api/raids] inserted raid", {
      groupId,
      raidId,
      bossName,
      senderUserId,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("POST /api/raids error", e);
    return NextResponse.json(
      { error: "Unexpected error" },
      { status: 500 }
    );
  }
}
