// app/api/raids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ===== ボス名ブロックリスト関連 =====
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
    bossBlockList = set;
    lastBossBlockListFetched = now;
    return set;
  }

  try {
    const response = await fetch(BOSS_BLOCKLIST_CSV_URL);
    if (!response.ok) {
      console.error(
        "[boss blocklist] CSV fetch failed",
        response.status,
        response.statusText
      );
      bossBlockList = set;
      lastBossBlockListFetched = now;
      return set;
    }

    const text = await response.text();
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      set.add(normalizeBossName(trimmed));
    }
  } catch (e) {
    console.error("[boss blocklist] 取得エラー", e);
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
  return list.has(normalizeBossName(bossName));
}

function toNumberOrNull(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(v: any): number | null {
  const n = toNumberOrNull(v);
  if (n === null) return null;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// ===== 新規: 参戦者数抑制判定ユーティリティ =====
function shouldSuppressByMembers(
  memberCurrentRaw: any,
  memberMaxRaw: any
): boolean {
  const mc = toIntOrNull(memberCurrentRaw);
  const mm = toIntOrNull(memberMaxRaw);

  if (mc === null || mm === null) return false;

  // member_max が 6 のときは member_current が 6 の場合に流さない
  if (mm === 6 && mc === 6) return true;

  // member_max が 18 または 30 のときは member_current が 10 以上なら流さない
  if ((mm === 18 || mm === 30) && mc >= 10) return true;

  return false;
}

// ===== GET: 一覧取得 =====
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const groupId = searchParams.get("groupId");
  const bossName = searchParams.get("bossName");
  const limitParam = searchParams.get("limit");
  const excludeUserId = searchParams.get("excludeUserId");

  if (!groupId) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
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
        "member_current",
        "member_max",
        "user_name",
        "created_at",
        "sender_user_id",
      ].join(",")
    )
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(isNaN(Number(limitParam)) ? 50 : Number(limitParam));

  if (bossName) {
    query = query.eq("boss_name", bossName);
  }

  // ★ 自分のIDだけ除外したいが、sender_user_id が NULL のレコードは表示したい
  // -> (sender_user_id IS NULL OR sender_user_id != excludeUserId)
  if (excludeUserId) {
    query = query.or(`sender_user_id.is.null,sender_user_id.neq.${excludeUserId}`);
  }

  const { data, error } = await query;

  if (error) {
    console.error("GET /api/raids error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

// ===== POST: 1件登録 =====
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    let body: any;
    if (contentType.includes("application/json")) {
      body = await req.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      body = Object.fromEntries(formData.entries());
    } else {
      return NextResponse.json(
        { error: "Unsupported content type" },
        { status: 415 }
      );
    }

    const groupId = body.groupId ?? body.group_id;
    const raidId = body.raidId ?? body.raid_id;

    const bossName = body.bossName ?? body.boss_name;
    const battleName = body.battleName ?? body.battle_name;

    const hpValue = body.hpValue ?? body.hp_value;
    const hpPercent = body.hpPercent ?? body.hp_percent;

    const userName = body.userName ?? body.user_name;
    const senderUserId = body.senderUserId ?? body.sender_user_id;

    const memberCurrent = body.memberCurrent ?? body.member_current;
    const memberMax = body.memberMax ?? body.member_max;

    if (!groupId || !raidId) {
      return NextResponse.json(
        { error: "groupId and raidId are required" },
        { status: 400 }
      );
    }

    // ===== ボスブロックリスト判定 =====
    const blocked = await isBlockedBoss(bossName);
    if (blocked) {
      console.log(
        "[POST /api/raids] blocked boss, skip insert",
        groupId,
        raidId,
        bossName
      );
      return NextResponse.json({ ok: true, blocked: true }, { status: 200 });
    }

    // ===== 参戦者数ルールで抑制する場合は早期終了 =====
    if (shouldSuppressByMembers(memberCurrent, memberMax)) {
      console.log(
        "[POST /api/raids] suppressed by member counts, skip insert",
        { groupId, raidId, member_current: memberCurrent, member_max: memberMax }
      );
      return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
    }

    // ===== 重複チェック（同じ group_id + raid_id が既にある場合はスキップ）=====
    const { data: existing, error: selectError } = await supabase
      .from("raids")
      .select("id")
      .eq("group_id", groupId)
      .eq("raid_id", raidId)
      .maybeSingle();

    if (selectError) {
      console.error("select existing error", selectError);
      return NextResponse.json({ error: selectError.message }, { status: 500 });
    }

    if (existing) {
      console.log("[POST /api/raids] duplicate raid id", { groupId, raidId });
      return NextResponse.json({ ok: true, duplicated: true }, { status: 200 });
    }

    const insertRow = {
      group_id: groupId,
      raid_id: raidId,
      boss_name: bossName ?? null,
      battle_name: battleName ?? null,
      hp_value: toNumberOrNull(hpValue),
      hp_percent: toNumberOrNull(hpPercent),
      member_current: toIntOrNull(memberCurrent),
      member_max: toIntOrNull(memberMax),
      user_name: userName ?? null,
      sender_user_id: senderUserId ?? null,
    };

    const { error: insertError } = await supabase.from("raids").insert(insertRow);

    if (insertError) {
      console.error("insert error", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    console.log("[POST /api/raids] inserted", {
      groupId,
      raidId,
      bossName,
      senderUserId,
      member_current: insertRow.member_current,
      member_max: insertRow.member_max,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("POST /api/raids error", e);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
