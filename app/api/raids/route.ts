// app/api/raids/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(req: NextRequest) {
  try {
    if (!supabaseServer) {
      console.error("supabaseServer is not configured");
      return NextResponse.json(
        { error: "Supabase is not configured" },
        { status: 500 }
      );
    }

    const body = await req.json();

    const {
      groupId,
      raidId,
      bossName,
      battleName,
      hpPercent,
      hpValue,
      userName,
    }: {
      groupId: string;
      raidId: string;
      bossName?: string;
      battleName?: string;
      hpPercent?: number;
      hpValue?: number;
      userName?: string;
    } = body;

    if (!groupId || !raidId) {
      return NextResponse.json(
        { error: "groupId and raidId are required" },
        { status: 400 }
      );
    }

    const { error } = await supabaseServer
      .from("raids")
      .insert({
        group_id: groupId,
        raid_id: raidId,
        boss_name: bossName ?? null,
        battle_name: battleName ?? null,
        hp_value: typeof hpValue === "number" ? hpValue : null,
        hp_percent: typeof hpPercent === "number" ? hpPercent : null,
        user_name: userName ?? null,
      });

    if (error) {
      console.error("Supabase insert error", error);
      return NextResponse.json({ error: "db error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  if (!supabaseServer) {
    console.error("supabaseServer is not configured");
    return NextResponse.json(
      { error: "Supabase is not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("groupId");
  const bossFilter = searchParams.get("bossName");
  const limit = Number(searchParams.get("limit") ?? "50");

  if (!groupId) {
    return NextResponse.json(
      { error: "groupId is required" },
      { status: 400 }
    );
  }

  let query = supabaseServer
    .from("raids")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (bossFilter) {
    query = query.eq("battle_name", bossFilter);
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
