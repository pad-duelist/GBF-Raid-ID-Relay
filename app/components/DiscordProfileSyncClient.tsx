// app/components/DiscordProfileSyncClient.tsx
"use client";

import { useEffect, useMemo } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { syncDiscordProfile } from "@/lib/syncDiscordProfile";

// 必要なら型を入れてもOK
// import type { Database } from "@/lib/database.types";

function createBrowserSupabaseClient(): SupabaseClient /*<Database>*/ {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL または NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません。"
    );
  }

  return createClient(/*<Database>*/ url, anonKey);
}

export function DiscordProfileSyncClient() {
  // クライアント側で Supabase クライアントを1回だけ生成
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  useEffect(() => {
    void syncDiscordProfile(supabase);
  }, [supabase]);

  // 画面には何も表示しない
  return null;
}
