// app/api/raids/beacon/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

function jsonResponse(body: any, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function GET() {
  return jsonResponse({
    ok: true,
    message: "beacon endpoint (GET) alive",
    time: new Date().toISOString(),
    note: "Use POST (application/json) or form POST (data=JSON) to submit.",
  });
}

export async function POST(req: NextRequest) {
  try {
    // 1) ペイロード取得（JSON / form-data の両対応）
    const contentType = (req.headers.get("content-type") || "").toLowerCase();

    let payload: any = null;
    if (contentType.includes("application/json")) {
      payload = await req.json();
    } else {
      // フォーム送信 (application/x-www-form-urlencoded / multipart/form-data)
      try {
        const form = await req.formData();
        const data = form.get("data") as string | null;
        if (data) payload = JSON.parse(data);
      } catch (e) {
        // formData の解析に失敗した場合は null のまま
        console.warn("formData parse failed", e);
      }
    }

    console.log("beacon received payload:", payload);

    if (!payload || typeof payload !== "object") {
      return jsonResponse({ ok: false, error: "no-payload-or-invalid" }, 400);
    }

    // 2) 挿入用オブジェクトを用意（raw は必須で丸ごと入れる）
    const receivedAt = payload.sentAt ? new Date(payload.sentAt).toISOString() : new Date().toISOString();

    const row: any = {
      raw: payload, // jsonb カラムに丸ごと保存（存在することが前提）
      received_at: receivedAt,
      // 以下は存在すれば入れる。テーブルにカラムが無ければ supabase がエラーを返すが
      // raw 保存が優先できるように、INSERT を raw のみで実行するオプションも下に示します。
      group_id: payload.group_id ?? null,
      raid_id: payload.raid_id ?? null,
      boss_name: payload.boss_name ?? null,
      hp_value: payload.hp_value ?? null,
      hp_percent: payload.hp_percent ?? null,
      user_name: payload.user_name ?? null,
      sender_user_id: payload.sender_user_id ?? null,
      member_current: payload.member_current ?? null,
      member_max: payload.member_max ?? null,
      url: payload.url ?? null,
    };

    // 3) Supabase に挿入（まず raw のみで安全に試す）
    if (!supabase) {
      console.warn("Supabase not configured; skipping insert.");
      return jsonResponse({ ok: true, inserted: false, note: "supabase-not-configured" });
    }

    // ここではまず raw のみの挿入を試みる（テーブルに専用カラムがなくても動く）
    const { data: insertedRaw, error: errRaw } = await supabase
      .from("beacons")
      .insert([{ raw: payload, received_at: receivedAt }])
      .select()
      .limit(1);

    if (errRaw) {
      console.error("Supabase insert(raw-only) error:", errRaw);
      // もし raw-only が何らかの理由で失敗したら、fallback で全フィールド挿入を試す
      const { data: insertedFull, error: errFull } = await supabase
        .from("beacons")
        .insert([row])
        .select()
        .limit(1);

      if (errFull) {
        console.error("Supabase insert(full) error:", errFull);
        return jsonResponse({ ok: false, error: errFull.message }, 500);
      } else {
        return jsonResponse({ ok: true, inserted: true, row: insertedFull });
      }
    }

    return jsonResponse({ ok: true, inserted: true, row: insertedRaw });
  } catch (e: any) {
    console.error("beacon POST error:", e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}
