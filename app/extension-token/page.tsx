"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";


type GroupInfo = {
  id: string;
  name: string;
  status: string;
};

export default function ExtensionUserIdPage() {
  const supabase = supabaseBrowserClient;
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [groupsLoading, setGroupsLoading] = useState<boolean>(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  // ログインユーザー取得
  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        setUserError("ログインが必要です。");
        setUserId(null);
        return;
      }

      setUserId(user.id);

      // ★ 自分のユーザーIDを localStorage に保存（viewer で除外に使う）
      try {
        localStorage.setItem("extensionUserId", user.id);
      } catch (e) {
        console.error("failed to save extensionUserId", e);
      }
    };

    fetchUser();
  }, [supabase]);

  // 所属グループ取得
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

  const handleCopy = async () => {
    if (!userId) return;
    try {
      await navigator.clipboard.writeText(userId);
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
        <h1 className="text-2xl font-bold text-white">
          拡張機能用ユーザーID
        </h1>
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
          下記のユーザーIDを
          <strong>Chrome拡張のオプション画面</strong>
          に貼り付けることで、拡張機能から送信されたIDと、あなたのアカウントが紐づきます。
        </p>

        {userError && (
          <p className="text-sm text-red-400">
            {userError}{" "}
            <a
              href="/login"
              className="underline text-blue-300 hover:text-blue-200"
            >
              ログインページへ
            </a>
          </p>
        )}

        {!userError && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-200">
                あなたのユーザーID
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="flex-1 rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100"
                  readOnly
                  value={userId ?? ""}
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                  disabled={!userId}
                >
                  コピー
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                拡張機能のオプション画面にある「ユーザーID」に、この値を貼り付けてください。
              </p>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-white">
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
