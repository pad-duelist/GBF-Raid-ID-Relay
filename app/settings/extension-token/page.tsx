// app/settings/extension-token/page.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabaseClient";

type TokenState = {
  loading: boolean;
  error: string | null;
  token: string | null;
};

export default function ExtensionTokenPage() {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<TokenState>({
    loading: true,
    error: null,
    token: null,
  });

  // ログインユーザー取得
  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        setState({
          loading: false,
          error: "ログインが必要です。",
          token: null,
        });
        return;
      }

      setUserId(user.id);
    };

    fetchUser();
  }, [supabase]);

  // ユーザーIDが取れたらトークン取得
  useEffect(() => {
    const fetchToken = async () => {
      if (!userId) return;

      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const res = await fetch("/api/profile/extension-token", {
          method: "GET",
          headers: {
            "X-User-Id": userId,
          },
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "トークン取得に失敗しました。");
        }

        const data = (await res.json()) as { extensionToken: string };
        setState({
          loading: false,
          error: null,
          token: data.extensionToken,
        });
      } catch (e: any) {
        setState({
          loading: false,
          error: e.message ?? "トークン取得に失敗しました。",
          token: null,
        });
      }
    };

    fetchToken();
  }, [userId]);

  const handleRotate = async () => {
    if (!userId) return;

    if (
      !window.confirm(
        "トークンを再発行すると、古いトークンを設定している拡張機能は使えなくなります。再発行しますか？"
      )
    ) {
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const res = await fetch("/api/profile/extension-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": userId,
        },
        body: JSON.stringify({ rotate: true }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "トークン再発行に失敗しました。");
      }

      const data = (await res.json()) as { extensionToken: string };
      setState({
        loading: false,
        error: null,
        token: data.extensionToken,
      });
    } catch (e: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: e.message ?? "トークン再発行に失敗しました。",
      }));
    }
  };

  const handleCopy = async () => {
    if (!state.token) return;
    try {
      await navigator.clipboard.writeText(state.token);
      alert("クリップボードにコピーしました。");
    } catch {
      alert("コピーに失敗しました。手動で選択してコピーしてください。");
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">拡張機能用トークン</h1>

      <p className="mb-4 text-sm text-gray-700">
        このトークンを
        <strong>Chrome拡張のオプション画面</strong>
        に貼り付けることで、拡張機能から送信されたIDと、あなたのアカウントが紐づきます。
        <br />
        トークンは<strong>他人に見せない</strong>ようにしてください。
      </p>

      {state.loading && <p>読み込み中です…</p>}

      {!state.loading && state.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      {!state.loading && !state.error && (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              現在のトークン
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs"
                readOnly
                value={state.token ?? ""}
              />
              <button
                type="button"
                onClick={handleCopy}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                disabled={!state.token}
              >
                コピー
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              拡張機能のオプション画面にある「拡張機能用トークン」に、この値を貼り付けてください。
            </p>
          </div>

          <div>
            <button
              type="button"
              onClick={handleRotate}
              className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              disabled={state.loading}
            >
              トークンを再発行する
            </button>
            <p className="mt-1 text-xs text-gray-500">
              再発行すると、古いトークンを設定している拡張機能は送信できなくなります。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
