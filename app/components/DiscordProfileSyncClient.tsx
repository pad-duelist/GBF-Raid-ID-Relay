// app/components/DiscordProfileSyncClient.tsx
"use client";

import { useEffect } from "react";
import { syncDiscordProfile } from "@/lib/syncDiscordProfile";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function DiscordProfileSyncClient() {
  useEffect(() => {
    void syncDiscordProfile(supabaseBrowser);
  }, []);

  // 画面には何も表示しない
  return null;
}
