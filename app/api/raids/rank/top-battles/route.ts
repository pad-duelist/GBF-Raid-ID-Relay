// app/api/raids/rank/top-battles/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toInt(v: string | null, def: number) {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : def;
}

async function resolveGroupUuid(groupKey: string): Promise<{ group_id: string; group_name?: string } | null> {
  const key = (groupKey ?? "").trim();
  if (!key) return null;

  // 既にuuidならそのまま
  if (UUID_RE.test(key)) return { group_id: key };

  // group_name -> groups.id を解決
  const { data, error } = await supabase
    .from("groups")
    .select("id,name")
    .eq("name", key)
    .maybeSingle();

  if (error) {
    console.error("[top-battles] groups lookup error:", error);
    throw new Error(error.message);
  }
  if (!data?.id) return null;

  return { group_id: data.id, group_name: data.name ?? undefined };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    // 互換のためクエリ名は group_id のまま（中身は uuidでもnameでもOK）
    const groupKey = url.searchParams.get("group_id") ?? "";
    const days = toInt(url.searchParams.get("days"), 7);   // rankings/page.tsx に合わせて 7 をデフォルト
    const limit = Math.min(Math.max(toInt(url.searchParams.get("limit"), 10), 1), 50);

    if (!groupKey.trim()) {
      return NextResponse.json({ ok: false, error: "group_id is required" }, { status: 400 });
    }

    const resolved = await resolveGroupUuid(groupKey);
    if (!resolved) {
      return NextResponse.json(
        { ok: false, error: `group not found: ${groupKey}` },
        { status: 404 }
      );
    }

    const { data, error } = await supabase.rpc("top_battles", {
      p_group_id: resolved.group_id, // ★uuidで渡す
      p_days: days,
      p_limit: limit,
    });

    if (error) {
      console.error("[top-battles] rpc top_battles error:", error);
      return NextResponse.json({ ok: false, error: error.message || "rpc error" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      resolved_group_id: resolved.group_id,
      resolved_group_name: resolved.group_name ?? (UUID_RE.test(groupKey) ? undefined : groupKey),
      data: data ?? [],
    });
  } catch (err: any) {
    console.error("[top-battles] fatal:", err);
    return NextResponse.json({ ok: false, error: err.message || "server error" }, { status: 500 });
  }
}
