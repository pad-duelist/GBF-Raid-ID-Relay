// lib/syncDiscordProfile.ts
import type { SupabaseClient } from "@supabase/supabase-js";
// import type { Database } from "@/lib/database.types"; // 型を使っている場合はこちらを使う

export async function syncDiscordProfile(
  supabase: SupabaseClient /*<Database>*/
) {
  // ログインユーザー取得
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return;
  }

  // Supabase JS からは raw_user_meta_data 相当が user.user_metadata に入ってきます
  const meta: any = user.user_metadata ?? {};

  // Discord ID と名前を取り出し（必要に応じて他のキーも追加）
  const discordId: string | undefined =
    meta.sub ?? meta.provider_id ?? meta.id; // 安全のため候補を複数
  const discordName: string | undefined =
    meta.name ?? meta.full_name ?? meta.username;

  if (!discordId && !discordName) {
    // どちらも取れなければ何もしない
    return;
  }

  // 既存のプロフィール取得
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("discord_id, discord_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    // 権限エラーなどはとりあえず無視（ログだけ仕込んでもOK）
    console.error("failed to fetch profile", profileError);
    return;
  }

  // すでに同じ値なら何もしない
  if (
    profile &&
    profile.discord_id === discordId &&
    profile.discord_name === discordName
  ) {
    return;
  }

  // 更新（行がない場合も想定して upsert）
  const { error: upsertError } = await supabase.from("profiles").upsert(
    {
      user_id: user.id,
      discord_id: discordId ?? profile?.discord_id ?? null,
      discord_name: discordName ?? profile?.discord_name ?? null,
    },
    { onConflict: "user_id" }
  );

  if (upsertError) {
    console.error("failed to sync discord profile", upsertError);
  }
}
