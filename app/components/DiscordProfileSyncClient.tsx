// app/components/DiscordProfileSyncClient.tsx
"use client";

import { useEffect } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
// import type { Database } from "@/lib/database.types";
import { syncDiscordProfile } from "@/lib/syncDiscordProfile";

export function DiscordProfileSyncClient() {
  const supabase = createClientComponentClient(/*<Database>*/);

  useEffect(() => {
    // ページ表示時に一度だけ同期
    void syncDiscordProfile(supabase);
  }, [supabase]);

  // 画面には何も表示しない
  return null;
}
