// app/api/raids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabaseServer";

type RaidRecord = {
  groupId: string;
  raidId: string;
  bossName?: string;
  battleName?: string;
  hpPercent?: number;
  hpValue?: number;
  userName?: string;
};

type ClientAndError = {
  client: ReturnType<typeof getSupabaseServer>; // SupabaseClient | null
  errorResponse: NextResponse | null;
};

// ===== CORS 設定 =====

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(res: NextResponse) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

function jsonWithCors(data: any, init?: ResponseInit) {
  return withCors(NextResponse.json(data, init));
}

// ===== Supabase クライアント取得 =====

function getClientOrErrorResponse(): ClientAndError {
  const client = getSupabaseServer();

  if (!client) {
    console.error("Supabase client is not configured.");
    const errorResponse = jsonWithCors(
      { error: "Supabase is not configured" },
      { status: 500 }
    );
    return { client: null, errorResponse };
  }

  return { client, errorResponse: null };
}

// ===== OPTIONS（プリフライト用） =====

export function OPTIONS() {
  // Body なし 204 + CORS ヘッダ
  return withCors(new NextResponse(null, { status: 204 }));
}

// ===== POST: 参戦ID登録（重複IDは無視） =====

export async function POST(req: NextRequest) {
  try {
    const { client, errorResponse } = getClientOrErrorResponse();
    if (!client) return errorResponse as NextResponse;

    const body = (await req.json()) as RaidRecord;

    const {
      groupId,
      raidId,
      bossName,
      battleName,
      hpPercent,
      hpValue,
      userName,
    } = body;

    if (!groupId || !raidId) {
      return jsonWithCors(
        { error: "groupId and raidId are required" },
        { status: 400 }
      );
    }

    const payload = {
      group_id: groupId,
      raid_id: raidId,
      boss_name: bossName ?? null,
      battle_name: battleName ?? null,
      hp_value:
        typeof hpValue === "number" && !Number.isNaN(hpValue)
          ? hpValue
          : null,
      hp_percent:
        typeof hpPercent === "number" && !Number.isNaN(hpPercent)
          ? hpPercent
          : null,
      user_name: userName ?? null,
    };

    const { error } = await client.from("raids").insert(payload);

    if (error) {
      // 23505 = unique 制約違反（(group_id, raid_id) が重複）
      if ((error as any).code === "23505") {
        console.log("Duplicate raid ignored", { groupId, raidId });
        return jsonWithCors({ ok: true, deduped: true });
      }

      console.error("Supabase insert error", error);
      return jsonWithCors({ error: "db error" }, { status: 500 });
    }

    return jsonWithCors({ ok: true });
  } catch (e) {
    console.error("POST /api/raids error", e);
    return jsonWithCors({ error: "invalid request" }, { status: 400 });
  }
}

// ===== GET: 参戦ID一覧取得 =====

export async function GET(req: NextRequest) {
  try {
    const { client, errorResponse } = getClientOrErrorResponse();
    if (!client) return errorResponse as NextResponse;

    const { searchParams } = new URL(req.url);
    const groupId = searchParams.get("groupId");
    const bossFilter = searchParams.get("bossName");
    const limit = Number(searchParams.get("limit") ?? "50");

    if (!groupId) {
      return jsonWithCors(
        { error: "groupId is required" },
        { status: 400 }
      );
    }

    let query = client
      .from("raids")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(Number.isNaN(limit) ? 50 : limit);

    if (bossFilter) {
      query = query.eq("battle_name", bossFilter);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Supabase select error", error);
      return jsonWithCors({ error: "db error" }, { status: 500 });
    }

    return jsonWithCors(data ?? []);
  } catch (e) {
    console.error("GET /api/raids error", e);
    return jsonWithCors(
      { error: "unexpected error" },
      { status: 500 }
    );
  }
}
