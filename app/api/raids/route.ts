// app/api/raids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ===== 定数: 特殊ボスの判定 =====
const ULT_BAHAMUT_NAME = "Lv200 アルティメットバハムート";
const ULT_BAHAMUT_HP_THRESHOLD = 70000000; // 70,000,000

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

  if (!BOSS_BLOCKLIST_CSV_URL) {
    bossBlockList = new Set();
    lastBossBlockListFetched = now;
    return bossBlockList;
  }

  try {
    const res = await fetch(BOSS_BLOCKLIST_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch blocklist: ${res.status}`);
    const text = await res.text();

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // 1列目だけ使う想定（ヘッダーがあるなら自動で外れるように工夫）
    // 「boss_name」等のヘッダーが来たら捨てる
    const set = new Set<string>();
    for (const line of lines) {
      const first = line.split(",")[0]?.trim();
      if (!first) continue;
      if (first.toLowerCase() === "boss_name") continue;
      set.add(normalizeBossName(first));
    }

    bossBlockList = set;
    lastBossBlockListFetched = now;
    return set;
  } catch (e) {
    console.error("loadBossBlockList error:", e);
    bossBlockList = new Set();
    lastBossBlockListFetched = now;
    return bossBlockList;
  }
}

async function isBossBlocked(name: string | null | undefined): Promise<boolean> {
  if (!name) return false;
  const set = await loadBossBlockList();
  return set.has(normalizeBossName(name));
}

// ===== ボス名 CSV マッピング関連（battle_name_map と同様の作り） =====
const BOSS_MAP_CSV_URL =
  process.env.BOSS_NAME_MAP_CSV_URL ?? process.env.NEXT_PUBLIC_BOSS_NAME_MAP_CSV_URL;

let bossMapCache: { map: Record<string, string>; sortedKeys: string[] } | null = null;
let lastBossMapFetched = 0;
const BOSS_MAP_TTL = 5 * 60 * 1000; // 5分

function toHalfwidthAndLower(s: string) {
  return (s || "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function removeCommonNoise(s: string) {
  // 「Lv」「level」「レベル」等や不要な記号をある程度落とす（必要に応じて拡張）
  return (s || "")
    .replace(/[\[\]【】()（）]/g, " ")
    .replace(/[・]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(raw: string) {
  return removeCommonNoise(toHalfwidthAndLower(raw || ""));
}

// --- CSV から作られた map を取得（キャッシュ付き） ---
async function fetchBossNameMapCached(
  force = false
): Promise<{ map: Record<string, string>; sortedKeys: string[] }> {
  const now = Date.now();
  if (!force && bossMapCache && now - lastBossMapFetched < BOSS_MAP_TTL) {
    return bossMapCache;
  }

  const empty = { map: {} as Record<string, string>, sortedKeys: [] as string[] };
  if (!BOSS_MAP_CSV_URL) {
    bossMapCache = empty;
    lastBossMapFetched = now;
    return empty;
  }

  try {
    const res = await fetch(BOSS_MAP_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`failed to fetch boss map csv: ${res.status}`);
    const text = await res.text();

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const map: Record<string, string> = {};

    // 1行目がヘッダーっぽい場合をスキップ（"from,to" / "before,after" 等）
    const startIndex = lines[0]?.toLowerCase().includes("from") ||
      lines[0]?.toLowerCase().includes("before") ||
      lines[0]?.toLowerCase().includes("変換前")
      ? 1
      : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const from = cols[0]?.trim();
      const to = cols[1]?.trim();
      if (!from || !to) continue;
      map[normalizeKey(from)] = to;
    }

    // 長いキーから先にマッチさせたいので length desc でソート
    const sortedKeys = Object.keys(map).sort((a, b) => b.length - a.length);

    bossMapCache = { map, sortedKeys };
    lastBossMapFetched = now;
    return bossMapCache;
  } catch (e) {
    console.error("fetchBossNameMapCached error:", e);
    bossMapCache = empty;
    lastBossMapFetched = now;
    return empty;
  }
}

// --- 文字列に対して map を適用して「統一名」にする ---
async function mapNormalize(name: string | null | undefined): Promise<string | null> {
  if (!name) return null;

  const raw = String(name).trim();
  if (!raw) return null;

  const { map, sortedKeys } = await fetchBossNameMapCached(false);
  if (!sortedKeys.length) return raw;

  const key = normalizeKey(raw);

  // 完全一致
  if (map[key]) return map[key];

  // 部分一致（長いキー優先）
  for (const k of sortedKeys) {
    if (!k) continue;
    if (key.includes(k)) return map[k];
  }

  return raw;
}

// ===== 参戦者数抑制（必要に応じて運用） =====
function shouldSuppressByMembers(memberCurrent: any, memberMax: any): boolean {
  // ここは既存仕様のまま（必要なら調整）
  return false;
}

// ===== GET: 一覧取得 =====
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const groupId = searchParams.get("groupId");
  const bossNameParam = searchParams.get("bossName");
  const limitParam = searchParams.get("limit");
  const excludeUserId = searchParams.get("excludeUserId");

  if (!groupId) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  // ===== アクセス制御: グループ所属チェック（member以外は403）=====
  // NOTE: 現状のフロントは localStorage の extensionUserId を excludeUserId として送っているため、
  // まずは excludeUserId を「呼び出し元ユーザーID」として扱います。
  // （将来的には token->user_id のサーバー側検証へ移行推奨）
  const callerUserId = searchParams.get("userId") || excludeUserId;

  if (!callerUserId) {
    return NextResponse.json({ error: "userId is required" }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("id,status")
    .eq("group_id", groupId)
    .eq("user_id", callerUserId)
    .maybeSingle();

  if (membershipError) {
    console.error("[GET /api/raids] membership check error", membershipError);
    return NextResponse.json({ error: "membership check failed" }, { status: 500 });
  }

  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const status = (membership as any)?.status as string | null | undefined;
  if (status && ["removed", "banned", "disabled", "inactive"].includes(status)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
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

    // bossName が指定された場合は mapNormalize を使って統一名に変換して検索する
    if (bossNameParam) {
      const normalizedBossNameParam = await mapNormalize(bossNameParam);
      query = query.or(
        `boss_name.eq.${normalizedBossNameParam},battle_name.eq.${normalizedBossNameParam}`
      );
    }

    // 自分の投稿を除外
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
      return NextResponse.json(
        { error: "Unsupported content type" },
        { status: 415 }
      );
    }

    const groupId = body.groupId ?? body.group_id;
    const raidId = body.raidId ?? body.raid_id;

    let bossName = body.bossName ?? body.boss_name;
    let battleName = body.battleName ?? body.battle_name;

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

    // ===== アクセス制御: 投稿者がグループ所属しているかチェック =====
    // senderUserId が無い投稿は拒否（グループ外からのPOSTを防ぐため）
    if (!senderUserId) {
      return NextResponse.json({ error: "senderUserId is required" }, { status: 401 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("group_memberships")
      .select("id,status")
      .eq("group_id", groupId)
      .eq("user_id", senderUserId)
      .maybeSingle();

    if (membershipError) {
      console.error("[POST /api/raids] membership check error", membershipError);
      return NextResponse.json({ error: "membership check failed" }, { status: 500 });
    }

    if (!membership) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const status = (membership as any)?.status as string | null | undefined;
    if (status && ["removed", "banned", "disabled", "inactive"].includes(status)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // ===== ここで bossName / battleName を統一名に変換してから扱う =====
    try {
      bossName = (await mapNormalize(bossName)) || (bossName ?? null);
      battleName = (await mapNormalize(battleName)) || (battleName ?? null);
    } catch (e) {
      console.error("mapNormalize error, falling back to raw", e);
      bossName = bossName ?? null;
      battleName = battleName ?? null;
    }

    // ===== ブロックリスト判定（boss_name/battle_name の両方をチェック）=====
    const bossBlocked = await isBossBlocked(bossName);
    const battleBlocked = await isBossBlocked(battleName);

    if (bossBlocked || battleBlocked) {
      console.log(
        "[POST /api/raids] blocked by boss blocklist, skip insert:",
        groupId,
        raidId,
        bossName,
        battleName
      );
      return NextResponse.json({ ok: true, blocked: true }, { status: 200 });
    }

    // ===== 参戦者数ルールで抑制する場合は早期終了 =====
    if (shouldSuppressByMembers(memberCurrent, memberMax)) {
      console.log(
        "[POST /api/raids] suppressed by member counts, skip insert",
        {
          groupId,
          raidId,
          member_current: memberCurrent,
          member_max: memberMax,
        }
      );
      return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
    }

    // ===== アルバハ200（例）特殊抑制（既存仕様のまま）=====
    // bossName がアルバハ200で hpValue が 7000万より大きい場合は抑制
    const hpValueNum = hpValue == null ? null : Number(hpValue);
    if (
      bossName === ULT_BAHAMUT_NAME &&
      hpValueNum != null &&
      !Number.isNaN(hpValueNum) &&
      hpValueNum > ULT_BAHAMUT_HP_THRESHOLD
    ) {
      console.log(
        "[POST /api/raids] suppressed by ULT_BAHAMUT hp threshold",
        { groupId, raidId, hpValue: hpValueNum }
      );
      return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
    }

    // ===== INSERT =====
    const { error } = await supabase.from("raids").insert([
      {
        group_id: groupId,
        raid_id: raidId,
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
