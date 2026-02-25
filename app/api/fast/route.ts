import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 許可する Origin（グラブル本体）
// 必要なら "https://game.granbluefantasy.jp" 以外もここに追加
const ALLOWED_ORIGINS = new Set([
  "https://game.granbluefantasy.jp",
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "";

  // credentials が "include" になるケースがあるため、ワイルドカード(*)は使わない
  // origin が許可されている時だけ明示して返す
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

type FastPayload = {
  group_key?: string;
  // 互換: raid_id にも battle_id にも対応
  raid_id?: string;
  battle_id?: string;
  monster?: string | null;
  sender_user_id?: string; // uuid string
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

  // ★参戦IDとして使うのは battle_id（8桁）想定。
  // ただし互換のため raid_id が来た場合も受ける。
  const idRaw = (body.battle_id ?? body.raid_id ?? "").trim();
  const monster = body.monster == null ? null : String(body.monster);
  const sender_user_id = (body.sender_user_id ?? "").trim();

  if (!idRaw) return jsonWithCors(req, { ok: false, error: "battle_id (or raid_id) is required" }, 400);
  if (!sender_user_id) return jsonWithCors(req, { ok: false, error: "sender_user_id is required" }, 400);

  // 参戦ID(battle_id)は通常 8 文字の16進っぽい
  // ただし念のため緩めに（実運用で弾きたいならここを厳格に）
  if (idRaw.length < 6 || idRaw.length > 16) {
    return jsonWithCors(req, { ok: false, error: "id looks invalid" }, 400);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return jsonWithCors(req, { ok: false, error: "Server misconfigured" }, 500);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  // テーブル定義は raids_fast（group_key, raid_id(unique), monster, sender_user_id）
  // ここではカラム名を raid_id に統一して保存（中身は battle_id を入れる）
  const { error } = await supabase
    .from("raids_fast")
    .upsert(
      [
        {
          group_key,
          raid_id: idRaw,
          monster,
          sender_user_id,
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
