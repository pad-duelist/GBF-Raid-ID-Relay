// 例: app/login/page.tsx
"use client";

import { createClient } from "@/lib/supabaseClient";

export default function LoginPage() {
  const supabase = createClient();

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <button
      onClick={handleLogin}
      className="rounded bg-indigo-600 px-4 py-2 text-white"
    >
      Discordでログイン
    </button>
  );
}
