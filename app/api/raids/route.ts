// app/api/raids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});
const sb: any = supabase; // ★型推論を止める（Vercelビルド安定化）

// ===== 定数: 特殊ボスの判定 =====
const ULT_BAHAMUT_NAME = "Lv200 アルティメットバハムート";

// 既定: 7000万以下は非表示
const ULT_BAHAMUT_HP_THRESHOLD_DEFAULT = 65_000_000;

// 一部ユーザーのみ: 7600万以下は非表示（= 非表示体力を引き上げ）
const ULT_BAHAMUT_HP_THRESHOLD_SPECIAL = 76_000_000;

// ★指定の3ユーザー（ここに直書き）
const ULT_BAHAMUT_HP_THRESHOLD_SPECIAL_SENDER_IDS = new Set<string>([
  "461f0458-5494-47fc-b142-98e3eb389bdd",
  "86f9ace9-dad7-4daa-9c28-adb44759c252",
  "8cf84c8f-2052-47fb-a3a9-cf7f2980eef4",
]);

// （任意）環境変数でも追加できるようにしておく（不要なら消してOK）
for (const s of (
  process.env.ULT_BAHAMUT_HP_THRESHOLD_SPECIAL_SENDER_IDS ??
  process.env.NEXT_PUBLIC_ULT_BAHAMUT_HP_THRESHOLD_SPECIAL_SENDER_IDS ??
  ""
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)) {
  ULT_BAHAMUT_HP_THRESHOLD_SPECIAL_SENDER_IDS.add(s);
}

// ===== groupId 解決（Apoklisi -> UUID） =====
function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

async function resolveGroupUuidCandidates(groupIdParam: string): Promise<string[]> {
  const candidates = new Set<string>();

  // 既にUUIDならそれを使う
  if (isUuidLike(groupIdParam)) {
    candidates.add(groupIdParam);
    return Array.from(candidates);
  }

  // UUIDでない場合は groups テーブルから解決を試す
  // ※ 動的カラム指定を避ける（slug/name/group_name を固定で試す）
  try {
    const r = await sb.from("groups").select("id").eq("slug", groupIdParam).limit(10);
    if (!r.error && r.data?.length) {
      for (const row of r.data) {
        const id = String(row?.id ?? "");
        if (isUuidLike(id)) candidates.add(id);
      }
    }
  } catch {}

  try {
    const r = await sb.from("groups").select("id").eq("name", groupIdParam).limit(10);
    if (!r.error && r.data?.length) {
      for (const row of r.data) {
        const id = String(row?.id ?? "");
        if (isUuidLike(id)) candidates.add(id);
      }
    }
  } catch {}

  try {
    const r = await sb.from("groups").select("id").eq("group_name", groupIdParam).limit(10);
    if (!r.error && r.data?.length) {
      for (const row of r.data) {
        const id = String(row?.id ?? "");
        if (isUuidLike(id)) candidates.add(id);
      }
    }
  } catch {}

  // 何も見つからなければそのまま返す（後段で memberships が弾く想定）
  if (!candidates.size) candidates.add(groupIdParam);

  return Array.from(candidates);
}

async function resolveMembership(groupIdParam: string, userIdParam: string) {
  const groupCandidates = await resolveGroupUuidCandidates(groupIdParam);

  // group_memberships を group_id で照合（候補のどれかに一致すればOK）
  for (const gid of groupCandidates) {
    try {
      const r = await sb
        .from("group_memberships")
        .select("group_id,user_id,status")
        .eq("group_id", gid)
        .eq("user_id", userIdParam)
        .maybeSingle();

      if (!r.error && r.data) {
        return {
          ok: true,
          matchedGroupId: String(r.data.group_id),
          status: String(r.data.status ?? ""),
        };
      }
    } catch {}
  }

  return { ok: false, status: "not_member" };
}

// ===== ボス名ブロックリスト関連 =====
const BOSS_BLOCKLIST_CSV_URL =
  process.env.BOSS_BLOCKLIST_CSV_URL ?? process.env.NEXT_PUBLIC_BOSS_BLOCKLIST_CSV_URL;

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

  // URL 未設定なら空リスト
  if (!BOSS_BLOCKLIST_CSV_URL) {
    bossBlockList = new Set<string>();
    lastBossBlockListFetched = now;
    return bossBlockList;
  }

  try {
    const res = await fetch(BOSS_BLOCKLIST_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const csvText = await res.text();

    const set = new Set<string>();
    for (const line of csvText.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      // 1列目だけ使う（"boss_name" ヘッダはスキップ）
      if (t.toLowerCase() === "boss_name") continue;
      set.add(normalizeBossName(t));
    }

    bossBlockList = set;
    lastBossBlockListFetched = now;
    return bossBlockList;
  } catch (e) {
    console.error("[BOSS_BLOCKLIST] load error:", e);
    // 失敗しても前回のキャッシュがあればそれを返す
    if (bossBlockList) return bossBlockList;
    bossBlockList = new Set<string>();
    lastBossBlockListFetched = now;
    return bossBlockList;
  }
}

async function isBossBlocked(bossName: string | null | undefined): Promise<boolean> {
  if (!bossName) return false;
  const list = await loadBossBlockList();
  return list.has(normalizeBossName(bossName));
}

// ===== 参戦者数抑制（例: 参加人数が少なすぎる/多すぎる等） =====
function shouldSuppressByMembers(_memberCurrent: any, _memberMax: any) {
  // ここは既存ロジックを維持（必要なら後で調整）
  return false;
}

// ===== GET: 一覧取得 =====
export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const groupIdParam = url.searchParams.get("groupId") ?? url.searchParams.get("group_id");
  const userIdParam = url.searchParams.get("userId") ?? url.searchParams.get("user_id");

  if (!groupIdParam) {
    return NextResponse.json({ error: "missing groupId" }, { status: 400 });
  }
  if (!userIdParam) {
    return NextResponse.json({ error: "missing userId" }, { status: 400 });
  }

  const mem = await resolveMembership(groupIdParam, userIdParam);
  if (!mem.ok) {
    return NextResponse.json(
      { error: "forbidden", reason: mem.status },
      { status: 403 }
    );
  }

  const matchedGroupId = mem.matchedGroupId;

  try {
    let query = sb
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
          "sender_user_id",
          "created_at",
        ].join(",")
      )
      .eq("group_id", matchedGroupId)
      .order("created_at", { ascending: false })
      .limit(200);

    // 自分の投稿を除外したい場合（クライアント側で指定）
    const excludeUserId =
      url.searchParams.get("excludeUserId") ?? url.searchParams.get("exclude_user_id");
    if (excludeUserId) {
      query = query.not("sender_user_id", "eq", excludeUserId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[GET /api/raids] supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? [], { status: 200 });
  } catch (e) {
    console.error("[GET /api/raids] error:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
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
      return NextResponse.json({ error: "unsupported content type" }, { status: 415 });
    }

    const groupIdParam = body.groupId ?? body.group_id;
    const raidId = body.raidId ?? body.raid_id;

    const bossName = body.bossName ?? body.boss_name;
    const battleName = body.battleName ?? body.battle_name;

    const hpValue = body.hpValue ?? body.hp_value;
    const hpPercent = body.hpPercent ?? body.hp_percent;

    const userName = body.userName ?? body.user_name;
    const senderUserId = body.senderUserId ?? body.sender_user_id;

    const memberCurrent = body.memberCurrent ?? body.member_current;
    const memberMax = body.memberMax ?? body.member_max;

    // groupId 未指定は弾く
    if (!groupIdParam) {
      return NextResponse.json({ error: "missing groupId" }, { status: 400 });
    }
    // raidId 未指定は弾く
    if (!raidId) {
      return NextResponse.json({ error: "missing raidId" }, { status: 400 });
    }

    // groupId をUUIDへ解決（候補のどれかを採用）
    const groupCandidates = await resolveGroupUuidCandidates(String(groupIdParam));
    let resolvedGroupId: string | null = null;
    for (const gid of groupCandidates) {
      if (isUuidLike(gid)) {
        resolvedGroupId = gid;
        break;
      }
    }
    // UUIDでない場合はそのまま（ memberships が弾く想定）
    const matchedGroupId = resolvedGroupId ?? String(groupIdParam);

    // ブロックリスト判定
    if ((await isBossBlocked(bossName)) || (await isBossBlocked(battleName))) {
      return NextResponse.json({ ok: true, blocked: true }, { status: 200 });
    }

    // 参戦者数抑制
    if (shouldSuppressByMembers(memberCurrent, memberMax)) {
      return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
    }

    // ===== アルバハ200: sender_user_id によって非表示閾値を変える =====
    //  - 表示: 閾値より上のみ通す
    //  - 非表示: 閾値以下は弾く
    const hpValueNum = hpValue == null ? null : Number(hpValue);
    const isUltBaha = bossName === ULT_BAHAMUT_NAME || battleName === ULT_BAHAMUT_NAME;

    if (isUltBaha && hpValueNum != null && !Number.isNaN(hpValueNum)) {
      const sid = senderUserId ? String(senderUserId) : "";
      const threshold = ULT_BAHAMUT_HP_THRESHOLD_SPECIAL_SENDER_IDS.has(sid)
        ? ULT_BAHAMUT_HP_THRESHOLD_SPECIAL
        : ULT_BAHAMUT_HP_THRESHOLD_DEFAULT;

      if (hpValueNum <= threshold) {
        return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
      }
    }

    // INSERT
    const { error } = await sb.from("raids").insert([
      {
        group_id: matchedGroupId,
        raid_id: String(raidId),
        boss_name: bossName ?? null,
        battle_name: battleName ?? null,
        hp_value: hpValue == null ? null : Number(hpValue),
        hp_percent: hpPercent == null ? null : Number(hpPercent),
        member_current: memberCurrent == null ? null : Number(memberCurrent),
        member_max: memberMax == null ? null : Number(memberMax),
        user_name: userName ?? null,
        sender_user_id: senderUserId ?? null,
      },
    ]);

    if (error) {
      console.error("[POST /api/raids] insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("[POST /api/raids] error:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
