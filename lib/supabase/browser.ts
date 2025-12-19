// lib/supabase/browser.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getEnv(name: string): string | undefined {
  // eslint-disable-next-line no-process-env
  const v = process.env[name];
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}

function createSupabaseBrowserClient(): SupabaseClient {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") || getEnv("NEXT_PUBLIC_SUPABASE_ANON");

  if (!url || !anon) {
    // クライアント側で必要になる環境変数なので、ここは明確に落として気づけるようにする
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON)."
    );
  }

  return createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 10 } },
  });
}

const g = globalThis as unknown as { __sb?: SupabaseClient };

// ★ブラウザ（同一タブ）で Supabase クライアントを1つに統一する
export const supabaseBrowser: SupabaseClient = g.__sb ?? (g.__sb = createSupabaseBrowserClient());
