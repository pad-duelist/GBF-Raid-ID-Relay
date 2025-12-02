// app/extension-token/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowserClient } from "@/lib/supabaseClient";

type TokenState = {
  loading: boolean;
  error: string | null;
  token: string | null;
};

type GroupInfo = {
  id: string;    // groups.id (uuid)
  name: string;  // groups.name (例: "Group1", "Apoklisi", "LostFragments")
  status: string;
};

export default function ExtensionTokenPage() {
  const supabase = supabaseBrowserClient;
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<TokenState>({
    loading: true,
    error: null,
    token: null,
  });

  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [groupsLoading, setGroupsLoading] = useState<boolean>(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  // 🔹 ここで取得したトークンを localStorage に保存する
  useEffect(() => {
    if (!state.token) return;
    try {
      localStorage.setItem("extensionToken", state.token);
      // console.log("extensionToken saved:", state.token);
    } catch (e) {
      console.error("failed to save extensionToken to localStorage", e);
    }
  }, [state.token]);

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

  // ユーザーIDが取れたら所属グループ取得
  useEffect(() => {
    const fetchGroups = async () => {
      if (!userId) return;
      setGroupsLoading(true);
      setGroupsError(null);
      try {
        const res = await fetch("/api/profile/groups", {
          headers: {
            "X-User-Id": userId,
          },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "グループ情報の取得に失敗しました。");
        }
        const data = (await res.json()) as { groups: GroupInfo[] };
        setGroups(data.groups || []);
      } catch (e: any) {
        setGroupsError(e.message ?? "グループ情報の取得に失敗しました。");
      } finally {
        setGroupsLoading(false);
      }
    };

    fetchGroups();
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">拡張機能用トークン</h1>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded border border-gray-500 px-3 py-1 text-xs text-gray-200 hover:bg-gray-700"
        >
          ログアウト
        </button>
      </div>

      <section>
        <p className="mb-4 text-sm text-gray-300">
          このトークンを
          <strong>Chrome拡張のオプション画面</strong>
          に貼り付けることで、拡張機能から送信されたIDと、あなたのアカウントが紐づきます。
          <br />
          トークンは<strong>他人に見せない</strong>ようにしてください。
        </p>

        {state.loading && (
          <p className="text-sm text-gray-300">トークンを読み込み中です…</p>
        )}

        {!state.loading && state.error && (
          <p className="text-sm text-red-400">
            {state.error}{" "}
            <a
              href="/login"
              className="underline text-blue-300 hover:text-blue-200"
            >
              ログインページへ
            </a>
          </p>
        )}

        {!state.loading && !state.error && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-200">
                現在のトークン
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="flex-1 rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100"
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
              <p className="mt-1 text-xs text-gray-400">
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
              <p className="mt-1 text-xs text-gray-400">
                再発行すると、古いトークンを設定している拡張機能は送信できなくなります。
              </p>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text白">
          所属グループへのリンク
        </h2>

        {groupsLoading && (
          <p className="text-sm text-gray-300">グループ情報を読み込み中です…</p>
        )}

        {!groupsLoading && groupsError && (
          <p className="text-sm text-red-400">{groupsError}</p>
        )}

        {!groupsLoading && !groupsError && groups.length === 0 && (
          <p className="text-sm text-gray-300">
            まだどのグループにも所属していません。管理者に参加設定を依頼してください。
          </p>
        )}

        {!groupsLoading && !groupsError && groups.length > 0 && (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-semibold text-gray-100">{g.name}</div>
                  <div className="text-xs text-gray-400">
                    ステータス:
                    {g.status === "owner" ? " 管理者" : " メンバー"}
                  </div>
                </div>
                <a
                  href={`/g/${encodeURIComponent(g.name)}`}
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  このグループの救援一覧へ
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
