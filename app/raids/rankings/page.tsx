// app/raids/rankings/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import React, { Suspense } from "react";
import RaidRankingsClient from "./RaidRankingsClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black text-white">
          <div className="mx-auto max-w-4xl p-4">
            <div className="text-sm opacity-80">読み込み中…</div>
          </div>
        </div>
      }
    >
      <RaidRankingsClient />
    </Suspense>
  );
}
