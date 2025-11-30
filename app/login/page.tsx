// app/login/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowserClient } from "@/lib/supabaseClient";

export default function LoginPage() {
  const supabase = supabaseBrowserClient;
  const router = useRouter();

  // すでにログイン済みなら /extension-token へ飛ばす
  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        router.replace("/extension-token");
      }
    };
    checkUser();
  }, [supabase, router]);

  const handleDiscordLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        // 現在のドメインに合わせて extension-token へ戻す
        redirectTo: `${window.location.origin}/extension-token`,
      },
    });
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-4 text-2xl font-bold text-white">ログイン</h1>
      <p className="mb-6 text-sm text-gray-300">
        拡張機能用トークンを取得するには、
        Discordアカウントでログインしてください。
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
