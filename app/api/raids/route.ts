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

// 通常: (現状の設定値) 以下は非表示（= これより上を表示）
const ULT_BAHAMUT_HP_THRESHOLD_DEFAULT = 65000000;

// 一部 sender_user_id のみ: 76,000,000 以下は非表示（= 76,000,000 より上を表示）
const ULT_BAHAMUT_HP_THRESHOLD_SPECIAL = 76000000;
const ULT_BAHAMUT_HP_THRESHOLD_SPECIAL_SENDER_IDS = new Set<string>([
  "461f0458-5494-47fc-b142-98e3eb389bdd",
  "86f9ace9-dad7-4daa-9c28-adb44759c252",
  "8cf84c8f-2052-47fb-a3a9-cf7f2980eef4",
]);

// ===== UUID判定 =====
function isUuidLike(s: string): boolean {
  if (!s) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

// ===== groupIdParam(name/uuid) -> UUID候補（複数） =====
async function resolveGroupUuidCandidates(groupIdParam: string): Promise<string[]> {
  const candidates = new Set<string>();

  // 既にUUIDならそれを使う
  if (isUuidLike(groupIdParam)) {
    candidates.add(groupIdParam);
    return Array.from(candidates);
  }

  // UUIDでない場合は groups テーブルから解決を試す（いまは id/name の想定）
  // ※ slug / group_name は存在しない環境でも try/catch で安全にスルー
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

// ===== 所属確認（groupIdParam(name/uuid)を受けて、membershipに一致したUUIDを1つ確定） =====
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
      console.error("[membership] query error:", error);
      return { ok: false, statusCode: 500, reason: "membership_query_error", resolvedGroupIds };
    }

    if (data) {
      // status が null/空でも「所属」として扱う運用ならここで通す
      return {
        ok: true,
        matchedGroupId: gid,
        status: (data as any)?.status ?? null,
      };
    }
  }

  return { ok: false, statusCode: 403, reason: "not_member", resolvedGroupIds };
}

// ===== group_id -> group_name 解決（簡易キャッシュ） =====
const groupNameCache = new Map<string, { name: string | null; ts: number }>();

async function getGroupNameCached(groupId: string): Promise<string | null> {
  const now = Date.now();
  const hit = groupNameCache.get(groupId);
  if (hit && now - hit.ts < 60_000) return hit.name;

  try {
    const { data, error } = await sb.from("groups").select("name").eq("id", groupId).maybeSingle();
    if (error) {
      console.warn("[getGroupNameCached] error:", error);
      groupNameCache.set(groupId, { name: null, ts: now });
      return null;
    }
    const name = data?.name ?? null;
    groupNameCache.set(groupId, { name, ts: now });
    return name;
  } catch (e) {
    console.warn("[getGroupNameCached] fatal:", e);
    groupNameCache.set(groupId, { name: null, ts: now });
    return null;
  }
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
    if (!res.ok) throw new Error(`failed to fetch blocklist csv: ${res.status}`);

    const csv = await res.text();
    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // 1列CSV想定（ヘッダあり/なし両対応）
    const set = new Set<string>();
    for (const line of lines) {
      const v = line.split(",")[0]?.trim();
      if (!v) continue;
      // ヘッダっぽいものは除外
      if (v === "boss_name" || v === "name") continue;
      set.add(normalizeBossName(v));
    }

    bossBlockList = set;
    lastBossBlockListFetched = now;
    return set;
  } catch (e) {
    console.error("[loadBossBlockList] error:", e);
    // 取得失敗時は空扱い
    bossBlockList = new Set();
    lastBossBlockListFetched = now;
    return bossBlockList;
  }
}

// ===== 参戦者数非表示ルール =====
function toIntOrNull(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * 非表示ルール（要望）
 * - 6/6 は非表示
 * - 10/18 以上は非表示
 * - 10/30 以上は非表示
 */
function shouldSuppressByMembers(memberCurrent: any, memberMax: any): boolean {
  const c = toIntOrNull(memberCurrent);
  const m = toIntOrNull(memberMax);
  if (c == null || m == null) return false;

  if (m === 6 && c === 6) return true;
  if (m === 18 && c >= 10) return true;
  if (m === 30 && c >= 10) return true;

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

  // 呼び出し元ユーザーID
  // - ブラウザ側は userId / excludeUserId のどちらでもOK
  // - 将来の拡張/デバッグ用にヘッダ(x-user-id)も許可
  const callerUserId =
    searchParams.get("userId") ||
    excludeUserId ||
    req.headers.get("x-user-id");

  if (!callerUserId) {
    return NextResponse.json(
      { error: "userId (or excludeUserId) is required" },
      { status: 401 }
    );
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

  // ★ group_name を groups(id)->name から解決（group_id -> group_name 変換）
  const resolvedGroupName = await getGroupNameCached(matchedGroupId);

  // 表示数（フィルタ後にこの件数へ丸める）
  const requestedLimit =
    limitParam == null || isNaN(Number(limitParam)) ? 50 : Math.max(1, Number(limitParam));

  // 取得数は多め（フィルタで落ちる分を見越す）
  const fetchLimit = Math.min(Math.max(requestedLimit * 3, requestedLimit), 300);

  try {
    let query = sb
      .from("raids")
      .select(
        [
          "id",
          "group_id",
          "group_name", // ←既存カラムも一応返す（ただし最終的に groups.name を優先）
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
      .limit(fetchLimit);

    if (bossNameParam) {
      const normalizedBossNameParam = normalizeBossName(bossNameParam);
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
      console.error("[GET /api/raids] query error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as any[];

    // 参戦者数ルールでフィルタ
    const filtered = rows.filter(
      (r) => !shouldSuppressByMembers((r as any)?.member_current, (r as any)?.member_max)
    );

    // ★ group_id -> group_name 変換結果をレスポンスに付与（groups.name を優先）
    const enriched = filtered.map((r) => ({
      ...r,
      group_name: resolvedGroupName ?? r.group_name ?? null,
    }));

    return NextResponse.json(enriched.slice(0, requestedLimit), { status: 200 });
  } catch (e) {
    console.error("[GET /api/raids] error:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// ===== POST: 1件登録 =====
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    let body: any = null;
    if (contentType.includes("application/json")) {
      body = await req.json();
    } else {
      return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
    }

    const groupIdParam = body.groupId ?? body.group_id;
    const raidId = body.raidId ?? body.raid_id;

    let bossName = body.bossName ?? body.boss_name;
    let battleName = body.battleName ?? body.battle_name;

    const hpValue = body.hpValue ?? body.hp_value;
    const hpPercent = body.hpPercent ?? body.hp_percent;

    const memberCurrent = body.memberCurrent ?? body.member_current;
    const memberMax = body.memberMax ?? body.member_max;

    const userName = body.userName ?? body.user_name;
    const senderUserId = body.senderUserId ?? body.sender_user_id;

    if (!groupIdParam || typeof groupIdParam !== "string") {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }
    if (!raidId || typeof raidId !== "string") {
      return NextResponse.json({ error: "raidId is required" }, { status: 400 });
    }
    if (!senderUserId || typeof senderUserId !== "string") {
      return NextResponse.json({ error: "sender_user_id is required" }, { status: 401 });
    }

    // ボス名のノーマライズ
    if (typeof bossName === "string") bossName = normalizeBossName(bossName);
    if (typeof battleName === "string") battleName = normalizeBossName(battleName);

    // ボス名ブロックリスト
    const blockSet = await loadBossBlockList();
    if (bossName && blockSet.has(normalizeBossName(bossName))) {
      return NextResponse.json({ ok: true, blocked: true }, { status: 200 });
    }
    if (battleName && blockSet.has(normalizeBossName(battleName))) {
      return NextResponse.json({ ok: true, blocked: true }, { status: 200 });
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

    // group_name を groups(id)->name から解決
    const resolvedGroupName = await getGroupNameCached(matchedGroupId);

    // ===== 特殊ボス: ULTバハのHP閾値 =====
    // 仕様:
    // - 7000万↑を表示、7000万以下を非表示…などの変更が入っている想定
    // ここは現ファイル内の既存ロジックを維持しつつ、sender_user_id 例外を適用
    const normalizedBoss = typeof bossName === "string" ? bossName : "";
    if (normalizedBoss === ULT_BAHAMUT_NAME) {
      const hp = hpValue == null ? null : Number(hpValue);
      if (hp != null && Number.isFinite(hp)) {
        const threshold = ULT_BAHAMUT_HP_THRESHOLD_SPECIAL_SENDER_IDS.has(senderUserId)
          ? ULT_BAHAMUT_HP_THRESHOLD_SPECIAL
          : ULT_BAHAMUT_HP_THRESHOLD_DEFAULT;

        // 「threshold 以下は非表示（= これより上を表示）」
        if (hp <= threshold) {
          return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
        }
      }
    }

    // 参戦者数ルール（POST時にも弾きたい場合）
    if (shouldSuppressByMembers(memberCurrent, memberMax)) {
      return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
    }

    // INSERT（group_id は matchedGroupId(UUID) を入れる）
    // ついでに group_name も保存（groups.name を参照）
    const { error } = await sb.from("raids").insert([
      {
        group_id: matchedGroupId,
        group_name: resolvedGroupName ?? null,
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
