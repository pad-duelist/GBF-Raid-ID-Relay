import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =========================
// CORS
// =========================
const ALLOWED_ORIGINS = new Set([
  "https://game.granbluefantasy.jp",
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "";

  // credentials が include になるケースがあるため "*" は使わない
  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonWithCors(req: Request, body: any, status: number) {
  return NextResponse.json(body, { status, headers: corsHeaders(req) });
}

// =========================
// Boss blocklist (同等実装を raids/route.ts から移植)
// =========================
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
    console.error("[fast] loadBossBlockList error:", e);
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

// =========================
// Boss name mapping (任意だが raids と同じ挙動に寄せる)
// =========================
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

async function fetchBossNameMapCached(force = false): Promise<{ map: Record<string, string>; sortedKeys: string[] }> {
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
    const startIndex = header.includes("from") || header.includes("before") || header.includes("変換前") ? 1 : 0;

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
    console.error("[fast] fetchBossNameMapCached error:", e);
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

// =========================
// API
// =========================
type FastPayload = {
  group_key?: string;
  raid_id?: string;    // 互換
  battle_id?: string;  // 推奨
  monster?: string | null;
  sender_user_id?: string; // uuid string

  // 将来拡張（必要なら）
  enemy_id?: string;
  image_url?: string;
};

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  let body: FastPayload;
  try {
    body = await req.json();
  } catch {
    return jsonWithCors(req, { ok: false, error: "Invalid JSON" }, 400);
  }

  const group_key = (body.group_key ?? "").trim() || "duo";
  const idRaw = (body.battle_id ?? body.raid_id ?? "").trim();
  const sender_user_id = (body.sender_user_id ?? "").trim();
  const monsterRaw = body.monster == null ? null : String(body.monster);

  if (!idRaw) return jsonWithCors(req, { ok: false, error: "battle_id (or raid_id) is required" }, 400);
  if (!sender_user_id) return jsonWithCors(req, { ok: false, error: "sender_user_id is required" }, 400);

  // ===== ブロック判定（raids/route.ts と同じ：マッピング後にチェック） =====
  const monster = await mapNormalize(monsterRaw);
  const blocked = await isBossBlocked(monster);

  if (blocked) {
    // 保存せず成功扱い（raids と同等）
    return jsonWithCors(req, { ok: true, blocked: true }, 200);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return jsonWithCors(req, { ok: false, error: "Server misconfigured" }, 500);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // raids_fast: group_key, raid_id(unique), monster, sender_user_id, created_at, (optional) enemy_id/image_url
  const { error } = await supabase
    .from("raids_fast")
    .upsert(
      [
        {
          group_key,
          raid_id: idRaw, // 中身は battle_id
          monster,
          sender_user_id,
          enemy_id: body.enemy_id ?? null,
          image_url: body.image_url ?? null,
        },
      ],
      { onConflict: "group_key,raid_id", ignoreDuplicates: true }
    );

  if (error) {
    console.error("[api/fast] upsert error", error);
    return jsonWithCors(req, { ok: false }, 500);
  }

  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
