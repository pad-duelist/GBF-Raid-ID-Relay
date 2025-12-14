// app/api/group-access/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

export async function GET(req: NextRequest) {
  const groupId = req.nextUrl.searchParams.get("groupId") ?? "";
  const userId = req.nextUrl.searchParams.get("userId") ?? "";

  if (!groupId || !userId) {
    return NextResponse.json({ allowed: false, reason: "missing_params" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("group_memberships")
    .select("id,status")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ allowed: false, reason: "db_error" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ allowed: false, reason: "not_member" }, { status: 403 });
  }

  const status = (data as any)?.status as string | null | undefined;
  if (status && ["removed", "banned", "disabled", "inactive"].includes(status)) {
    return NextResponse.json({ allowed: false, reason: "status_blocked" }, { status: 403 });
  }

  return NextResponse.json({ allowed: true });
}
