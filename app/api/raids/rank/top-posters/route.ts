// app/api/raids/rank/top-posters/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  const n = Math.trunc(v);
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const group_id = (url.searchParams.get("group_id") ?? "").trim();
    const daysRaw = url.searchParams.get("days");
    const limitRaw = url.searchParams.get("limit");

    if (!group_id) {
      return NextResponse.json(
        { ok: false, error: "group_id is required" },
        { status: 400 }
      );
    }

    // UI想定: days=365 を「全期間」扱いにする（SQL側で p_days>=365 なら全期間にしている前提）
    const days = clampInt(daysRaw ? Number(daysRaw) : 7, 1, 365);
    const limit = clampInt(limitRaw ? Number(limitRaw) : 20, 1, 50);

    const { data, error } = await supabase.rpc("top_posters", {
      p_group_id: group_id,
      p_days: days,
      p_limit: limit,
    });

    if (error) {
      console.error("rpc top_posters error:", error);
      return NextResponse.json(
        { ok: false, error: error.message || "rpc error" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { ok: false, error: err?.message || "server error" },
      { status: 500 }
    );
  }
}
