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
const ULT_BAHAMUT_HP_THRESHOLD_DEFAULT = 65000000;
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

// ===== groupId 解決（Apoklisi -> UUID） =====
function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

async function resolveGroupUuidCandidates(groupIdParam: string) {
  // そのままUUIDならそれを候補として返す
  const candidates: string[] = [];
  if (typeof groupIdParam === "string" && isUuidLike(groupIdParam)) {
    candidates.push(groupIdParam);
  }

  // name / group_id / groupId などどのカラムでも拾えるように探索（過去互換）
  // ※ Supabase 側の groups テーブル構成が環境で異なる想定
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
    const found = await tryColumn(col);
    if (found && isUuidLike(found)) candidates.push(found);
  }

  // 重複排除
  return Array.from(new Set(candidates));
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    let body: any = {};
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

    const groupIdParam = body.groupId ?? body.group_id;
    const raidId = body.raidId ?? body.raid_id;

    let bossName = body.bossName ?? body.boss_name;
    let battleName = body.battleName ?? body.battle_name;

    const hpValue = body.hpValue ?? body.hp_value;
    const hpPercent = body.hpPercent ?? body.hp_percent;

    const userName = body.userName ?? body.user_name;
    const senderUserId = body.senderUserId ?? body.sender_user_id;

    // 参戦者数
    const memberCurrent = body.memberCurrent ?? body.member_current ?? null;
    const memberMax = body.memberMax ?? body.member_max ?? null;

    if (!groupIdParam || !raidId) {
      return NextResponse.json(
        { error: "groupId and raidId are required" },
        { status: 400 }
      );
    }

    // groupIdParam が UUID でなくても groups から UUID を解決して raids.group_id に入れる
    const candidates = await resolveGroupUuidCandidates(String(groupIdParam));
    const matchedGroupId =
      candidates[0] ?? (isUuidLike(String(groupIdParam)) ? String(groupIdParam) : null);

    if (!matchedGroupId) {
      return NextResponse.json(
        { error: "Group not found / cannot resolve UUID" },
        { status: 404 }
      );
    }

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

    // アルバハ200（表示条件: threshold超のみ通す）
    //  - 通常送信者: 表示 70,000,000 超 / 非表示 70,000,000 以下
    //  - 特定送信者: 表示 76,000,000 超 / 非表示 76,000,000 以下
    const hpValueNum = hpValue == null ? null : Number(hpValue);
    const isUltBaha = bossName === ULT_BAHAMUT_NAME || battleName === ULT_BAHAMUT_NAME;

    const senderUserIdStr =
      senderUserId == null ? null : String(senderUserId).trim();

    const ultBahaThreshold =
      senderUserIdStr && ULT_BAHAMUT_HP_THRESHOLD_SPECIAL_SENDERS.has(senderUserIdStr)
        ? ULT_BAHAMUT_HP_THRESHOLD_SPECIAL
        : ULT_BAHAMUT_HP_THRESHOLD_DEFAULT;

    if (
      isUltBaha &&
      hpValueNum != null &&
      !Number.isNaN(hpValueNum) &&
      hpValueNum <= ultBahaThreshold
    ) {
      return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
    }

    // INSERT（group_id は matchedGroupId(UUID) を入れる）
    const { error } = await sb.from("raids").insert([
      {
        group_id: matchedGroupId,
        raid_id: raidId,
        boss_name: bossName,
        battle_name: battleName,
        hp_value: hpValueNum,
        hp_percent: hpPercent == null ? null : Number(hpPercent),
        user_name: userName == null ? null : String(userName),
        sender_user_id: senderUserId == null ? null : String(senderUserId),
        member_current:
          memberCurrent == null || memberCurrent === ""
            ? null
            : Number(memberCurrent),
        member_max:
          memberMax == null || memberMax === "" ? null : Number(memberMax),
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
    const { searchParams } = new URL(req.url);
    const groupIdParam = searchParams.get("groupId") ?? searchParams.get("group_id");

    if (!groupIdParam) {
      return NextResponse.json(
        { error: "groupId is required" },
        { status: 400 }
      );
    }

    const candidates = await resolveGroupUuidCandidates(String(groupIdParam));
    const matchedGroupId =
      candidates[0] ?? (isUuidLike(String(groupIdParam)) ? String(groupIdParam) : null);

    if (!matchedGroupId) {
      return NextResponse.json(
        { error: "Group not found / cannot resolve UUID" },
        { status: 404 }
      );
    }

    const limitRaw = searchParams.get("limit");
    const limit = limitRaw ? Math.min(Math.max(Number(limitRaw), 1), 200) : 50;

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
