// app/components/DiscordProfileSyncClient.tsx
"use client";

import { useEffect, useMemo } from "react";
import { syncDiscordProfile } from "@/lib/syncDiscordProfile";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { SupabaseClient } from "@supabase/supabase-js";

export function DiscordProfileSyncClient() {
  // Supabase クライアントは singleton getter から取得（自前 createClient は禁止）
  const supabase = useMemo<SupabaseClient | null>(() => {
    return getSupabaseBrowserClient();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    void syncDiscordProfile(supabase);
  }, [supabase]);

  // 画面には何も表示しない
  return null;
}
