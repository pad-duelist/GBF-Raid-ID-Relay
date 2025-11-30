"use client";

import { useRouter } from "next/navigation";
import { useState, FormEvent } from "react";

export default function HomePage() {
  const router = useRouter();
  const [groupId, setGroupId] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = groupId.trim();
    if (!trimmed) return;
    router.push(`/groups/${encodeURIComponent(trimmed)}`);
  };

  return (
    <main className="min-h-screen bg-slate-900 text-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-800/80 rounded-xl shadow p-6 space-y-4">
        <h1 className="text-xl font-bold">参戦ID共有ビューア</h1>
        <p className="text-sm text-slate-300">
          参加したいグループ名を入力してください。
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            placeholder="例: test"
            className="bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold rounded px-4 py-2 text-sm"
          >
            表示する
          </button>
        </form>
      </div>
    </main>
  );
}
