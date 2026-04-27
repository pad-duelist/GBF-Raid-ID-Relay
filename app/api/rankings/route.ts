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

function parseIso(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const limit = toInt(searchParams.get("limit"), 10, 1, 100);
    const groupParam = (searchParams.get("groupId") ?? searchParams.get("group") ?? "").trim();

    const fromIso = parseIso(searchParams.get("from"));
    const toIso = parseIso(searchParams.get("to"));

    // from/to が未指定の場合は days パラメータで補完
    let resolvedFrom = fromIso;
    let resolvedTo = toIso;
    if (!resolvedFrom) {
      const days = toInt(searchParams.get("days"), 7, 1, 60);
      resolvedFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    }
    if (!resolvedTo) {
      resolvedTo = new Date().toISOString();
    }

    const { data: posters, error: e1 } = await supabase.rpc("get_poster_rankings_hist", {
      p_from_utc: resolvedFrom,
      p_to_utc: resolvedTo,
      p_group: groupParam || null,
      p_limit: limit,
    });
    if (e1) {
      return NextResponse.json(
        { error: "poster_rankings_failed", details: e1.message },
        { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const { data: battles, error: e2 } = await supabase.rpc("get_battle_rankings_hist", {
      p_from_utc: resolvedFrom,
      p_to_utc: resolvedTo,
      p_group: groupParam || null,
      p_limit: limit,
    });
    if (e2) {
      return NextResponse.json(
        { error: "battle_rankings_failed", details: e2.message },
        { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    return NextResponse.json(
      {
        limit,
        groupId: groupParam || "",
        from: resolvedFrom,
        to: resolvedTo,
        posters: posters ?? [],
        battles: battles ?? [],
        generated_at: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          Pragma: "no-cache",
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
