// app/login/page.tsx
"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  // singleton getter から取得（SupabaseClient | null）
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  // すでにログイン済みなら /extension-token へ飛ばす
  useEffect(() => {
    if (!supabase) return;

    const checkUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        router.replace("/extension-token");
      }
    };

    void checkUser();
  }, [supabase, router]);

  const handleDiscordLogin = async () => {
    if (!supabase) return;

    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: `${window.location.origin}/extension-token`,
      },
    });
  };

  if (!supabase) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <h1 className="mb-4 text-2xl font-bold text-white">ログイン</h1>
        <p className="text-sm text-gray-300">
          Supabase の環境変数が不足しているためログインできません。
          <br />
          NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を確認してください。
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-4 text-2xl font-bold text-white">ログイン</h1>
      <p className="mb-6 text-sm text-gray-300">
        拡張機能用トークンを取得するには、Discordアカウントでログインしてください。
      </p>
      <button
        type="button"
        onClick={handleDiscordLogin}
        className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
      >
        Discordでログイン
      </button>
    </div>
  );
}
