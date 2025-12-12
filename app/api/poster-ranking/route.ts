// app/api/poster-ranking/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") ?? 100);

    const { data, error } = await supabase
      .from("poster_ranking_by_user")
      .select("user_id,user_id_text,last_used_name,post_count,last_post_at")
      .order("post_count", { ascending: false })
      .order("last_post_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
