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
      // 1行目はヘッダー想定
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

// -------- GET /api/raids --------
// 認証・トークンチェック一切なし。指定グループのIDをそのまま返す。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const groupIdSingle = searchParams.get("groupId");
  const groupIdsParam = searchParams.get("groupIds");
  const bossName = searchParams.get("bossName");
  const limitParam = searchParams.get("limit") ?? "50";
  const limit = Number(limitParam);

  let groupIds: string[] = [];

  if (groupIdsParam) {
    groupIds = groupIdsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (groupIdSingle) {
    groupIds = [groupIdSingle];
  }

  if (groupIds.length === 0) {
    return NextResponse.json(
      { error: "groupId or groupIds is required" },
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
        "battle_name",
        "hp_value",
        "hp_percent",
        "user_name",
        "created_at",
        "member_current",
        "member_max",
      ].join(",")
    )
    .in("group_id", groupIds)
    .order("created_at", { ascending: false })
    .limit(isNaN(limit) ? 50 : limit);

  if (bossName) {
    query = query.eq("boss_name", bossName);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[GET /api/raids] supabase error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

// -------- POST /api/raids --------
// トークン・グループ所属チェックなしで、ただ insert するだけ。
// 同じ groupId + raidId があればスキップ。
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
    } = body ?? {};

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

    // 重複チェック
    const { data: existing, error: selectError } = await supabase
      .from("raids")
      .select("id")
      .eq("group_id", groupId)
      .eq("raid_id", raidId)
      .limit(1)
      .maybeSingle();

    if (selectError && (selectError as any).code !== "PGRST116") {
      console.error("[POST /api/raids] select error", selectError);
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
          ? Number(memberCurrent) : null,
      member_max:
        memberMax !== undefined && memberMax !== null
          ? Number(memberMax) : null,
    });

    if (insertError) {
      console.error("[POST /api/raids] insert error", insertError);
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("[POST /api/raids] error", e);
    return NextResponse.json(
      { error: "Unexpected error" },
      { status: 500 }
    );
  }
}
