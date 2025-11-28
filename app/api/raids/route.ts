// app/api/relay/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // サービスロールキー

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Supabase の環境変数が設定されていません');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const TABLE_NAME = 'raids';

type RaidPayload = {
  roomId: string;            // ← 拡張機能から送っている値
  raidId: string;
  bossName?: string;
  level?: string;
  joined?: number | null;     // 参戦人数
  maxPlayers?: number | null; // 最大人数
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RaidPayload;
    const { roomId, raidId, bossName, level, joined, maxPlayers } = body;

    if (!roomId || !raidId) {
      return NextResponse.json(
        { error: 'roomId と raidId は必須です' },
        { status: 400 }
      );
    }

    // group_id + raid_id が同じものは一意になるように UPSERT
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .upsert(
        {
          group_id: roomId,          // ← DB 側のカラム名
          raid_id: raidId,
          boss_name: bossName ?? null,
          level: level ?? null,
          joined: joined ?? null,
          max_players: maxPlayers ?? null,
        },
        {
          onConflict: 'group_id,raid_id',
          ignoreDuplicates: true,
        }
      )
      .select('id');

    if (error) {
      console.error('upsert error', error);
      return NextResponse.json(
        { error: 'データ登録に失敗しました' },
        { status: 500 }
      );
    }

    const isDuplicate = !data || data.length === 0;

    return NextResponse.json(
      {
        ok: true,
        status: isDuplicate ? 'duplicate_ignored' : 'inserted',
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('route error', err);
    return NextResponse.json(
      { error: '不正なリクエストです' },
      { status: 400 }
    );
  }
}
