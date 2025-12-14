// app/api/raids/rank/top-posters/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

function toInt(v: string | null, def: number) {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : def;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const groupId = searchParams.get("group_id") ?? "";
    const days = toInt(searchParams.get("days"), 7);
    const limit = Math.min(Math.max(toInt(searchParams.get("limit"), 10), 1), 50);

    if (!groupId) {
      return NextResponse.json({ ok: false, error: "group_id is required" }, { status: 400 });
    }

    // 「統合で順位が繰り上がる」取りこぼし防止に、少し多めに取得しておくのが安全
    const fetchLimit = Math.min(Math.max(limit * 5, limit), 50);

    const { data, error } = await supabase.rpc("get_top_posters_merged", {
      p_group_id: groupId,
      p_days: days,
      p_limit: fetchLimit,
    });

    if (error) {
      console.error("[top-posters] rpc error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // API側ですでに統合＆並び替え済み。念のためlimitで切る。
    const out = (data ?? []).slice(0, limit);

    return NextResponse.json({ ok: true, data: out });
  } catch (e) {
    console.error("[top-posters] fatal:", e);
    return NextResponse.json({ ok: false, error: "internal error" }, { status: 500 });
  }
}
