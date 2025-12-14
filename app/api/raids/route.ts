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
const ULT_BAHAMUT_HP_THRESHOLD = 70000000; // 70,000,000

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
        if (id && isUuidLike(id)) candidates.add(id);
      }
    }
  } catch {
    // ignore
  }

  try {
    const r = await sb.from("groups").select("id").eq("name", groupIdParam).limit(10);
    if (!r.error && r.data?.length) {
      for (const row of r.data) {
        const id = String(row?.id ?? "");
        if (id && isUuidLike(id)) candidates.add(id);
      }
    }
  } catch {
    // ignore
  }

  try {
    const r = await sb.from("groups").select("id").eq("group_name", groupIdParam).limit(10);
    if (!r.error && r.data?.length) {
      for (const row of r.data) {
        const id = String(row?.id ?? "");
        if (id && isUuidLike(id)) candidates.add(id);
      }
    }
  } catch {
    // ignore
  }

  return Array.from(candidates);
}

async function findMembershipMatchedGroupId(opts: {
  groupIdParam: string;
  userId: string;
}): Promise<
  | { ok: true; matchedGroupId: string; status: string | null }
  | { ok: false; statusCode: number; reason: string; resolvedGroupIds?: string[] }
> {
  const { groupIdParam, userId } = opts;

  const resolvedGroupIds = await resolveGroupUuidCandidates(groupIdParam);
  if (resolvedGroupIds.length === 0) {
    return { ok: false, statusCode: 404, reason: "group_not_found", resolvedGroupIds };
  }

  for (const gid of resolvedGroupIds) {
    const { data, error } = await sb
      .from("group_memberships")
      .select("id,status,group_id,user_id")
      .eq("group_id", gid)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("membership check error:", error);
      return { ok: false, statusCode: 500, reason: "membership_check_failed", resolvedGroupIds };
    }

    if (!data) continue;

    const status = ((data as any)?.status as string | null | undefined) ?? null;
    if (status && ["removed", "banned", "disabled", "inactive"].includes(status)) {
      return { ok: false, statusCode: 403, reason: "status_blocked", resolvedGroupIds };
    }

    return { ok: true, matchedGroupId: gid, status };
  }

  return { ok: false, statusCode: 403, reason: "not_member", resolvedGroupIds };
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

// ===== ボス名 CSV マッピング関連 =====
const BOSS_MAP_CSV_URL =
  process.env.BOSS_NAME_MAP_CSV_URL ?? process.env.NEXT_PUBLIC_BOSS_NAME_MAP_CSV_URL;

let bossMapCache: { map: Record<string, string>; sortedKeys: string[] } | null = null;
let lastBossMapFetched = 0;
const BOSS_MAP_TTL = 5 * 60 * 1000; // 5分

function toHalfwidthAndLower(s: string) {
  return (s || "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function removeCommonNoise(s: string) {
  return (s || "")
    .replace(/[\[\]【】()（）]/g, " ")
    .replace(/[・]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(raw: string) {
  return removeCommonNoise(toHalfwidthAndLower(raw || ""));
}

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

    const header = lines[0]?.toLowerCase() ?? "";
    const startIndex =
      header.includes("from") || header.includes("before") || header.includes("変換前") ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const from = cols[0]?.trim();
      const to = cols[1]?.trim();
      if (!from || !to) continue;
      map[normalizeKey(from)] = to;
    }

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

async function mapNormalize(name: string | null | undefined): Promise<string | null> {
  if (!name) return null;

  const raw = String(name).trim();
  if (!raw) return null;

  const { map, sortedKeys } = await fetchBossNameMapCached(false);
  if (!sortedKeys.length) return raw;

  const key = normalizeKey(raw);

  if (map[key]) return map[key];

  for (const k of sortedKeys) {
    if (!k) continue;
    if (key.includes(k)) return map[k];
  }

  return raw;
}

// ===== 参戦者数抑制（必要なら後で拡張） =====
function shouldSuppressByMembers(_memberCurrent: any, _memberMax: any): boolean {
  return false;
}

// ===== GET: 一覧取得 =====
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const groupIdParam = searchParams.get("groupId");
  const bossNameParam = searchParams.get("bossName");
  const limitParam = searchParams.get("limit");
  const excludeUserId = searchParams.get("excludeUserId");

  if (!groupIdParam) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  // 呼び出し元ユーザーID（現状フロントが excludeUserId を送っている前提）
  const callerUserId = searchParams.get("userId") || excludeUserId;
  if (!callerUserId) {
    return NextResponse.json({ error: "userId is required" }, { status: 401 });
  }

  // 所属チェック + matchedGroupId(UUID) を確定
  const mem = await findMembershipMatchedGroupId({
    groupIdParam,
    userId: callerUserId,
  });

  if (!mem.ok) {
    return NextResponse.json(
      { error: mem.reason, resolvedGroupIds: mem.resolvedGroupIds ?? undefined },
      { status: mem.statusCode }
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
          "created_at",
          "sender_user_id",
        ].join(",")
      )
      .eq("group_id", matchedGroupId)
      .order("created_at", { ascending: false })
      .limit(isNaN(Number(limitParam)) ? 50 : Number(limitParam));

    if (bossNameParam) {
      const normalizedBossNameParam = await mapNormalize(bossNameParam);
      if (normalizedBossNameParam) {
        query = query.or(
          `boss_name.eq.${normalizedBossNameParam},battle_name.eq.${normalizedBossNameParam}`
        );
      }
    }

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
      return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
    }

    const groupIdParam = body.groupId ?? body.group_id;
    const raidId = body.raidId ?? body.raid_id;

    let bossName = body.bossName ?? body.boss_name;
    let battleName = body.battleName ?? body.battle_name;

    const hpValue = body.hpValue ?? body.hp_value;
    const hpPercent = body.hpPercent ?? body.hp_percent;

    const userName = body.userName ?? body.user_name;
    const senderUserId = body.senderUserId ?? body.sender_user_id;

    const memberCurrent = body.memberCurrent ?? body.member_current;
    const memberMax = body.memberMax ?? body.member_max;

    if (!groupIdParam || !raidId) {
      return NextResponse.json({ error: "groupId and raidId are required" }, { status: 400 });
    }

    // senderUserId が無い投稿は拒否（グループ外からのPOSTを防ぐ）
    if (!senderUserId) {
      return NextResponse.json({ error: "senderUserId is required" }, { status: 401 });
    }

    // 所属チェック + matchedGroupId(UUID) を確定
    const mem = await findMembershipMatchedGroupId({
      groupIdParam,
      userId: senderUserId,
    });

    if (!mem.ok) {
      return NextResponse.json(
        { error: mem.reason, resolvedGroupIds: mem.resolvedGroupIds ?? undefined },
        { status: mem.statusCode }
      );
    }

    const matchedGroupId = mem.matchedGroupId;

    // bossName / battleName を統一名に変換
    try {
      bossName = (await mapNormalize(bossName)) || (bossName ?? null);
      battleName = (await mapNormalize(battleName)) || (battleName ?? null);
    } catch (e) {
      console.error("mapNormalize error, falling back to raw", e);
      bossName = bossName ?? null;
      battleName = battleName ?? null;
    }

    // ブロックリスト判定
    const bossBlocked = await isBossBlocked(bossName);
    const battleBlocked = await isBossBlocked(battleName);
    if (bossBlocked || battleBlocked) {
      return NextResponse.json({ ok: true, blocked: true }, { status: 200 });
    }

    // 参戦者数抑制
    if (shouldSuppressByMembers(memberCurrent, memberMax)) {
      return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
    }

    // アルバハ200（既存仕様）
    const hpValueNum = hpValue == null ? null : Number(hpValue);
    if (
      bossName === ULT_BAHAMUT_NAME &&
      hpValueNum != null &&
      !Number.isNaN(hpValueNum) &&
      hpValueNum > ULT_BAHAMUT_HP_THRESHOLD
    ) {
      return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
    }

    // INSERT（group_id は matchedGroupId(UUID) を入れる）
    const { error } = await sb.from("raids").insert([
      {
        group_id: matchedGroupId,
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
