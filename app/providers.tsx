// app/providers.tsx
"use client";

import { useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { SessionContextProvider } from "@supabase/auth-helpers-react";

export default function Providers({ children }: { children: React.ReactNode }) {
  // ★ブラウザで Supabase Auth クライアントを「1回だけ」生成して使い回す
  const [supabase] = useState(() => createClientComponentClient());

  return (
    <SessionContextProvider supabaseClient={supabase}>
      {children}
    </SessionContextProvider>
  );
}
