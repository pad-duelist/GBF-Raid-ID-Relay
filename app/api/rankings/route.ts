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

const looksLikeUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// JSTの「朝5:00区切り」で、days日分の集計レンジ(UTC)を作る
function getJst5amWindowUtc(days: number, now = new Date()) {
  const JST = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + JST);

  const y = jstNow.getUTCFullYear();
  const m = jstNow.getUTCMonth();
  const d = jstNow.getUTCDate();
  const h = jstNow.getUTCHours();

  // JSTで「今日05:00」未満なら、起点は「昨日05:00」
  const baseDay = h < 5 ? d - 1 : d;

  // JST 05:00 をUTCに直す（JST-9h）
  const startUtc = new Date(Date.UTC(y, m, baseDay, 5, 0, 0) - JST);
  const endUtc = new Date(startUtc.getTime() + days * 24 * 60 * 60 * 1000);
  return { startUtc, endUtc };
}

function formatJst(dateUtc: Date) {
  const JST = 9 * 60 * 60 * 1000;
  const j = new Date(dateUtc.getTime() + JST);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}/${pad(j.getUTCMonth() + 1)}/${pad(j.getUTCDate())} ${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}`;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const days = toInt(searchParams.get("days"), 7, 1, 60);
    const limit = toInt(searchParams.get("limit"), 10, 1, 100);
    const groupParamRaw = (searchParams.get("groupId") ?? searchParams.get("group") ?? "").trim();

    if (!groupParamRaw) {
      return NextResponse.json(
        { error: "missing_group", details: "groupId(or group) is required" },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    // 集計期間（表示用）
    const { startUtc, endUtc } = getJst5amWindowUtc(days);
    const window = {
      start_utc: startUtc.toISOString(),
      end_utc: endUtc.toISOString(), // 排他(< end)の想定
      start_jst: formatJst(startUtc),
      end_jst_inclusive: formatJst(new Date(endUtc.getTime() - 1)),
      label: `${formatJst(startUtc)} ～ ${formatJst(new Date(endUtc.getTime() - 1))}`,
    };

    // groupId: UUID or name をUUID文字列に解決（top_posters/top_battles は p_group_id text）
    let groupIdText = groupParamRaw;

    if (!looksLikeUuid(groupParamRaw)) {
      const { data: g, error: ge } = await supabase
        .from("groups")
        .select("id")
        .eq("name", groupParamRaw)
        .maybeSingle();

      if (ge) {
        return NextResponse.json(
          { error: "group_lookup_failed", details: ge.message },
          { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
        );
      }
      if (!g?.id) {
        return NextResponse.json(
          { error: "group_not_found", details: `group not found: ${groupParamRaw}` },
          { status: 404, headers: { "Cache-Control": "no-store, max-age=0" } }
        );
      }
      groupIdText = String(g.id);
    }

    // DB側関数(top_posters/top_battles)が朝5時区切りで集計する前提
    const { data: posters, error: e1 } = await supabase.rpc("top_posters", {
      p_group_id: groupIdText,
      p_days: days,
      p_limit: limit,
    });
    if (e1) {
      return NextResponse.json(
        { error: "poster_rankings_failed", details: e1.message },
        { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const { data: battles, error: e2 } = await supabase.rpc("top_battles", {
      p_group_id: groupIdText,
      p_days: days,
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
        days,
        limit,
        groupId: groupIdText,
        posters: posters ?? [],
        battles: battles ?? [],
        window, // ★追加：集計期間
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
