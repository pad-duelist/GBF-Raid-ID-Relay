// lib/supabaseServer.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// サーバーサイド専用クライアント
let client: SupabaseClient | null = null;

if (!supabaseUrl || !serviceRoleKey) {
  // ここでは throw せずログだけにする → ビルドは通る
  console.error(
    "Supabase env vars are not set. " +
      "Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
  );
} else {
  client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}

export const supabaseServer = client;
