// app/api/rankings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

function toInt(v: string | null, def: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const days = toInt(searchParams.get("days"), 7, 1, 60);
    const limit = toInt(searchParams.get("limit"), 10, 1, 100);
    const groupParam = (searchParams.get("groupId") ?? searchParams.get("group") ?? "").trim();

    const { data: posters, error: e1 } = await supabase.rpc("get_poster_rankings", {
      p_days: days,
      p_limit: limit,
      p_group: groupParam || null,
    });
    if (e1) {
      return NextResponse.json(
        { error: "poster_rankings_failed", details: e1.message },
        { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const { data: battles, error: e2 } = await supabase.rpc("get_battle_rankings", {
      p_days: days,
      p_limit: limit,
      p_group: groupParam || null,
    });
    if (e2) {
      return NextResponse.json(
        { error: "battle_rankings_failed", details: e2.message },
        { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    return NextResponse.json(
      {
        days,
        limit,
        groupId: groupParam || "",
        posters: posters ?? [],
        battles: battles ?? [],
        generated_at: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Pragma": "no-cache",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: "unexpected", details: err?.message ?? String(err) },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
