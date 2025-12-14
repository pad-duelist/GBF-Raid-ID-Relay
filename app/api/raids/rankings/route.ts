// app/api/raids/rankings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

async function resolveGroupId(groupKey: string): Promise<string | null> {
  const key = groupKey.trim();
  if (!key) return null;

  // 1) uuidっぽいなら groups.id を優先
  if (isUuidLike(key)) {
    const { data, error } = await supabase.from("groups").select("id").eq("id", key).maybeSingle();
    if (!error && data?.id) return data.id;
  }

  // 2) name で検索
  {
    const { data, error } = await supabase.from("groups").select("id").eq("name", key).maybeSingle();
    if (!error && data?.id) return data.id;
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const groupKey =
      searchParams.get("groupId") ??
      searchParams.get("group") ??
      searchParams.get("group_name") ??
      searchParams.get("group_id") ??
      "";

    const days = Math.max(1, Number(searchParams.get("days") ?? 7));
    const limit = Math.max(1, Number(searchParams.get("limit") ?? 10));

    if (!groupKey.trim()) {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }

    const groupId = await resolveGroupId(groupKey);
    if (!groupId) {
      return NextResponse.json({ error: `group not found: ${groupKey}` }, { status: 404 });
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // ポスターは「統合後」にlimitを切りたいので少し多めに取る
    const posterLimit = Math.min(Math.max(limit * 5, 50), 500);

    // ---- 投稿者ランキング（count + max(created_at)） ----
    const { data: posterRows, error: posterErr } = await supabase
      .from("raids")
      .select("sender_user_id,user_name,post_count:count(),last_posted_at:max(created_at)")
      .eq("group_id", groupId)
      .gte("created_at", since)
      .order("post_count", { ascending: false })
      .limit(posterLimit);

    if (posterErr) {
      return NextResponse.json({ error: posterErr.message }, { status: 500 });
    }

    // ---- バトルランキング（battle_name空ならboss_name、さらに空なら(unknown)） ----
    const { data: battleRows, error: battleErr } = await supabase
      .from("raids")
      .select("battle_name,boss_name,post_count:count()")
      .eq("group_id", groupId)
      .gte("created_at", since)
      .order("post_count", { ascending: false })
      .limit(1000);

    if (battleErr) {
      return NextResponse.json({ error: battleErr.message }, { status: 500 });
    }

    // JS側で表示名に正規化して再集計（battle_name空/null対策）
    const battleMap = new Map<string, number>();
    for (const r of battleRows ?? []) {
      const bn = (r as any)?.battle_name?.trim?.() ? (r as any).battle_name.trim() : "";
      const boss = (r as any)?.boss_name?.trim?.() ? (r as any).boss_name.trim() : "";
      const name = bn || boss || "(unknown)";
      const c = Number((r as any)?.post_count ?? 0);
      battleMap.set(name, (battleMap.get(name) ?? 0) + (Number.isFinite(c) ? c : 0));
    }

    const battles = Array.from(battleMap.entries())
      .map(([battle_name, post_count]) => ({ battle_name, post_count }))
      .sort((a, b) => b.post_count - a.post_count)
      .slice(0, limit);

    return NextResponse.json({
      group_id: groupId,
      group_key: groupKey,
      days,
      limit,
      posters: posterRows ?? [],
      battles,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
