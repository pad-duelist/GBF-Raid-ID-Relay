// app/api/profile/extension-token/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// ヘッダーから userId を取得（必須）
function getUserIdFromRequest(req: NextRequest): string | null {
  const headerUserId =
    req.headers.get("x-user-id") ?? req.headers.get("X-User-Id");
  if (headerUserId && headerUserId.trim().length > 0) {
    return headerUserId.trim();
  }
  return null;
}

// プロファイルを取得 or 作成して返す
async function getOrCreateProfile(userId: string) {
  // まず既存を取得
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, extension_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (error && (error as any).code !== "PGRST116") {
    console.error("[profiles] select error", error);
    throw new Error("プロフィール取得に失敗しました。");
  }

  if (data) {
    return data;
  }

  // なければ作成
  const insert = {
    user_id: userId,
    extension_token: null,
  };

  const { error: insertError } = await supabase
    .from("profiles")
    .insert(insert);

  if (insertError) {
    console.error("[profiles] insert error", insertError);
    throw new Error("プロフィール作成に失敗しました。");
  }

  return insert;
}

// GET: トークン取得（なければ発行）
export async function GET(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized (user id missing)" },
        { status: 401 }
      );
    }

    const profile = await getOrCreateProfile(userId);

    // まだトークンがない場合は発行
    let token = profile.extension_token as string | null;

    if (!token) {
      token = randomUUID();

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ extension_token: token })
        .eq("user_id", userId);

      if (updateError) {
        console.error("[profiles] update error (create token)", updateError);
        return NextResponse.json(
          { error: "トークンの作成に失敗しました。" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ extensionToken: token }, { status: 200 });
  } catch (e: any) {
    console.error("GET /api/profile/extension-token error", e);
    return NextResponse.json(
      { error: e.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}

// POST: トークン再発行
export async function POST(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized (user id missing)" },
        { status: 401 }
      );
    }

    // body は一応受けるが、今は rotate の有無に関わらず「再発行」として扱う
    const body = await req.json().catch(() => ({}));
    const rotate = body?.rotate ?? true;

    if (!rotate) {
      // rotate=false で呼ぶことはほぼ無い想定。将来拡張用。
    }

    // プロファイルが無ければ作成
    await getOrCreateProfile(userId);

    // 新しいトークンを発行
    const newToken = randomUUID();

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ extension_token: newToken })
      .eq("user_id", userId);

    if (updateError) {
      console.error("[profiles] update error (rotate token)", updateError);
      return NextResponse.json(
        { error: "トークンの再発行に失敗しました。" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { extensionToken: newToken },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("POST /api/profile/extension-token error", e);
    return NextResponse.json(
      { error: e.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
