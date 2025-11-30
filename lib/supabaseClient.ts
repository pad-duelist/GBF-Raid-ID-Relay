// lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ブラウザ用クライアント
export const supabaseBrowserClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,       // ★ ログイン情報を localStorage に保存
    autoRefreshToken: true,
  },
});
