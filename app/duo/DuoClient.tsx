"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type RaidFastRow = {
  id: string;
  group_key: string;
  raid_id: string;
  monster: string | null;
  sender_user_id: string;
  created_at: string;
};

type Props = {
  groupKey: string; // "duo"
};

const LS_AUTO_COPY = "duo_auto_copy_v1";

export default function DuoClient({ groupKey }: Props) {
  const supabase = useMemo(() => getSupabaseBrowserClient()!, []);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const [rows, setRows] = useState<RaidFastRow[]>([]);
  const [autoCopy, setAutoCopy] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem(LS_AUTO_COPY);
    return v == null ? true : v === "1";
  });

  const lastCopiedRef = useRef<string>("");

  // ログイン中 user.id を取る（profiles.user_id と同一）
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!alive) return;
      if (error) {
        console.error(error);
        setMyUserId(null);
        return;
      }
      setMyUserId(data.user?.id ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  // 初期ロード
  useEffect(() => {
    let alive = true;

    (async () => {
      const { data, error } = await supabase
        .from("raids_fast")
        .select("id,group_key,raid_id,monster,sender_user_id,created_at")
        .eq("group_key", groupKey)
        .order("created_at", { ascending: false })
        .limit(100);

      if (!alive) return;
      if (error) {
        console.error("[duo] initial fetch error", error);
        return;
      }
      setRows((data ?? []) as RaidFastRow[]);
    })();

    return () => {
      alive = false;
    };
  }, [supabase, groupKey]);

  // Realtime購読（INSERTのみ）
  useEffect(() => {
    const channel = supabase
      .channel(`raids_fast:${groupKey}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "raids_fast",
          filter: `group_key=eq.${groupKey}`,
        },
        (payload) => {
          const row = payload.new as RaidFastRow;

          setRows((prev) => {
            // 既にあるならスキップ
            if (prev.some((x) => x.id === row.id)) return prev;
            // 先頭に追加、最大200件に丸める
            const next = [row, ...prev];
            return next.slice(0, 200);
          });

          // 自分の投稿は常に非表示＆コピーもしない
          if (myUserId && row.sender_user_id === myUserId) return;

          // 自動コピー
          if (autoCopy) {
            const raidId = row.raid_id;
            if (raidId && lastCopiedRef.current !== raidId) {
              lastCopiedRef.current = raidId;
              navigator.clipboard.writeText(raidId).catch(() => {});
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, groupKey, myUserId, autoCopy]);

  // autoCopy 永続化
  useEffect(() => {
    try {
      localStorage.setItem(LS_AUTO_COPY, autoCopy ? "1" : "0");
    } catch {}
  }, [autoCopy]);

  const visibleRows = useMemo(() => {
    if (!myUserId) return rows; // 未取得の間は一旦全部（取得後に自分のは消える）
    return rows.filter((r) => r.sender_user_id !== myUserId);
  }, [rows, myUserId]);

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>DUO Fast</h1>

        <label style={{ display: "flex", alignItems: "center", gap: 8, userSelect: "none" }}>
          <input
            type="checkbox"
            checked={autoCopy}
            onChange={(e) => setAutoCopy(e.target.checked)}
          />
          自動コピー
        </label>
      </div>

      <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
        自分が流したIDは常に非表示（ログイン中 user.id と sender_user_id 一致で除外）
      </div>

      <div style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
        {visibleRows.length === 0 ? (
          <div style={{ padding: 16, color: "#666" }}>まだIDがありません</div>
        ) : (
          visibleRows.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: "10px 12px",
                borderTop: "1px solid #eee",
              }}
            >
              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 18 }}>
                {r.raid_id}
              </div>
              <div style={{ color: "#333", fontSize: 14, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.monster ?? ""}
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(r.raid_id)}
                style={{
                  border: "1px solid #ccc",
                  background: "#f7f7f7",
                  borderRadius: 10,
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                コピー
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}