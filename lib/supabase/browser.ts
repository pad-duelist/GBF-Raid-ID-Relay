// lib/supabase/browser.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type G = {
  __gbf_sb?: SupabaseClient;
  __gbf_sb_key?: string;
};

function trimOrEmpty(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * ブラウザ用 SupabaseClient を singleton として返します。
 * 注意: Client Component では process.env の “動的アクセス” が無効なので
 * NEXT_PUBLIC_* は必ず「直書き参照」で取得します。
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;

  // eslint-disable-next-line no-process-env
  const url = trimOrEmpty(process.env.NEXT_PUBLIC_SUPABASE_URL);

  // eslint-disable-next-line no-process-env
  const anon = trimOrEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON
  );

  if (!url || !anon) return null;

  const g = globalThis as unknown as G;
  const key = `${url}|${anon.slice(0, 12)}`;

  if (g.__gbf_sb && g.__gbf_sb_key === key) return g.__gbf_sb;

  const client = createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 10 } },
  });

  g.__gbf_sb = client;
  g.__gbf_sb_key = key;

  return client;
}
