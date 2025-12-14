// app/api/groups/resolve/route.ts
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

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const key = (url.searchParams.get("key") ?? url.searchParams.get("groupId") ?? "").trim();

    if (!key) {
      return NextResponse.json({ ok: false, error: "key is required" }, { status: 400 });
    }

    const q = supabase.from("groups").select("id,name");

    const { data, error } = UUID_RE.test(key)
      ? await q.eq("id", key).maybeSingle()
      : await q.eq("name", key).maybeSingle();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data?.id) return NextResponse.json({ ok: false, error: "group not found" }, { status: 404 });

    return NextResponse.json({ ok: true, group: { id: data.id, name: data.name } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "server error" }, { status: 500 });
  }
}
