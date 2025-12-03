// app/api/raids/rank/top-battles/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const group_id = url.searchParams.get("group_id");
    const days = url.searchParams.get("days") ? Number(url.searchParams.get("days")) : 30;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 20;

    if (!group_id) return NextResponse.json({ error: "group_id is required" }, { status: 400 });

    const { data, error } = await supabase.rpc("top_battles", {
      p_group_id: group_id,
      p_days: days,
      p_limit: limit,
    });

    if (error) {
      console.error("rpc top_battles error:", error);
      return NextResponse.json({ error: error.message || "rpc error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || "server error" }, { status: 500 });
  }
}
