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

type Json = Record<string, any>;

// 明示的に型注釈をつける（ここが問題になるため必ず付ける）
let supabase: ReturnType<typeof createClient> | null = null;
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
    const contentType = (req.headers.get("content-type") || "").toLowerCase();

    let payload: Json | null = null;
    if (contentType.includes("application/json")) {
      payload = (await req.json()) as Json;
    } else {
      try {
        const form = await req.formData();
        const data = form.get("data") as string | null;
        if (data) payload = JSON.parse(data) as Json;
      } catch (e) {
        console.warn("formData parse failed", e);
      }
    }

    console.log("beacon received payload:", payload);

    if (!payload || typeof payload !== "object") {
      return jsonResponse({ ok: false, error: "no-payload-or-invalid" }, 400);
    }

    const receivedAt = payload.sentAt ? new Date(String(payload.sentAt)).toISOString() : new Date().toISOString();

    if (!supabase) {
      console.warn("Supabase not configured; skipping insert.");
      return jsonResponse({ ok: true, inserted: false, note: "supabase-not-configured" });
    }

    const { data: insertedRaw, error: errRaw } = await supabase
      .from("beacons")
      .insert([{ raw: payload, received_at: receivedAt }])
      .select()
      .limit(1);

    if (errRaw) {
      console.error("Supabase insert(raw-only) error:", errRaw);
      const row: Record<string, any> = {
        raw: payload,
        received_at: receivedAt,
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
