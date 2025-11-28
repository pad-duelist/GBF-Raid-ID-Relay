"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function HomePage() {
  const router = useRouter();
  const [groupId, setGroupId] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!groupId.trim()) return;
    router.push(`/g/${encodeURIComponent(groupId.trim())}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-50">
      <div className="w-full max-w-md bg-slate-800/80 rounded-2xl p-6 shadow-lg space-y-4">
        <h1 className="text-xl font-bold text-center">
          GBF 参戦ID共有ビューア
        </h1>
        <p className="text-sm text-slate-400 text-center">
          グループIDを入力して、参戦ID一覧を表示します。
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm">
            グループID
            <input
              className="mt-1 w-full rounded-md bg-slate-900 border border-slate-600 px-3 py-2 text-sm"
              placeholder="例: friends1"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold hover:bg-emerald-400"
          >
            開く
          </button>
        </form>
      </div>
    </div>
  );
}
