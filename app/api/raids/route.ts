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

// ===== ボス名マップ（公開CSV）取得キャッシュ =====
const BOSS_MAP_CSV_URL = process.env.BOSS_MAP_CSV_URL ?? process.env.NEXT_PUBLIC_BOSS_MAP_CSV_URL;
let bossMapCache: { map: Record<string, string>; sortedKeys: string[] } | null = null;
let lastBossMapFetched = 0;
const BOSS_MAP_TTL = 5 * 60 * 1000; // 5分

// --- 文字列正規化（同期） ---
function toHalfwidthAndLower(s: string) {
  return s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
function removeCommonNoise(s: string) {
  let out = s.replace(/\(.*?\)|（.*?）/g, "");
  out = out.replace(/(no\.?\s?\d+|\#\d+|\d+番?)$/i, "");
  out = out.replace(/[\/:;「」『』"“”'’‘、。,・\-\—]/g, "");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}
function normalizeKey(raw: string) {
  return removeCommonNoise(toHalfwidthAndLower(raw || ""));
}

// --- CSV から作られた map を取得（キャッシュ付き） ---
async function fetchBossNameMapCached(force = false): Promise<{ map: Record<string, string>; sortedKeys: string[] }> {
  const now = Date.now();
  if (!force && bossMapCache && now - lastBossMapFetched < BOSS_MAP_TTL) {
    return bossMapCache;
  }

  const empty = { map: {} as Record<string, string>, sortedKeys: [] as string[] };
  if (!BOSS_MAP_CSV_URL) {
    bossMapCache = empty;
    lastBossMapFetched = now;
    return bossMapCache;
  }

  try {
    // no-store on force to ensure fresh
    const res = await fetch(BOSS_MAP_CSV_URL, force ? { cache: "no-store" } : undefined);
    if (!res.ok) {
      console.error("[boss map] CSV fetch failed", res.status, res.statusText);
      bossMapCache = empty;
      lastBossMapFetched = now;
      return bossMapCache;
    }
    const text = await res.text();
    // simple CSV parse: try header first (before,after)
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) {
      bossMapCache = empty;
      lastBossMapFetched = now;
      return bossMapCache;
    }
    // detect header columns
    const header = lines[0].split(",").map(h => h.trim().toLowerCase());
    const beforeIdx = header.indexOf("before");
    const afterIdx = header.indexOf("after");
    const map: Record<string, string> = {};
    if (beforeIdx !== -1 && afterIdx !== -1) {
      for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]);
        const before = (cols[beforeIdx] ?? "").trim();
        const after = (cols[afterIdx] ?? "").trim();
        if (before && after) {
          const key = normalizeKey(before);
          map[key] = after;
        }
      }
    } else {
      // fallback: assume two columns (before,after)
      for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]);
        const before = (cols[0] ?? "").trim();
        const after = (cols[1] ?? "").trim();
        if (before && after) {
          const key = normalizeKey(before);
          map[key] = after;
        }
      }
    }
    const sortedKeys = Object.keys(map).sort((a, b) => b.length - a.length);
    bossMapCache = { map, sortedKeys };
    lastBossMapFetched = now;
    return bossMapCache;
  } catch (e) {
    console.error("[boss map] fetch error", e);
    bossMapCache = empty;
    lastBossMapFetched = now;
    return bossMapCache;
  }
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQuote = !inQuote;
      continue;
    }
    if (ch === ',' && !inQuote) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// --- mapping を使った正規化（async） ---
async function mapNormalize(raw: string | null | undefined, forceFetch = false): Promise<string> {
  const s = raw ?? "";
  const key = normalizeKey(s);
  const { map } = await fetchBossNameMapCached(forceFetch);
  if (map && key in map) return map[key];
  return (s || "").trim();
}

// ===== 現行：normalizeBossName（従来のブロックリスト用） =====
// 既存のブロックリスト処理では単純 trim を行っているためここは維持
function normalizeBossNameForBlocklist(name: string): string {
  return name.trim();
}

async function loadBossBlockList(): Promise<Set<string>> {
  const now = Date.now();

  if (bossBlockList && now - lastBossBlockListFetched < BOSS_BLOCKLIST_TTL) {
    return bossBlockList;
  }

  const set = new Set<string>();

  if (!BOSS_BLOCKLIST_CSV_URL) {
    bossBlockList = set;
    lastBossBlockListFetched = now;
    return set;
  }

  try {
    const response = await fetch(BOSS_BLOCKLIST_CSV_URL);
    if (!response.ok) {
      console.error(
        "[boss blocklist] CSV fetch failed",
        response.status,
        response.statusText
      );
      bossBlockList = set;
      lastBossBlockListFetched = now;
      return set;
    }

    const text = await response.text();
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      set.add(normalizeBossNameForBlocklist(trimmed));
    }
  } catch (e) {
    console.error("[boss blocklist] 取得エラー", e);
  }

  bossBlockList = set;
  lastBossBlockListFetched = now;
  return set;
}

async function isBlockedBoss(
  bossName: string | null | undefined
): Promise<boolean> {
  if (!bossName) return false;
  const list = await loadBossBlockList();
  return list.has(normalizeBossNameForBlocklist(bossName));
}

function toNumberOrNull(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(v: any): number | null {
  const n = toNumberOrNull(v);
  if (n === null) return null;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// ===== 新規: 参戦者数抑制判定ユーティリティ =====
function shouldSuppressByMembers(
  memberCurrentRaw: any,
  memberMaxRaw: any
): boolean {
  const mc = toIntOrNull(memberCurrentRaw);
  const mm = toIntOrNull(memberMaxRaw);

  if (mc === null || mm === null) return false;

  // member_max が 6 のときは member_current が 6 の場合に流さない
  if (mm === 6 && mc === 6) return true;

  // member_max が 18 または 30 のときは member_current が 10 以上なら流さない
  if ((mm === 18 || mm === 30) && mc >= 10) return true;

  return false;
}

// ===== 新規: アルティメットバハムート（HP閾値）抑制判定 =====
// 非同期化：mapNormalize を使って代表名で判定する
async function isUltimateBahamutAndLowHP(raidLike: any): Promise<boolean> {
  if (!raidLike) return false;

  const bossCandidates = [
    raidLike.battle_name,
    raidLike.boss_name,
    raidLike.battleName,
    raidLike.bossName,
    raidLike.name,
  ];
  const rawName = bossCandidates.find(
    (v) => typeof v === "string" && v.trim().length > 0
  );
  if (!rawName) return false;

  const normalizedName = await mapNormalize(rawName);

  if (normalizedName !== ULT_BAHAMUT_NAME) return false;

  const hpCandidates = [
    raidLike.hp_value,
    raidLike.hpValue,
    raidLike.hp,
    raidLike.hpPercent,
  ];

  for (const h of hpCandidates) {
    const n = toNumberOrNull(h);
    if (n === null) continue;
    if (n <= ULT_BAHAMUT_HP_THRESHOLD) return true;
  }
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
      query = query.eq("boss_name", normalizedBossNameParam);
    }

    // excludeUserId の扱い（sender_user_id が NULL のレコードは表示）
    if (excludeUserId) {
      query = query.or(
        `sender_user_id.is.null,sender_user_id.neq.${excludeUserId}`
      );
    }

    const { data, error } = await query;

    if (error) {
      console.error("GET /api/raids error", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let rows: any[] = (data ?? []) as any[];

    // サーバー側で追加フィルタ：特定のボスかつ HP <= 閾値 のものを除外する
    // 非同期チェックを含むため filter を async-aware に実行
    const filteredRows: any[] = [];
    for (const r of rows) {
      try {
        if (await isUltimateBahamutAndLowHP(r)) {
          // 除外
          continue;
        }
      } catch (e) {
        console.error("filter isUltimateBahamutAndLowHP error", e, r);
      }
      filteredRows.push(r);
    }
    rows = filteredRows;

    return NextResponse.json(rows);
  } catch (e) {
    console.error("GET /api/raids unexpected error", e);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
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

    // ===== ここで bossName / battleName を統一名に変換してから扱う =====
    try {
      bossName = (await mapNormalize(bossName)) || (bossName ?? null);
      battleName = (await mapNormalize(battleName)) || (battleName ?? null);
    } catch (e) {
      console.error("mapNormalize error, falling back to raw", e);
      bossName = bossName ?? null;
      battleName = battleName ?? null;
    }

    // ===== ボスブロックリスト判定 =====
    const blocked = await isBlockedBoss(bossName);
    if (blocked) {
      console.log(
        "[POST /api/raids] blocked boss, skip insert",
        groupId,
        raidId,
        bossName
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

    // ===== 新規: アルティメットバハムートかつ HP が閾値以下なら挿入しない =====
    const potentialRaid = {
      boss_name: bossName ?? null,
      battle_name: battleName ?? null,
      hp_value: hpValue ?? null,
    };
    if (await isUltimateBahamutAndLowHP(potentialRaid)) {
      console.log(
        "[POST /api/raids] suppressed by ultimate bahamut HP threshold, skip insert",
        {
          groupId,
          raidId,
          boss_name: bossName,
          battle_name: battleName,
          hp_value: hpValue,
        }
      );
      return NextResponse.json(
        { ok: true, suppressedByHp: true },
        { status: 200 }
      );
    }

    // ===== 重複チェック（同じ group_id + raid_id が既にある場合はスキップ）=====
    const { data: existing, error: selectError } = await supabase
      .from("raids")
      .select("id")
      .eq("group_id", groupId)
      .eq("raid_id", raidId)
      .maybeSingle();

    if (selectError) {
      console.error("select existing error", selectError);
      return NextResponse.json({ error: selectError.message }, { status: 500 });
    }

    if (existing) {
      console.log("[POST /api/raids] duplicate raid id", { groupId, raidId });
      return NextResponse.json({ ok: true, duplicated: true }, { status: 200 });
    }

    const insertRow = {
      group_id: groupId,
      raid_id: raidId,
      boss_name: bossName ?? null,
      battle_name: battleName ?? null,
      hp_value: toNumberOrNull(hpValue),
      hp_percent: toNumberOrNull(hpPercent),
      member_current: toIntOrNull(memberCurrent),
      member_max: toIntOrNull(memberMax),
      user_name: userName ?? null,
      sender_user_id: senderUserId ?? null,
    };

    const { error: insertError } = await supabase.from("raids").insert(insertRow);

    if (insertError) {
      console.error("insert error", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    console.log("[POST /api/raids] inserted", {
      groupId,
      raidId,
      bossName,
      senderUserId,
      member_current: insertRow.member_current,
      member_max: insertRow.member_max,
      hp_value: insertRow.hp_value,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("POST /api/raids error", e);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
