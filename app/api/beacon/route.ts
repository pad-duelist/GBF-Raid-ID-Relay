import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

export async function POST(req: NextRequest) {
  try {
    // フォーム POST の data パラメータを取得
    const formData = await req.formData();
    const data = formData.get("data") as string;
    if (!data) throw new Error("data が存在しません");

    const payload = JSON.parse(data);

    // Supabase に保存
    const { error } = await supabase.from("beacons").insert([payload]);
    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("POST error:", e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// OPTIONS リクエストは不要ですが一応
export async function OPTIONS() {
  const res = new NextResponse(null);
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}
