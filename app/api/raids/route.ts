// app/api/raids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// サーバーサイド専用 Supabase クライアント
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ===== ボス名ブロックリスト関連 =====
const BOSS_BLOCKLIST_CSV_URL =
  process.env.BOSS_BLOCKLIST_CSV_URL ??
  process.env.NEXT_PUBLIC_BOSS_BLOCKLIST_CSV_URL;

console.log("[env debug] BOSS_BLOCKLIST_CSV_URL =", BOSS_BLOCKLIST_CSV_URL);

let bossBlockList: Set<string> | null = null;
let lastBossBlockListFetched = 0;
const BOSS_BLOCKLIST_TTL = 5 * 60 * 1000; // 5分

function normalizeBossName(name: string): string {
  // 必要ならここで全角スペース対応などを追加
  return name.trim();
}

async function loadBossBlockList(): Promise<Set<string>> {
  const now = Date.now();

  if (bossBlockList && now - lastBossBlockListFetched < BOSS_BLOCKLIST_TTL) {
    return bossBlockList;
  }

  const set = new Set<string>();

  if (!BOSS_BLOCKLIST_CSV_URL) {
    console.warn("[boss blocklist] BOSS_BLOCKLIST_CSV_URL 未設定");
    bossBlockList = set;
    lastBossBlockListFetched = now;
    return set;
  }

  try {
    console.log("[boss blocklist] fetching from", BOSS_BLOCKLIST_CSV_URL);
    const res = await fetch(BOSS_BLOCKLIST_CSV_URL);

    if (!res.ok) {
      console.error(
        "[boss blocklist] fetch error",
        res.status,
        await res.text()
      );
      bossBlockList = set;
      lastBossBlockListFetched = now;
      return set;
    }

    const text = await res.text();
    const lines = text.split(/\r?\n/);

    if (lines.length <= 1) {
      console.warn("[boss blocklist] CSV が空");
    } else {
      // 1行目はヘッダー boss_name
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const bossName = line.split(",")[0];
        if (bossName) {
          set.add(normalizeBossName(bossName));
        }
      }
      console.log(
        "[boss blocklist] loaded names:",
        Array.from(set.values())
      );
    }
  } catch (e) {
    console.error("[boss blocklist] 取得エラー", e);
  }

  bossBlockList = set;
  lastBossBlockListFetched = now;
  return set;
}

async function isBlockedBoss(rawBossName?: string | null): Promise<boolean> {
  if (!rawBossName) return false;
  const name = normalizeBossName(rawBossName);
  if (!name) return false;

  const list = await loadBossBlockList();
  const blocked = list.has(name);

  if (blocked) {
    console.log("[boss blocklist] blocked boss:", name);
  }
  return blocked;
}

// ===== トークン → ユーザーID 解決 =====
// extension_tokens テーブルに (user_id, token) が入っている想定
async function resolveUserIdFromToken(
  token: string | null | undefined
): Promise<string | null> {
  if (!token) return null;
  const trimmed = token.trim();
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from("extension_tokens")
    .select("user_id")
    .eq("token", trimmed)
    .maybeSingle();

  if (error) {
    console.error("[token] resolve error", error);
    return null;
  }
  if (!data) {
    console.warn("[token] not found for token");
    return null;
  }

  return data.user_id as string;
}

// -------- GET /api/raids --------
// 例: /api/raids?groupId=friends1&limit=50&bossName=アルバハHL&excludeToken=xxxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("groupId");
  const bossName = searchParams.get("bossName");
  const limitParam = searchParams.get("limit") ?? "50";
  const excludeToken = searchParams.get("excludeToken");

  const limit = Number(limitParam);

  if (!groupId) {
    return NextResponse.json(
      { error: "groupId is required" },
      { status: 400 }
    );
  }

  let excludeUserId: string | null = null;
  if (excludeToken) {
    excludeUserId = await resolveUserIdFromToken(excludeToken);
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
      ].join(",")
    )
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(isNaN(limit) ? 50 : limit);

  if (bossName) {
    query = query.eq("boss_name", bossName);
  }
  if (excludeUserId) {
    query = query.neq("sender_user_id", excludeUserId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("GET /api/raids error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 新実装: { raids: [...] } で返す（page.tsx は配列単体にも対応済み）
  return NextResponse.json({ raids: data ?? [] });
}

// -------- POST /api/raids --------
// 拡張機能からの受け取り
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
      token, // ★ 拡張機能から送られてくるトークン
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
      token?: string | null;
    } = body;

    if (!groupId || !raidId) {
      return NextResponse.json(
        { error: "groupId and raidId are required" },
        { status: 400 }
      );
    }

    // ★ボスブロック
    if (await isBlockedBoss(bossName)) {
      console.log("[boss blocklist] skip insert (blocked)", {
        groupId,
        raidId,
        bossName,
      });
      return NextResponse.json({ ok: true, blocked: true }, { status: 200 });
    }

    // ★トークンから sender_user_id を解決
    const senderUserId = await resolveUserIdFromToken(token ?? null);

    // 重複チェック
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
        memberCurrent !== undefined && memberCurrent !== null
          ? Number(memberCurrent)
          : null,
      member_max:
        memberMax !== undefined && memberMax !== null
          ? Number(memberMax)
          : null,
      // ★ここで sender_user_id を保存
      sender_user_id: senderUserId ?? null,
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
