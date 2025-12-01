// app/api/raids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// サーバーサイド専用の Supabase クライアント
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ===== ボス名ブロックリスト関連 =====
const BOSS_BLOCKLIST_CSV_URL =
  process.env.BOSS_BLOCKLIST_CSV_URL ??
  process.env.NEXT_PUBLIC_BOSS_BLOCKLIST_CSV_URL;

console.log("[env debug] BOSS_BLOCKLIST_CSV_URL =", BOSS_BLOCKLIST_CSV_URL);

let bossBlocklistCache: Set<string> | null = null;
let bossBlocklistFetchedAt: number | null = null;
const BOSS_BLOCKLIST_TTL_MS = 5 * 60 * 1000; // 5分キャッシュ

async function loadBossBlocklist(): Promise<Set<string>> {
  if (!BOSS_BLOCKLIST_CSV_URL) {
    return new Set();
  }

  const now = Date.now();
  if (
    bossBlocklistCache &&
    bossBlocklistFetchedAt &&
    now - bossBlocklistFetchedAt < BOSS_BLOCKLIST_TTL_MS
  ) {
    return bossBlocklistCache;
  }

  try {
    const res = await fetch(BOSS_BLOCKLIST_CSV_URL);
    if (!res.ok) {
      console.error("[boss blocklist] fetch error", res.status);
      return bossBlocklistCache ?? new Set();
    }

    const text = await res.text();

    // 1行ごとに boss_name が書いてあるだけ、もしくは CSV の1列目として扱う想定
    const list = new Set<string>();
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      const firstCell = line.split(",")[0]?.trim();
      if (!firstCell) continue;

      list.add(firstCell);
    }

    bossBlocklistCache = list;
    bossBlocklistFetchedAt = now;

    console.log("[boss blocklist] loaded", list.size);
    return list;
  } catch (e) {
    console.error("[boss blocklist] unexpected error", e);
    return bossBlocklistCache ?? new Set();
  }
}

async function isBlockedBoss(bossName: string | null | undefined) {
  if (!bossName) return false;

  const list = await loadBossBlocklist();
  const blocked = list.has(bossName);

  if (blocked) {
    console.log("[boss blocklist] blocked boss:", bossName);
  }
  return blocked;
}

// ===== トークン → ユーザーID 解決 =====
// extension_tokens テーブルで token -> user_id を引く想定
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

// ===== GET: 一覧取得 =====
// 例: /api/raids?groupId=friends1&limit=50&excludeToken=xxxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const groupId = searchParams.get("groupId") ?? "friends1";
    const limitParam = searchParams.get("limit");
    const excludeToken = searchParams.get("excludeToken");

    const limit = (() => {
      const n = Number(limitParam);
      if (!Number.isFinite(n) || n <= 0) return 100;
      return Math.min(n, 200);
    })();

    let excludeUserId: string | null = null;
    if (excludeToken) {
      excludeUserId = await resolveUserIdFromToken(excludeToken);
    }

    let query = supabase
      .from("raids")
      .select(
        "id, group_id, raid_id, boss_name, battle_name, hp_value, hp_percent, member_current, member_max, user_name, sender_user_id, created_at"
      )
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (excludeUserId) {
      query = query.neq("sender_user_id", excludeUserId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("GET /api/raids error", error);
      return NextResponse.json(
        { error: "failed to fetch raids" },
        { status: 500 }
      );
    }

    return NextResponse.json({ raids: data ?? [] }, { status: 200 });
  } catch (e) {
    console.error("GET /api/raids unexpected error", e);
    return NextResponse.json(
      { error: "Unexpected error" },
      { status: 500 }
    );
  }
}

// ===== POST: 新しいIDを登録 =====
// 拡張機能からの POST 入口
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
      token,
    } = body as {
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
    };

    if (!groupId || !raidId) {
      return NextResponse.json(
        { error: "groupId and raidId are required" },
        { status: 400 }
      );
    }

    // ボスブロック
    if (await isBlockedBoss(bossName ?? null)) {
      console.log("[boss blocklist] skip insert due to blocklist", {
        groupId,
        raidId,
        bossName,
      });
      return NextResponse.json({ ok: true, blocked: true }, { status: 200 });
    }

    // トークンから user_id を解決（なければ null）
    const senderUserId = await resolveUserIdFromToken(token);

    // 重複チェック（同じ groupId & raidId が既にあればスキップ）
    const { data: existing, error: existingError } = await supabase
      .from("raids")
      .select("id")
      .eq("group_id", groupId)
      .eq("raid_id", raidId)
      .limit(1);

    if (existingError) {
      console.error("POST /api/raids existing check error", existingError);
    }

    if (existing && existing.length > 0) {
      console.log("[raids] duplicated raid, skip insert", { groupId, raidId });
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
      hp_value: typeof hpValue === "number" ? hpValue : null,
      hp_percent: typeof hpPercent === "number" ? hpPercent : null,
      member_current:
        typeof memberCurrent === "number" ? memberCurrent : null,
      member_max: typeof memberMax === "number" ? memberMax : null,
      user_name: userName ?? null,
      sender_user_id: senderUserId, // ★ 自分判定用
    });

    if (insertError) {
      console.error("POST /api/raids insert error", insertError);
      return NextResponse.json(
        { error: "failed to insert raid" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("POST /api/raids unexpected error", e);
    return NextResponse.json(
      { error: "Unexpected error" },
      { status: 500 }
    );
  }
}
