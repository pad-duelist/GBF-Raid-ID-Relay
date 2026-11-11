import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REALTIME_CHANNEL_SECRET = Deno.env.get("REALTIME_CHANNEL_SECRET") ?? "";
const BOSS_BLOCKLIST_CSV_URL =
  Deno.env.get("BOSS_BLOCKLIST_CSV_URL") ?? Deno.env.get("NEXT_PUBLIC_BOSS_BLOCKLIST_CSV_URL") ?? "";
const BOSS_MAP_CSV_URL =
  Deno.env.get("BOSS_MAP_CSV_URL") ?? Deno.env.get("NEXT_PUBLIC_BOSS_NAME_MAP_CSV_URL") ?? "";
const BATTLE_MAPPING_CSV_URL =
  Deno.env.get("BATTLE_MAPPING_CSV_URL") ?? Deno.env.get("NEXT_PUBLIC_BATTLE_MAPPING_CSV_URL") ?? "";
const SERIES_MEMBER_MAX_CSV_URL = Deno.env.get("SERIES_MEMBER_MAX_CSV_URL") ?? "";
const USER_DAMAGE_CSV_URL = Deno.env.get("USER_DAMAGE_CSV_URL") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ===== HMAC channel name (Web Crypto API) =====
async function realtimeChannelNameForGroup(groupUuid: string): Promise<string> {
  if (!REALTIME_CHANNEL_SECRET) return `raids:${groupUuid}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(REALTIME_CHANNEL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(groupUuid));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
  return `raids:${groupUuid}:${hex}`;
}

// ===== Realtime broadcast =====
async function broadcastRaid(channelName: string, payload: unknown): Promise<void> {
  try {
    const url = `${SUPABASE_URL}/realtime/v1/api/broadcast`;
    const body = JSON.stringify({
      messages: [
        {
          topic: `realtime:${channelName}`,
          event: "broadcast",
          payload: { type: "broadcast", event: "raid", payload },
          private: false,
          ref: null,
          join_ref: null,
        },
      ],
    });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
      },
      body,
    });
    const text = await res.text();
    console.log(`[broadcast] channel=${channelName} status=${res.status} body=${text}`);
  } catch (e) {
    console.error("[realtime broadcast] failed:", e);
  }
}

// ===== JST ISO =====
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
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+09:00`;
}

// ===== Constants =====
const ULT_BAHAMUT_NAME = "Lv200 アルティメットバハムート";
const ULT_BAHAMUT_HP_THRESHOLD_DEFAULT = 70_000_000;

// ===== UUID check =====
function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

// ===== Group / membership resolution =====
async function resolveGroupUuidCandidates(groupIdParam: string): Promise<string[]> {
  const candidates = new Set<string>();
  if (isUuidLike(groupIdParam)) {
    candidates.add(groupIdParam);
    return Array.from(candidates);
  }
  for (const col of ["slug", "name", "group_name"]) {
    try {
      // deno-lint-ignore no-explicit-any
      const r = await (supabase as any).from("groups").select("id").eq(col, groupIdParam).limit(10);
      if (!r.error && r.data?.length) {
        for (const row of r.data) {
          const id = String(row?.id ?? "");
          if (id && isUuidLike(id)) candidates.add(id);
        }
      }
    } catch { /* ignore */ }
  }
  return Array.from(candidates);
}

async function findMembership(groupIdParam: string, userId: string) {
  const resolvedGroupIds = await resolveGroupUuidCandidates(groupIdParam);
  if (resolvedGroupIds.length === 0) {
    return { ok: false as const, statusCode: 404, reason: "group_not_found" };
  }
  for (const gid of resolvedGroupIds) {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase as any)
      .from("group_memberships")
      .select("id,status,group_id,user_id")
      .eq("group_id", gid)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { ok: false as const, statusCode: 500, reason: "membership_check_failed" };
    if (!data) continue;
    const status = (data?.status as string | null) ?? null;
    if (status && ["removed", "banned", "disabled", "inactive"].includes(status)) {
      return { ok: false as const, statusCode: 403, reason: "status_blocked" };
    }
    return { ok: true as const, matchedGroupId: gid };
  }
  return { ok: false as const, statusCode: 403, reason: "not_member" };
}

// ===== Boss name helpers =====
function normalizeBossName(name: string): string {
  return (name ?? "")
    .replace(/ /g, " ")
    .replace(/　/g, " ")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

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

// ===== Boss blocklist cache =====
let bossBlockList: Set<string> | null = null;
let lastBossBlockListFetched = 0;
const BOSS_BLOCKLIST_TTL = 5 * 60 * 1000;

async function loadBossBlockList(): Promise<Set<string>> {
  const now = Date.now();
  if (bossBlockList && now - lastBossBlockListFetched < BOSS_BLOCKLIST_TTL) return bossBlockList;
  if (!BOSS_BLOCKLIST_CSV_URL) {
    bossBlockList = new Set();
    lastBossBlockListFetched = now;
    return bossBlockList;
  }
  try {
    const res = await fetch(BOSS_BLOCKLIST_CSV_URL);
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    const set = new Set<string>();
    for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      const first = line.split(",")[0]?.trim();
      if (!first || first.toLowerCase() === "boss_name") continue;
      set.add(normalizeBossName(first));
    }
    bossBlockList = set;
    lastBossBlockListFetched = now;
    return set;
  } catch (e) {
    console.error("loadBossBlockList error:", e);
    if (bossBlockList) return bossBlockList;
    bossBlockList = new Set();
    lastBossBlockListFetched = now;
    return bossBlockList;
  }
}

async function isBossBlocked(name: string | null | undefined): Promise<boolean> {
  if (!name) return false;
  return (await loadBossBlockList()).has(normalizeBossName(name));
}

// ===== Boss name map cache =====
let bossMapCache: { map: Record<string, string>; sortedKeys: string[] } | null = null;
let lastBossMapFetched = 0;
const BOSS_MAP_TTL = 5 * 60 * 1000;

async function fetchBossNameMapCached(): Promise<{ map: Record<string, string>; sortedKeys: string[] }> {
  const now = Date.now();
  const empty = { map: {} as Record<string, string>, sortedKeys: [] as string[] };
  if (bossMapCache && now - lastBossMapFetched < BOSS_MAP_TTL) return bossMapCache;
  if (!BOSS_MAP_CSV_URL) { bossMapCache = empty; lastBossMapFetched = now; return empty; }
  try {
    const res = await fetch(BOSS_MAP_CSV_URL);
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const map: Record<string, string> = {};
    const header = lines[0]?.toLowerCase() ?? "";
    const start =
      header.includes("from") || header.includes("before") || header.includes("変換前") ? 1 : 0;
    for (let i = start; i < lines.length; i++) {
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
  const { map, sortedKeys } = await fetchBossNameMapCached();
  if (!sortedKeys.length) return raw;
  const key = normalizeKey(raw);
  if (map[key]) return map[key];
  for (const k of sortedKeys) {
    if (k && key.includes(k)) return map[k];
  }
  return raw;
}

// ===== Battle series map cache =====
let battleSeriesMapCache: Record<string, string> | null = null;
let lastBattleSeriesMapFetched = 0;
const BATTLE_SERIES_MAP_TTL = 5 * 60 * 1000;

async function fetchBattleSeriesMapCached(): Promise<Record<string, string>> {
  const now = Date.now();
  if (battleSeriesMapCache && now - lastBattleSeriesMapFetched < BATTLE_SERIES_MAP_TTL)
    return battleSeriesMapCache;
  if (!BATTLE_MAPPING_CSV_URL) {
    battleSeriesMapCache = {};
    lastBattleSeriesMapFetched = now;
    return {};
  }
  try {
    const res = await fetch(BATTLE_MAPPING_CSV_URL);
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) { battleSeriesMapCache = {}; lastBattleSeriesMapFetched = now; return {}; }
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const iBoss = header.indexOf("boss_name");
    const iSeries = header.indexOf("series");
    const map: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const boss = (cols[iBoss] ?? "").trim();
      const series = (cols[iSeries] ?? "").trim();
      if (!boss || !series) continue;
      map[normalizeKey(boss)] = series;
    }
    battleSeriesMapCache = map;
    lastBattleSeriesMapFetched = now;
    return map;
  } catch (e) {
    console.error("fetchBattleSeriesMapCached error:", e);
    battleSeriesMapCache = {};
    lastBattleSeriesMapFetched = now;
    return {};
  }
}

// ===== Series member max cache =====
let seriesMemberMaxCache: Record<string, number> | null = null;
let lastSeriesMemberMaxFetched = 0;
const SERIES_MEMBER_MAX_TTL = 5 * 60 * 1000;

async function fetchSeriesMemberMaxCached(): Promise<Record<string, number>> {
  const now = Date.now();
  if (seriesMemberMaxCache && now - lastSeriesMemberMaxFetched < SERIES_MEMBER_MAX_TTL)
    return seriesMemberMaxCache;
  if (!SERIES_MEMBER_MAX_CSV_URL) {
    seriesMemberMaxCache = {};
    lastSeriesMemberMaxFetched = now;
    return {};
  }
  try {
    const res = await fetch(SERIES_MEMBER_MAX_CSV_URL);
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) { seriesMemberMaxCache = {}; lastSeriesMemberMaxFetched = now; return {}; }
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const iSeries = header.indexOf("series");
    const iMax = header.indexOf("max");
    const map: Record<string, number> = {};
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const series = (cols[iSeries] ?? "").trim();
      const n = Number((cols[iMax] ?? "").trim());
      if (series && Number.isFinite(n)) map[series] = Math.trunc(n);
    }
    seriesMemberMaxCache = map;
    lastSeriesMemberMaxFetched = now;
    return map;
  } catch (e) {
    console.error("fetchSeriesMemberMaxCached error:", e);
    seriesMemberMaxCache = {};
    lastSeriesMemberMaxFetched = now;
    return {};
  }
}

// ===== User damage override cache =====
let userDamageCache: { at: number; map: Map<string, number> } | null = null;
const USER_DAMAGE_TTL = 60_000;

async function getUserDamageOverrideMap(): Promise<Map<string, number>> {
  const now = Date.now();
  if (userDamageCache && now - userDamageCache.at < USER_DAMAGE_TTL) return userDamageCache.map;
  const empty = new Map<string, number>();
  if (!USER_DAMAGE_CSV_URL) { userDamageCache = { at: now, map: empty }; return empty; }
  try {
    const res = await fetch(USER_DAMAGE_CSV_URL);
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) { userDamageCache = { at: now, map: empty }; return empty; }
    const header = lines[0].split(",").map((h) => h.trim());
    const iUserId = header.indexOf("user_id");
    const iDamage = header.indexOf("damage");
    const map = new Map<string, number>();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const userId = (cols[iUserId] ?? "").trim();
      const damage = Math.trunc(Number((cols[iDamage] ?? "").replace(/,/g, "").trim()));
      if (userId && Number.isFinite(damage) && damage > 0) map.set(userId, damage);
    }
    userDamageCache = { at: now, map };
    return map;
  } catch {
    userDamageCache = { at: now, map: empty };
    return empty;
  }
}

// ===== Member suppression =====
function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function shouldSuppressByMembers(cur: number, max: number): boolean {
  if (max === 6 && cur === 6) return true;
  if (max === 18 && cur >= 10) return true;
  if (max === 30 && cur >= 10) return true;
  return false;
}

// ===== Main handler =====
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";
    // deno-lint-ignore no-explicit-any
    let body: Record<string, any>;
    if (contentType.includes("application/json")) {
      body = await req.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      body = Object.fromEntries(formData.entries());
    } else {
      return json({ error: "Unsupported content type" }, 415);
    }

    const groupIdParam = (body.groupId ?? body.group_id) as string | undefined;
    const raidId = (body.raidId ?? body.raid_id) as string | undefined;
    let bossName = (body.bossName ?? body.boss_name ?? null) as string | null;
    let battleName = (body.battleName ?? body.battle_name ?? null) as string | null;
    const hpValue = body.hpValue ?? body.hp_value ?? null;
    const hpPercent = body.hpPercent ?? body.hp_percent ?? null;
    const userName = body.userName ?? body.user_name ?? null;
    const senderUserId = (body.senderUserId ?? body.sender_user_id) as string | undefined;
    const memberCurrent = body.memberCurrent ?? body.member_current ?? null;
    const memberMax = body.memberMax ?? body.member_max ?? null;
    const groupNameRaw = (body.groupName ?? body.group_name ?? null) as string | null;

    if (!groupIdParam || !raidId) {
      return json({ error: "groupId and raidId are required" }, 400);
    }
    if (!senderUserId) {
      return json({ error: "senderUserId is required" }, 401);
    }

    const mem = await findMembership(groupIdParam, senderUserId);
    if (!mem.ok) return json({ error: mem.reason }, mem.statusCode);

    const matchedGroupId = mem.matchedGroupId;
    const groupNameForRow =
      (groupNameRaw && String(groupNameRaw).trim().length > 0
        ? String(groupNameRaw).trim()
        : String(groupIdParam).trim()) || String(groupIdParam);

    bossName = await mapNormalize(bossName);
    battleName = await mapNormalize(battleName);

    if ((await isBossBlocked(bossName)) || (await isBossBlocked(battleName))) {
      return json({ ok: true, blocked: true });
    }

    const curNum = toIntOrNull(memberCurrent);
    const maxNum = toIntOrNull(memberMax);

    if (curNum !== null && maxNum !== null) {
      const battleSeriesMap = await fetchBattleSeriesMapCached();
      const seriesMaxMap = await fetchSeriesMemberMaxCached();
      const bossKey = bossName ? normalizeKey(bossName) : "";
      const battleKey = battleName ? normalizeKey(battleName) : "";
      const series =
        (bossKey && battleSeriesMap[bossKey]) || (battleKey && battleSeriesMap[battleKey]) || "";
      const overrideMax = series ? seriesMaxMap[series] : undefined;

      if (overrideMax && Number.isFinite(overrideMax)) {
        const omax = Math.trunc(Number(overrideMax));
        if (!(curNum >= 1 && curNum <= omax) || (omax === 6 && curNum === 6)) {
          return json({ ok: true, suppressed: true });
        }
      } else if (shouldSuppressByMembers(curNum, maxNum)) {
        return json({ ok: true, suppressed: true });
      }
    }

    const hpValueNum = hpValue == null ? null : Number(hpValue);
    const isUltBaha = bossName === ULT_BAHAMUT_NAME || battleName === ULT_BAHAMUT_NAME;
    let ultBahaThreshold = ULT_BAHAMUT_HP_THRESHOLD_DEFAULT;

    if (isUltBaha && senderUserId) {
      const override = (await getUserDamageOverrideMap()).get(senderUserId);
      if (override != null) ultBahaThreshold = override;
    }

    if (isUltBaha && hpValueNum != null && !Number.isNaN(hpValueNum) && hpValueNum <= ultBahaThreshold) {
      return json({ ok: true, suppressed: true });
    }

    // deno-lint-ignore no-explicit-any
    const { data: inserted, error } = await (supabase as any)
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
          "id", "group_id", "group_name", "raid_id",
          "boss_name", "battle_name", "hp_value", "hp_percent",
          "member_current", "member_max", "user_name", "created_at", "sender_user_id",
        ].join(",")
      )
      .single();

    if (error) {
      console.error("[post-raid] supabase error:", error);
      return json({ error: error.message }, 500);
    }

    const payload = { ...inserted, created_at: toJstIsoString(inserted?.created_at) };
    const channelName = await realtimeChannelNameForGroup(matchedGroupId);
    await broadcastRaid(channelName, payload);

    return json({ ok: true });
  } catch (e) {
    console.error("[post-raid] error:", e);
    return json({ error: "internal error" }, 500);
  }
});
