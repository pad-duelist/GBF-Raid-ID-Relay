// lib/supabaseServer.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * サーバーサイド用 Supabase クライアントを取得する。
 * 必須の環境変数が足りない場合は null を返し、決して throw しない。
 */
export function getSupabaseServer(): SupabaseClient | null {
  // SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL のどちらでもOKにしておく
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  // サービスロールキーがあればそれを優先、無ければ anon key でも動くだけ動かす
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";

  if (!url || !key) {
    console.error(
      "Supabase env vars are not set. " +
        "Set SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
    return null;
  }

  try {
    const client = createClient(url, key, {
      auth: { persistSession: false },
    });
    return client;
  } catch (e) {
    console.error("Failed to create Supabase client", e);
    return null;
  }
}
