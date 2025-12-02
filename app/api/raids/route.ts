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

// ===== GET: 一覧取得 =====
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const groupId = searchParams.get("groupId");
  const bossName = searchParams.get("bossName");
  const limitParam = searchParams.get("limit");
  const excludeUserId = searchParams.get("excludeUserId");

  if (!groupId) {
    return NextResponse.json(
      { error: "groupId is required" },
      { status: 400 }
    );
  }

  let query = supabase
    .from("raids")
    .select(
      [
        "id",
        "group_id",
        "raid_id",
        "boss_name",
        "hp_value",
        "hp_percent",
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
    query = query.or(
      `sender_user_id.is.null,sender_user_id.neq.${excludeUserId}`
    );
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
      senderUserId,
    } = body;

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
      return NextResponse.json(
        { ok: true, blocked: true },
        { status: 200 }
      );
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
      return NextResponse.json(
        { error: selectError.message },
        { status: 500 }
      );
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
      hp_value:
        hpValue !== undefined && hpValue !== null ? Number(hpValue) : null,
      hp_percent:
        hpPercent !== undefined && hpPercent !== null
          ? Number(hpPercent)
          : null,
      user_name: userName ?? null,
      sender_user_id: senderUserId ?? null,
    });

    if (insertError) {
      console.error("insert error", insertError);
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    console.log("[POST /api/raids] inserted", {
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
