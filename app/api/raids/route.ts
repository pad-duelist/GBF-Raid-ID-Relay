// app/api/raids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserDamageOverrideMap } from "@/lib/userDamageOverrides";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});
const sb: any = supabase; // ★ビルドの型深掘り回避

// ===== Realtime broadcast 用チャンネル名（推測されにくいように secret で署名） =====
const REALTIME_CHANNEL_SECRET = process.env.REALTIME_CHANNEL_SECRET || "";

function realtimeChannelNameForGroup(groupUuid: string): string {
  if (!REALTIME_CHANNEL_SECRET) return `raids:${groupUuid}`;

  const sig = crypto
    .createHmac("sha256", REALTIME_CHANNEL_SECRET)
    .update(groupUuid)
    .digest("hex")
    .slice(0, 16);

  return `raids:${groupUuid}:${sig}`;
}

async function broadcastRaid(channelName: string, payload: any) {
  try {
    const ch = sb.channel(channelName);

    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 1200);
      ch.subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(t);
          resolve();
        }
      });
    });

    await ch.send({
      type: "broadcast",
      event: "raid",
      payload,
    });

    await sb.removeChannel(ch);
  } catch (e) {
    console.error("[realtime broadcast] failed:", e);
  }
}

// ===== created_at を日本時間(JST)のISO(+09:00)に差し替える（返却・配信用） =====
function toJstIsoString(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const yyyy = get("year");
  const mm = get("month");
  const dd = get("day");
  const hh = get("hour");
  const mi = get("minute");
  const ss = get("second");

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+09:00`;
}

// ===== 定数: 特殊ボスの判定 =====
const ULT_BAHAMUT_NAME = "Lv200 アルティメットバハムート";
const ULT_BAHAMUT_HP_THRESHOLD_DEFAULT = 70000000;

// ===== groupId 解決（Apoklisi -> UUID） =====
function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

async function resolveGroupUuidCandidates(groupIdParam: string): Promise<string[]> {
  const candidates = new Set<string>();

  if (isUuidLike(groupIdParam)) {
    candidates.add(groupIdParam);
    return Array.from(candidates);
  }

  try {
    const r = await sb.from("groups").select("id").eq("slug", groupIdParam).limit(10);
    if (!r.error && r.data?.length) {
      for (const row of r.data) {
        const id = String(row?.id ?? "");
        if (id && isUuidLike(id)) candidates.add(id);
      }
    }
  } catch {}

  try {
    const r = await sb.from("groups").select("id").eq("name", groupIdParam).limit(10);
    if (!r.error && r.data?.length) {
      for (const row of r.data) {
        const id = String(row?.id ?? "");
        if (id && isUuidLike(id)) candidates.add(id);
      }
    }
  } catch {}

  try {
    const r = await sb.from("groups").select("id").eq("group_name", groupIdParam).limit(10);
    if (!r.error && r.data?.length) {
      for (const row of r.data) {
        const id = String(row?.id ?? "");
        if (id && isUuidLike(id)) candidates.add(id);
      }
    }
  } catch {}

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
const BOSS_BLOCKLIST_TTL = 5 * 60 * 1000;

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
  process.env.BOSS_MAP_CSV_URL ?? process.env.NEXT_PUBLIC_BOSS_NAME_MAP_CSV_URL;

let bossMapCache: { map: Record<string, string>; sortedKeys: string[] } | null = null;
let lastBossMapFetched = 0;
const BOSS_MAP_TTL = 5 * 60 * 1000;

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

// ===== 参戦者数抑制 =====
function toIntOrNull(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function shouldSuppressByMembers(memberCurrent: any, memberMax: any): boolean {
  const cur = toIntOrNull(memberCurrent);
  const max = toIntOrNull(memberMax);
  if (cur === null || max === null) return false;

  if (max === 6 && cur === 6) return true;
  if (max === 18 && cur >= 10) return true;
  if (max === 30 && cur >= 10) return true;
  return false;
}

// ===== GET =====
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const groupIdParam = searchParams.get("groupId");
  const bossNameParam = searchParams.get("bossName");
  const limitParam = searchParams.get("limit");
  const excludeUserId = searchParams.get("excludeUserId");
  const mode = searchParams.get("mode"); // mode=channel

  if (!groupIdParam) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  const callerUserId = searchParams.get("userId") || excludeUserId;
  if (!callerUserId) {
    return NextResponse.json({ error: "userId is required" }, { status: 401 });
  }

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

  // チャンネル名のみ返す
  if (mode === "channel") {
    const channel = realtimeChannelNameForGroup(matchedGroupId);
    return NextResponse.json({ channel, matchedGroupId }, { status: 200 });
  }

  try {
    let query = sb
      .from("raids")
      .select(
        [
          "id",
          "group_id",
          "group_name",
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
      .order("id", { ascending: false })
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

    const filtered = (data ?? []).filter(
      (r: any) => !shouldSuppressByMembers(r?.member_current, r?.member_max)
    );

    const rows = filtered.map((r: any) => ({
      ...r,
      created_at: toJstIsoString(r?.created_at),
    }));

    return NextResponse.json(rows, { status: 200 });
  } catch (e) {
    console.error("[GET /api/raids] error:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// ===== POST =====
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

    // 送信仕様が固定：boss_name が基本、battle_name は来ないなら NULL のまま
    let bossName = body.bossName ?? body.boss_name;
    let battleName = body.battleName ?? body.battle_name;

    const hpValue = body.hpValue ?? body.hp_value;
    const hpPercent = body.hpPercent ?? body.hp_percent;

    const userName = body.userName ?? body.user_name;
    const senderUserId = body.senderUserId ?? body.sender_user_id;

    const memberCurrent = body.memberCurrent ?? body.member_current ?? null;
    const memberMax = body.memberMax ?? body.member_max ?? null;

    // group_name は「送られてくる値をそのまま使う」方針（無ければフォールバック）
    const groupNameRaw = body.groupName ?? body.group_name ?? null;

    if (!groupIdParam || !raidId) {
      return NextResponse.json({ error: "groupId and raidId are required" }, { status: 400 });
    }
    if (!senderUserId) {
      return NextResponse.json({ error: "senderUserId is required" }, { status: 401 });
    }

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

    // ★group_name の保存値（固定仕様に合わせ、サーバー側で勝手に変えない）
    const groupNameForRow =
      (groupNameRaw && String(groupNameRaw).trim().length > 0
        ? String(groupNameRaw).trim()
        : String(groupIdParam).trim()) || String(groupIdParam);

    // ボス名マッピング（必要なら）
    bossName = await mapNormalize(bossName);
    battleName = await mapNormalize(battleName);

    // ブロック判定
    const bossBlocked = await isBossBlocked(bossName);
    const battleBlocked = await isBossBlocked(battleName);
    if (bossBlocked || battleBlocked) {
      return NextResponse.json({ ok: true, blocked: true }, { status: 200 });
    }

    // 参戦者数抑制
    if (shouldSuppressByMembers(memberCurrent, memberMax)) {
      return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
    }

    // アルバハ200のHP抑制（user_idごとにスプシで上書き可）
const hpValueNum = hpValue == null ? null : Number(hpValue);
const isUltBaha = bossName === ULT_BAHAMUT_NAME || battleName === ULT_BAHAMUT_NAME;

// ★送信者IDの変数名はあなたのroute.tsに合わせてください（例：sender_user_id）
const senderId = typeof sender_user_id === "string" ? sender_user_id : null;

let ultBahaThreshold = ULT_BAHAMUT_HP_THRESHOLD_DEFAULT;

if (isUltBaha && senderId) {
  const damageOverrides = await getUserDamageOverrideMap();
  const override = damageOverrides.get(senderId);
  if (override != null) ultBahaThreshold = override;
}

if (
  isUltBaha &&
  hpValueNum != null &&
  !Number.isNaN(hpValueNum) &&
  hpValueNum <= ultBahaThreshold
) {
  return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
}

    // ★重要：canonical_boss_name は「書かない」方針（NULLのまま運用）
    const { data: inserted, error } = await sb
      .from("raids")
      .insert([
        {
          group_id: matchedGroupId,
          group_name: groupNameForRow,
          raid_id: raidId,

          boss_name: bossName ?? null,
          battle_name: battleName ?? null,

          hp_value: hpValue == null ? null : Number(hpValue),
          hp_percent: hpPercent == null ? null : Number(hpPercent),

          member_current: memberCurrent == null ? null : Number(memberCurrent),
          member_max: memberMax == null ? null : Number(memberMax),

          user_name: userName ?? null,
          sender_user_id: senderUserId,
        },
      ])
      .select(
        [
          "id",
          "group_id",
          "group_name",
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
      .single();

    if (error) {
      console.error("[POST /api/raids] supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const payload = {
      ...inserted,
      created_at: toJstIsoString((inserted as any)?.created_at),
    };

    const channelName = realtimeChannelNameForGroup(matchedGroupId);
    await broadcastRaid(channelName, payload);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("[POST /api/raids] error:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
