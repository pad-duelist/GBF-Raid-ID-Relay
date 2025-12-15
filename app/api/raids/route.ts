// app/api/raids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ===== ユーティリティ: JST(+09:00) の ISO を作る（created_at をJSTで返したい用途） =====
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

// ===== 定数: 特殊ボスの判定 =====
const ULT_BAHAMUT_NAME = "Lv200 アルティメットバハムート";

// Lv200 アルティメットバハムートの「非表示」判定（hpValue <= threshold）
// 通常: 70,000,000
// 一部送信者のみ: 76,000,000
const ULT_BAHAMUT_HP_THRESHOLD_DEFAULT = 70000000;
const ULT_BAHAMUT_HP_THRESHOLD_SPECIAL = 76000000;

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

// ===== groupId を name / id どちらでも受けられるように “それっぽいカラム” を試して UUID を引く =====
async function resolveGroupUuid(groupIdParam: string | null): Promise<string | null> {
  if (!groupIdParam) return null;

  const tryColumn = async (col: string) => {
    try {
      const { data, error } = await sb
        .from("groups")
        .select("id")
        .eq(col as any, groupIdParam)
        .limit(1);

      if (!error && data && data[0]?.id) return String(data[0].id);
    } catch {
      // ignore
    }
    return null;
  };

  // よくあるカラム名を順に試す
  const cols = ["id", "group_id", "groupId", "name", "group_name", "groupName"];
  for (const col of cols) {
    const v = await tryColumn(col);
    if (v) return v;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 受け取り想定（既存仕様に合わせて柔軟に）
    let {
      group_id,
      groupId,
      group_name,
      groupName,
      raid_id,
      raidId,
      boss_name,
      bossName,
      battle_name,
      battleName,
      hp_value,
      hpValue,
      hp_percent,
      hpPercent,
      member_current,
      memberCurrent,
      member_max,
      memberMax,
      sender_user_id,
      senderUserId,
      user_name,
      userName,
    } = body ?? {};

    const groupIdParam =
      group_id ?? groupId ?? group_name ?? groupName ?? null;

    const matchedGroupId = await resolveGroupUuid(
      groupIdParam == null ? null : String(groupIdParam)
    );

    if (!matchedGroupId) {
      return NextResponse.json(
        { error: "Invalid groupId / groupName" },
        { status: 400 }
      );
    }

    const raidIdStr = raid_id ?? raidId;
    if (!raidIdStr || String(raidIdStr).trim() === "") {
      return NextResponse.json({ error: "raid_id is required" }, { status: 400 });
    }
    const raidIdNorm = String(raidIdStr).trim();

    // created_at を JST ISO で保存したい場合（既存仕様に合わせて）
    const createdAt = toJstIso(new Date());

    // 空文字を正規化
    bossName =
      bossName == null || String(bossName).trim() === ""
        ? null
        : String(bossName);
    battleName =
      battleName == null || String(battleName).trim() === ""
        ? null
        : String(battleName);

    // hp_value / hp_percent を number 化（空なら null）
    const hpValueNum =
      hp_value ?? hpValue ?? null;
    const hpValueParsed =
      hpValueNum == null || hpValueNum === "" ? null : Number(hpValueNum);

    const hpPercentNum =
      hp_percent ?? hpPercent ?? null;
    const hpPercentParsed =
      hpPercentNum == null || hpPercentNum === "" ? null : Number(hpPercentNum);

    const senderUserIdStr =
      sender_user_id ?? senderUserId ?? null;
    const senderUserIdNorm =
      senderUserIdStr == null ? null : String(senderUserIdStr).trim();

    const userNameStr = user_name ?? userName ?? null;
    const userNameNorm =
      userNameStr == null ? null : String(userNameStr);

    const memberCurrentStr = member_current ?? memberCurrent ?? null;
    const memberMaxStr = member_max ?? memberMax ?? null;

    // ===== Lv200 アルティメットバハムート: 非表示HPしきい値を一部送信者のみ 7,600万へ =====
    const isUltBaha = bossName === ULT_BAHAMUT_NAME || battleName === ULT_BAHAMUT_NAME;

    const ultBahaThreshold =
      senderUserIdNorm &&
      ULT_BAHAMUT_HP_THRESHOLD_SPECIAL_SENDERS.has(senderUserIdNorm)
        ? ULT_BAHAMUT_HP_THRESHOLD_SPECIAL
        : ULT_BAHAMUT_HP_THRESHOLD_DEFAULT;

    if (
      isUltBaha &&
      hpValueParsed != null &&
      !Number.isNaN(hpValueParsed) &&
      hpValueParsed <= ultBahaThreshold
    ) {
      // INSERTしない（抑止）
      return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
    }

    // INSERT（group_id は matchedGroupId(UUID) を入れる）
    const { error } = await sb.from("raids").insert([
      {
        group_id: matchedGroupId,
        raid_id: raidIdNorm,
        boss_name: bossName,
        battle_name: battleName,
        hp_value: hpValueParsed,
        hp_percent: hpPercentParsed,
        sender_user_id: senderUserIdNorm,
        user_name: userNameNorm,
        member_current:
          memberCurrentStr == null || memberCurrentStr === ""
            ? null
            : Number(memberCurrentStr),
        member_max:
          memberMaxStr == null || memberMaxStr === "" ? null : Number(memberMaxStr),
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

    const groupIdParam =
      url.searchParams.get("group_id") ??
      url.searchParams.get("groupId") ??
      url.searchParams.get("group_name") ??
      url.searchParams.get("groupName");

    const matchedGroupId = await resolveGroupUuid(groupIdParam);

    if (!matchedGroupId) {
      return NextResponse.json(
        { error: "Invalid groupId / groupName" },
        { status: 400 }
      );
    }

    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(
      Math.max(Number(limitParam ?? 200), 1),
      1000
    );

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
