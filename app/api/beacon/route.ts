// app/api/raids/beacon/route.ts
import { NextRequest, NextResponse } from "next/server";

type BeaconPayload = {
  raidId?: string;
  bossName?: string;
  hpPercent?: string;
  memberCurrent?: string | number;
  memberMax?: string | number;
  url?: string;
  sentAt?: string;
  // 拡張フィールドを許容
  [k: string]: any;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(body: any, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

async function tryInsertToSupabase(payload: BeaconPayload) {
  // Supabase に挿入するオプション機能。環境変数が揃っている場合のみ実行します。
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) return { ok: false, reason: "no-supabase-config" };

  // lazy import して runtime bundle を減らす
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const row = {
    raid_id: payload.raidId ?? null,
    boss_name: payload.bossName ?? null,
    hp_percent: payload.hpPercent ?? null,
    member_current: payload.memberCurrent ?? null,
    member_max: payload.memberMax ?? null,
    url: payload.url ?? null,
    received_at: new Date().toISOString(),
    raw: payload,
  };

  const { data, error } = await supabase.from("beacons").insert(row).select().limit(1);

  if (error) return { ok: false, reason: "supabase-insert-failed", error };
  return { ok: true, data };
}

function parseJsonSafe(text: string) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

export async function OPTIONS() {
  // プリフライトに対する応答
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get("data");
    if (!raw) {
      return jsonResponse({ ok: false, error: "no-data" }, 400);
    }

    let decoded: any;
    try {
      decoded = JSON.parse(decodeURIComponent(raw));
    } catch {
      // そのまま parse 試みる
      decoded = parseJsonSafe(raw);
    }

    if (!decoded || typeof decoded !== "object") {
      return jsonResponse({ ok: false, error: "invalid-json" }, 400);
    }

    const payload: BeaconPayload = decoded;

    // 最低限のバリデーション（長すぎるデータ拒否）
    const rawText = JSON.stringify(payload);
    if (rawText.length > 20000) {
      return jsonResponse({ ok: false, error: "payload-too-large" }, 413);
    }

    // ログ or DB
    console.log("[beacon GET] payload:", payload);

    const supabaseResult = await tryInsertToSupabase(payload);
    if (supabaseResult.ok) {
      return jsonResponse({ ok: true, inserted: true, row: supabaseResult.data });
    } else {
      return jsonResponse({ ok: true, inserted: false, reason: supabaseResult.reason });
    }
  } catch (err) {
    console.error("beacon GET error:", err);
    return jsonResponse({ ok: false, error: "server-error", detail: String(err) }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    // Content-Length チェック（任意）
    const contentLength = req.headers.get("content-length");
    if (contentLength && Number(contentLength) > 20000) {
      return jsonResponse({ ok: false, error: "payload-too-large" }, 413);
    }

    let body: any;
    try {
      body = await req.json();
    } catch (e) {
      // JSON でない場合はテキストとして受け取り、パースを試みる
      const text = await req.text();
      body = parseJsonSafe(text) ?? null;
    }

    if (!body || typeof body !== "object") {
      return jsonResponse({ ok: false, error: "invalid-json" }, 400);
    }

    const payload: BeaconPayload = body;

    // 簡易バリデーション
    if (!payload.raidId && !payload.url) {
      // どちらも無い場合は警告扱いにする（必須にするなら 400 を返す）
      console.warn("[beacon POST] missing raidId and url:", payload);
    }

    // ログ
    console.log("[beacon POST] payload:", payload);

    const supabaseResult = await tryInsertToSupabase(payload);
    if (supabaseResult.ok) {
      return jsonResponse({ ok: true, inserted: true, row: supabaseResult.data });
    } else {
      return jsonResponse({ ok: true, inserted: false, reason: supabaseResult.reason });
    }
  } catch (err) {
    console.error("beacon POST error:", err);
    return jsonResponse({ ok: false, error: "server-error", detail: String(err) }, 500);
  }
}
