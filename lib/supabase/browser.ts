// lib/supabase/browser.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const g = globalThis as unknown as { __sb?: SupabaseClient };

export const supabaseBrowser: SupabaseClient =
  g.__sb ?? (g.__sb = createClient(url, anon));
