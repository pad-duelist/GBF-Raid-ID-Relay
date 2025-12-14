"use client";
export const dynamic = "force-dynamic";

import React, { useCallback, useEffect, useRef, useState } from "react";

type Poster = {
  sender_user_id: string;
  user_name: string | null;
  post_count: number;
};

type Battle = {
  battle_name: string;
  post_count: number;
};

type ApiResponse = {
  days: number;
  limit: number;
  groupId: string;
  posters: Poster[];
  battles: Battle[];
  generated_at: string;
};

const cardStyle: React.CSSProperties = {
  background: "#111827",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  padding: 12,
};

export default function RaidRankingsPage() {
  const [initialized, setInitialized] = useState(false);

  const [groupId, setGroupId] = useState<string>("");
  const [days, setDays] = useState<number>(7);
  const [limit, setLimit] = useState<number>(10);
  const [auto, setAuto] = useState<boolean>(true);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const timerRef = useRef<number | null>(null);

  // ★ useSearchParams を使わず、クライアントでURLから読む（静的生成でもOK）
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const g = (sp.get("groupId") ?? sp.get("group") ?? "").trim();
    setGroupId(g);
    setInitialized(true);
  }, []);

  const fetchRankings = useCallback(async () => {
    if (!initialized) return;

    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      qs.set("days", String(days));
      qs.set("limit", String(limit));
      if (groupId.trim()) qs.set("groupId", groupId.trim()); // ★現行URL互換

      const res = await fetch(`/api/rankings?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.details || `HTTP ${res.status}`);
      }

      const j = (await res.json()) as ApiResponse;
      setData(j);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [initialized, days, limit, groupId]);

  useEffect(() => {
    if (!initialized) return;
    fetchRankings();
  }, [initialized, fetchRankings]);

  useEffect(() => {
    if (!initialized) return;

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!auto) return;

    timerRef.current = window.setInterval(() => {
      fetchRankings();
    }, 10_000);

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [initialized, auto, fetchRankings]);

  return (
    <div style={{ padding: 16, color: "white", maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>ランキング</h1>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ opacity: 0.9 }}>グループ</span>
            <input
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              placeholder="group_id(UUID) または group_name"
              style={{
                width: 320,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "#0b1220",
                color: "white",
              }}
            />
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ opacity: 0.9 }}>期間(日)</span>
            <input
              type="number"
              value={days}
              min={1}
              max={60}
              onChange={(e) => setDays(Number(e.target.value))}
              style={{
                width: 80,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "white",
                color: "black",
                fontWeight: 700,
              }}
            />
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ opacity: 0.9 }}>表示数</span>
            <input
              type="number"
              value={limit}
              min={1}
              max={100}
              onChange={(e) => setLimit(Number(e.target.value))}
              style={{
                width: 80,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "white",
                color: "black",
                fontWeight: 700,
              }}
            />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              style={{ transform: "scale(1.2)" }}
            />
            <span style={{ opacity: 0.95 }}>自動更新(10秒)</span>
          </label>

          <button
            onClick={fetchRankings}
            style={{
              padding: "9px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "#1f2937",
              color: "white",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            手動更新
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>
        {loading ? "更新中…" : data ? `生成: ${data.generated_at}` : ""}
        {error ? ` / エラー: ${error}` : ""}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>
            投稿者ランキング（ユーザーID集計 / 最終使用名）
          </div>

          {data?.posters?.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {data.posters.map((p, i) => (
                <div
                  key={p.sender_user_id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ width: 22, textAlign: "right", opacity: 0.9, fontWeight: 800 }}>
                      {i + 1}
                    </div>
                    <div style={{ fontWeight: 800 }}>
                      {p.user_name && p.user_name.trim() ? p.user_name : "（名前なし）"}
                    </div>
                  </div>
                  <div style={{ fontWeight: 900 }}>{p.post_count}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ opacity: 0.8 }}>データがありません</div>
          )}
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>人気バトルランキング</div>

          {data?.battles?.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {data.battles.map((b, i) => (
                <div
                  key={`${b.battle_name}-${i}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ width: 22, textAlign: "right", opacity: 0.9, fontWeight: 800 }}>
                      {i + 1}
                    </div>
                    <div style={{ fontWeight: 800 }}>{b.battle_name}</div>
                  </div>
                  <div style={{ fontWeight: 900 }}>{b.post_count}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ opacity: 0.8 }}>データがありません</div>
          )}
        </div>
      </div>
    </div>
  );
}
