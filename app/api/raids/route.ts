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
const BOSS_BLOCKLIST_CACHE_MS = 5 * 60 * 1000; // 5分キャッシュ

async function fetchBossBlockList(): Promise<Set<string>> {
  // CSV URL が未設定なら常に空セット
  if (!BOSS_BLOCKLIST_CSV_URL) {
    return new Set();
  }

  const now = Date.now();
  if (bossBlockList && now - lastBossBlockListFetched < BOSS_BLOCKLIST_CACHE_MS) {
    return bossBlockList;
  }

  try {
    const res = await fetch(BOSS_BLOCKLIST_CSV_URL);
    if (!res.ok) {
      console.error("Failed to fetch BOSS_BLOCKLIST_CSV_URL", res.status);
      return bossBlockList ?? new Set();
    }

    const text = await res.text();
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")); // 空行 & #コメント除外

    const set = new Set<string>(lines);
    bossBlockList = set;
    lastBossBlockListFetched = now;
    console.log("[boss blocklist] fetched", { count: set.size });
    return set;
  } catch (e) {
    console.error("Error fetching boss blocklist CSV:", e);
    return bossBlockList ?? new Set();
  }
}

/** ブロック対象ボス名かどうか判定 */
async function isBlockedBoss(bossName?: string | null): Promise<boolean> {
  if (!bossName) return false;
  const set = await fetchBossBlockList();
  return set.has(bossName);
}

// -------- GET /api/raids --------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const groupId = searchParams.get("groupId");
    const limitStr = searchParams.get("limit") ?? "50";
    const excludeUserId = searchParams.get("excludeUserId") ?? null;

    const limit = Math.min(Math.max(Number(limitStr) || 50, 1), 200);

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
          "battle_name",
          "hp_value",
          "hp_percent",
          "user_name",
          "created_at",
          "member_current",
          "member_max",
          "sender_user_id",
        ],
        { count: "exact" }
      )
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(limit);

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

    const transformed =
      data?.map((row) => {
        const memberCurrent =
          row.member_current !== undefined && row.member_current !== null
            ? Number(row.member_current)
            : null;
        const memberMax =
          row.member_max !== undefined && row.member_max !== null
            ? Number(row.member_max)
            : null;

        return {
          id: row.id,
          groupId: row.group_id,
          raidId: row.raid_id,
          bossName: row.boss_name,
          battleName: row.battle_name,
          hpValue:
            row.hp_value !== undefined && row.hp_value !== null
              ? Number(row.hp_value)
              : null,
          hpPercent:
            row.hp_percent !== undefined && row.hp_percent !== null
              ? Number(row.hp_percent)
              : null,
          userName: row.user_name,
          createdAt: row.created_at,
          memberCurrent,
          memberMax,
          senderUserId: row.sender_user_id,
        };
      }) ?? [];

    return NextResponse.json(transformed);
  } catch (e) {
    console.error("GET /api/raids unexpected error", e);
    return NextResponse.json(
      { error: "Unexpected error" },
      { status: 500 }
    );
  }
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
      currentMemberCount,
      maxMemberCount,
      senderUserId,
    }: {
      groupId?: string;
      raidId?: string;
      bossName?: string | null;
      battleName?: string | null;
      hpValue?: number | null;
      hpPercent?: number | null;
      userName?: string | null;
      memberCurrent?: number | null;
      memberMax?: number | null;
      currentMemberCount?: number | null;
      maxMemberCount?: number | null;
      senderUserId?: string | null;
    } = body;

    // ★ currentMemberCount / maxMemberCount を既存の memberCurrent / memberMax と統合
    const normalizedMemberCurrent =
      memberCurrent ?? currentMemberCount ?? null;
    const normalizedMemberMax = memberMax ?? maxMemberCount ?? null;

    if (!groupId || !raidId) {
      return NextResponse.json(
        { error: "groupId and raidId are required" },
        { status: 400 }
      );
    }

    // ブロック対象ボスなら保存しない
    if (await isBlockedBoss(bossName)) {
      console.log("[boss blocklist] skip insert", { groupId, raidId, bossName });
      return NextResponse.json({ ok: true, blocked: true }, { status: 200 });
    }

    // 同一 groupId & raidId が既にあれば重複スキップ
    const { data: existing, error: selectError } = await supabase
      .from("raids")
      .select("id")
      .eq("group_id", groupId)
      .eq("raid_id", raidId)
      .limit(1)
      .maybeSingle();

    if (selectError && selectError.code !== "PGRST116") {
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
        normalizedMemberCurrent !== undefined &&
        normalizedMemberCurrent !== null
          ? Number(normalizedMemberCurrent)
          : null,
      member_max:
        normalizedMemberMax !== undefined && normalizedMemberMax !== null
          ? Number(normalizedMemberMax)
          : null,
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
