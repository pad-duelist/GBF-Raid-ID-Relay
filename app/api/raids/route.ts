import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ======== ボスブロックリスト関連設定 ========
const BOSS_BLOCKLIST_CSV_URL = process.env.BOSS_BLOCKLIST_CSV_URL;
let bossBlockList: Set<string> | null = null;
let lastBossBlockListFetched = 0;
const BOSS_BLOCKLIST_TTL = 5 * 60 * 1000; // 5分キャッシュ

function normalizeBossName(name: string): string {
  return name.trim();
}

async function loadBossBlockList(): Promise<Set<string>> {
  const now = Date.now();
  if (bossBlockList && now - lastBossBlockListFetched < BOSS_BLOCKLIST_TTL) {
    return bossBlockList;
  }

  const set = new Set<string>();

  if (!BOSS_BLOCKLIST_CSV_URL) {
    console.warn("BOSS_BLOCKLIST_CSV_URL が設定されていません");
    bossBlockList = set;
    lastBossBlockListFetched = now;
    return set;
  }

  try {
    const res = await fetch(BOSS_BLOCKLIST_CSV_URL);
    const text = await res.text();

    const lines = text.split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const bossName = line.split(",")[0];
      if (bossName) set.add(normalizeBossName(bossName));
    }
    console.log(`Loaded ${set.size} boss names from blocklist`);
  } catch (err) {
    console.error("ボスNGリストの取得に失敗しました:", err);
  }

  bossBlockList = set;
  lastBossBlockListFetched = now;
  return set;
}

async function isBlockedBoss(bossName: string | null | undefined): Promise<boolean> {
  if (!bossName) return false;
  const list = await loadBossBlockList();
  return list.has(normalizeBossName(bossName));
}
// ===================================================

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { raid_id, boss_name, host, level, hp, time } = body;

    // ======== ボスブロックチェック ========
    if (await isBlockedBoss(boss_name)) {
      console.log(`ブロック対象ボスをスキップ: ${boss_name}`);
      return NextResponse.json(
        { skipped: true, reason: "blocked_boss", boss_name },
        { status: 200 }
      );
    }

    // 重複チェック
    const { data: existing, error: checkError } = await supabase
      .from("raid_ids")
      .select("id")
      .eq("raid_id", raid_id)
      .limit(1);

    if (checkError) {
      console.error("重複チェックエラー:", checkError);
      return NextResponse.json({ error: "check_failed" }, { status: 500 });
    }

    if (existing && existing.length > 0) {
      return NextResponse.json({ skipped: true, reason: "duplicate" }, { status: 200 });
    }

    // データ挿入
    const { error: insertError } = await supabase.from("raid_ids").insert([
      {
        raid_id,
        boss_name,
        host,
        level,
        hp,
        time,
      },
    ]);

    if (insertError) {
      console.error("挿入エラー:", insertError);
      return NextResponse.json({ error: "insert_failed" }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("POST処理エラー:", error);
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("raid_ids")
      .select("*")
      .order("id", { ascending: false })
      .limit(100);

    if (error) {
      console.error("取得エラー:", error);
      return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("GET処理エラー:", error);
    return NextResponse.json({ error: "unknown_error" }, { status: 500 });
  }
}
