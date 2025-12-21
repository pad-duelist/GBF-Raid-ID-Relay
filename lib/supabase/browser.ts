// lib/supabase/browser.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getEnv(name: string): string | undefined {
  // eslint-disable-next-line no-process-env
  const v = process.env[name];
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}

type G = {
  __gbf_sb?: SupabaseClient;
  __gbf_sb_key?: string;
};

/**
 * ブラウザ用 SupabaseClient を “必要になった時だけ” 生成して globalThis にキャッシュします。
 * - SSR中（windowなし）は null
 * - env不足でも null（画面はfetch等で動かしたい、という運用に合わせる）
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;

  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon =
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") || getEnv("NEXT_PUBLIC_SUPABASE_ANON");

  if (!url || !anon) return null;

  const g = globalThis as unknown as G;

  // URLとキーが変わったときだけ作り直す（基本は変わりません）
  const key = `${url}|${anon.slice(0, 12)}`;

  if (g.__gbf_sb && g.__gbf_sb_key === key) {
    return g.__gbf_sb;
  }

  const client = createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 10 } },
  });

  g.__gbf_sb = client;
  g.__gbf_sb_key = key;

  return client;
}
