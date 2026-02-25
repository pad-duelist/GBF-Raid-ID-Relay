import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs"; // Edgeだと環境変数周りで詰むことがあるのでnode推奨
export const dynamic = "force-dynamic";

type FastPayload = {
  group_key?: string;
  raid_id?: string;
  monster?: string | null;
  sender_user_id?: string; // uuid string
};

function badRequest(msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status: 400 });
}

export async function POST(req: Request) {
  let body: FastPayload;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const group_key = (body.group_key ?? "").trim() || "duo";
  const raid_id = (body.raid_id ?? "").trim();
  const monster = body.monster == null ? null : String(body.monster);
  const sender_user_id = (body.sender_user_id ?? "").trim();

  // 必須チェック（fastはここだけ固くする）
  if (!raid_id) return badRequest("raid_id is required");
  if (!sender_user_id) return badRequest("sender_user_id is required");

  // 超軽量バリデーション（数字10桁想定だが、念のため緩め）
  if (raid_id.length < 8 || raid_id.length > 12) {
    return badRequest("raid_id looks invalid");
  }

  // service_role で insert/upsert（RLSの影響を受けない）
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 }
    );
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { error } = await supabase
    .from("raids_fast")
    .upsert(
      [
        {
          group_key,
          raid_id,
          monster,
          sender_user_id,
        },
      ],
      { onConflict: "group_key,raid_id", ignoreDuplicates: true }
    );

  // unique衝突でもOK扱いで204返す（速度優先でレスポンスを軽く）
  if (error) {
    // ただしDB接続系のエラーはログだけ出して500
    console.error("[api/fast] insert error", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}