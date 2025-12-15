// app/api/raids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ===== ユーティリティ: JST(+09:00) の ISO 文字列 =====
function toJstIso(d: Date) {
  const z = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = z.getUTCFullYear();
  const mm = String(z.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(z.getUTCDate()).padStart(2, "0");
  const hh = String(z.getUTCHours()).padStart(2, "0");
  const mi = String(z.getUTCMinutes()).padStart(2, "0");
  const ss = String(z.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+09:00`;
}

function isUuidLike(s: string) {
  // 厳密v4に寄せず「UUIDっぽい」判定（既存データの揺れ対策）
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    s
  );
}

function toNumberOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// ===== 定数: 特殊ボスの判定 =====
const ULT_BAHAMUT_NAME = "Lv200 アルティメットバハムート";

// Lv200 アルティメットバハムートの「非表示」判定（hp_value <= threshold なら抑止）
const ULT_BAHAMUT_HP_THRESHOLD_DEFAULT = 70_000_000;
const ULT_BAHAMUT_HP_THRESHOLD_SPECIAL = 76_000_000;

// 「一部ユーザーIDからの送信時のみ 7,600万へ引き上げ」対象
const ULT_BAHAMUT_HP_THRESHOLD_SPECIAL_SENDERS = new Set<string>([
  "461f0458-5494-47fc-b142-98e3eb389bdd",
  "86f9ace9-dad7-4daa-9c28-adb44759c252",
  "8cf84c8f-2052-47fb-a3a9-cf7f2980eef4",
]);

// ===== Supabase =====
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const sb = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

/**
 * groupId(=UUID) / groupName(=文字列) を受け取り、groups.id(UUID) に解決する
 * - UUIDっぽい → groups.id で照合
 * - それ以外 → groups.name で照合
 *
 * ※動的カラム指定をしないので Type instantiation エラー回避
 */
async function resolveGroupUuid(groupParam: string | null): Promise<string | null> {
  if (!groupParam) return null;
  const p = String(groupParam).trim();
  if (!p) return null;

  // 1) UUIDっぽい場合は id として照合（存在確認もする）
  if (isUuidLike(p)) {
    const { data, error } = await sb.from("groups").select("id").eq("id", p).limit(1);
    if (!error && data && data[0]?.id) return String(data[0].id);
    // もし groups に無いUUIDが来たら無効扱い
    return null;
  }

  // 2) 文字列は name として照合
  const { data, error } = await sb.from("groups").select("id").eq("name", p).limit(1);
  if (!error && data && data[0]?.id) return String(data[0].id);

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 柔軟に受け取り
    const groupParam =
      toStringOrNull(body?.group_id) ??
      toStringOrNull(body?.groupId) ??
      toStringOrNull(body?.group_name) ??
      toStringOrNull(body?.groupName);

    const matchedGroupId = await resolveGroupUuid(groupParam);
    if (!matchedGroupId) {
      return NextResponse.json({ error: "Invalid groupId / groupName" }, { status: 400 });
    }

    const raidId =
      toStringOrNull(body?.raid_id) ?? toStringOrNull(body?.raidId);
    if (!raidId) {
      return NextResponse.json({ error: "raid_id is required" }, { status: 400 });
    }

    const bossName =
      toStringOrNull(body?.boss_name) ?? toStringOrNull(body?.bossName);
    const battleName =
      toStringOrNull(body?.battle_name) ?? toStringOrNull(body?.battleName);

    const hpValue = toNumberOrNull(body?.hp_value ?? body?.hpValue);
    const hpPercent = toNumberOrNull(body?.hp_percent ?? body?.hpPercent);

    const memberCurrent = toNumberOrNull(body?.member_current ?? body?.memberCurrent);
    const memberMax = toNumberOrNull(body?.member_max ?? body?.memberMax);

    const senderUserId =
      toStringOrNull(body?.sender_user_id) ?? toStringOrNull(body?.senderUserId);
    const userName =
      toStringOrNull(body?.user_name) ?? toStringOrNull(body?.userName);

    // created_at を JST ISO で保存
    const createdAt = toJstIso(new Date());

    // ===== Lv200 アルティメットバハムート: 非表示HPしきい値を一部送信者のみ 7,600万へ =====
    const isUltBaha =
      bossName === ULT_BAHAMUT_NAME || battleName === ULT_BAHAMUT_NAME;

    const ultBahaThreshold =
      senderUserId && ULT_BAHAMUT_HP_THRESHOLD_SPECIAL_SENDERS.has(senderUserId)
        ? ULT_BAHAMUT_HP_THRESHOLD_SPECIAL
        : ULT_BAHAMUT_HP_THRESHOLD_DEFAULT;

    if (isUltBaha && hpValue !== null && hpValue <= ultBahaThreshold) {
      // INSERT しない（抑止）
      return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
    }

    // INSERT
    const { error } = await sb.from("raids").insert([
      {
        group_id: matchedGroupId,
        raid_id: raidId,
        boss_name: bossName,
        battle_name: battleName,
        hp_value: hpValue,
        hp_percent: hpPercent,
        member_current: memberCurrent,
        member_max: memberMax,
        sender_user_id: senderUserId,
        user_name: userName,
        created_at: createdAt,
      },
    ]);

    if (error) {
      return NextResponse.json(
        { error: "Failed to insert raid", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Internal server error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const groupParam =
      url.searchParams.get("group_id") ??
      url.searchParams.get("groupId") ??
      url.searchParams.get("group_name") ??
      url.searchParams.get("groupName");

    const matchedGroupId = await resolveGroupUuid(groupParam);
    if (!matchedGroupId) {
      return NextResponse.json({ error: "Invalid groupId / groupName" }, { status: 400 });
    }

    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitParam ?? 200), 1), 1000);

    const { data, error } = await sb
      .from("raids")
      .select("*")
      .eq("group_id", matchedGroupId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch raids", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ raids: data ?? [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Internal server error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
