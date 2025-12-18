// lib/supabaseBrowser.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function getSupabaseBrowserClient(): SupabaseClient {
  const g = globalThis as unknown as { __supabaseBrowser?: SupabaseClient };

  if (!g.__supabaseBrowser) {
    g.__supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return g.__supabaseBrowser;
}

// 既存コード互換のためのエクスポート（どれを使っても同一インスタンス）
export const supabaseBrowser = getSupabaseBrowserClient();
export const supabaseBrowserClient = supabaseBrowser;
