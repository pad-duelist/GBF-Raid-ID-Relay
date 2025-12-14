"use client";
export const dynamic = "force-dynamic";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Poster = { sender_user_id: string; user_name: string | null; post_count: number };
type Battle = { battle_name: string; post_count: number };

type ApiResponse = {
  limit: number;
  groupId: string;
  from?: string | null;
  to?: string | null;
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

const MERGE_IDS = new Set([
  "86f9ace9-dad7-4daa-9c28-adb44759c252",
  "8cf84c8f-2052-47fb-a3a9-cf7f2980eef4",
]);
const CANONICAL_ID = "8cf84c8f-2052-47fb-a3a9-cf7f2980eef4";

function mergePosters(posters: Poster[]): Poster[] {
  if (!posters?.length) return posters;

  const normalize = (id: string) => (MERGE_IDS.has(id) ? CANONICAL_ID : id);

  const namePriority = (p: Poster) => {
    const hasName = !!(p.user_name && p.user_name.trim());
    if (!hasName) return 0;
    return p.sender_user_id === CANONICAL_ID ? 2 : 1;
  };

  const map = new Map<
    string,
    { sender_user_id: string; user_name: string | null; post_count: number; _namePrio: number }
  >();

  for (const p of posters) {
    const nid = normalize(p.sender_user_id);
    const cur = map.get(nid);

    if (!cur) {
      map.set(nid, {
        sender_user_id: nid,
        user_name: p.user_name,
        post_count: p.post_count,
        _namePrio: namePriority(p),
      });
      continue;
    }

    cur.post_count += p.post_count;

    const pr = namePriority(p);
    if (pr > cur._namePrio) {
      cur.user_name = p.user_name;
      cur._namePrio = pr;
    }

    map.set(nid, cur);
  }

  const merged = Array.from(map.values()).map(({ _namePrio, ...rest }) => rest);
  merged.sort((a, b) => b.post_count - a.post_count);
  return merged;
}

// JST 5:00 境界で from を計算（ブラウザTZに依存しない）
const JST_OFFSET_MIN = 9 * 60;

function jstParts(nowUtc: Date) {
  const shifted = new Date(nowUtc.getTime() + JST_OFFSET_MIN * 60 * 1000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    dow: shifted.getUTCDay(), // 0=Sun..6=Sat
    hh: shifted.getUTCHours(),
  };
}
function addDaysJst(y: number, m: number, d: number, deltaDays: number) {
  const t = new Date(Date.UTC(y, m, d) + deltaDays * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), dow: t.getUTCDay() };
}
function makeInstantFromJst(y: number, m: number, d: number, hh: number, mm = 0, ss = 0) {
  const utcMs = Date.UTC(y, m, d, hh, mm, ss) - JST_OFFSET_MIN * 60 * 1000;
  return new Date(utcMs);
}
function effectiveJstDate(nowUtc: Date) {
  const p = jstParts(nowUtc);
  if (p.hh < 5) return addDaysJst(p.y, p.m, p.d, -1);
  return { y: p.y, m: p.m, d: p.d, dow: p.dow };
}

type PeriodKey = "today" | "week" | "month";

function computeFrom(nowUtc: Date, period: PeriodKey): Date {
  const e = effectiveJstDate(nowUtc);

  if (period === "today") {
    return makeInstantFromJst(e.y, e.m, e.d, 5, 0, 0);
  }
  if (period === "week") {
    const diffFromMon = (e.dow + 6) % 7; // Mon=0
    const mon = addDaysJst(e.y, e.m, e.d, -diffFromMon);
    return makeInstantFromJst(mon.y, mon.m, mon.d, 5, 0, 0);
  }
  return makeInstantFromJst(e.y, e.m, 1, 5, 0, 0);
}

function formatJst(dtUtc: Date) {
  const shifted = new Date(dtUtc.getTime() + JST_OFFSET_MIN * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${y}/${m}/${d} ${hh}:${mm} (JST)`;
}

export default function RaidRankingsPage() {
  const router = useRouter();
  const [initialized, setInitialized] = useState(false);

  const [groupId, setGroupId] = useState<string>("");
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [limit, setLimit] = useState<number>(10);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const g = (sp.get("groupId") ?? sp.get("group") ?? "").trim();
    setGroupId(g);
    setInitialized(true);
  }, []);

  const handleBack = useCallback(() => {
    const g = groupId.trim();
    if (g) router.push(`/g/${encodeURIComponent(g)}`);
    else router.push(`/`);
  }, [router, groupId]);

  const rangeInfo = useMemo(() => {
    const now = new Date();
    return { from: computeFrom(now, period), to: now };
  }, [period]);

  const fetchRankings = useCallback(async () => {
    if (!initialized) return;
    setLoading(true);
    setError("");

    try {
      const safeLimit = Math.max(1, limit);
      const fetchLimit = Math.min(200, safeLimit + 5);

      const now = new Date();
      const from = computeFrom(now, period);

      const qs = new URLSearchParams();
      qs.set("limit", String(fetchLimit));
      qs.set("from", from.toISOString());
      // qs.set("to", now.toISOString()); // 必要なら有効化
      if (groupId.trim()) qs.set("groupId", groupId.trim());
      qs.set("_t", String(Date.now()));

      const res = await fetch(`/api/rankings?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.details || `HTTP ${res.status}`);
      }

      const j = (await res.json()) as ApiResponse;

      const mergedPosters = mergePosters(j.posters ?? []);
      const postersFixed = mergedPosters.slice(0, safeLimit);
      const battlesFixed = (j.battles ?? []).slice(0, safeLimit);

      setData({ ...j, limit: safeLimit, posters: postersFixed, battles: battlesFixed });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [initialized, period, limit, groupId]);

  useEffect(() => {
    if (!initialized) return;
    fetchRankings();
  }, [initialized, fetchRankings]);

  return (
    <div style={{ padding: 16, color: "white", maxWidth: 980, margin: "0 auto" }}>
      <div style={{ position: "relative", paddingRight: 160 }}>
        <button
          onClick={handleBack}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            padding: "9px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "#111827",
            color: "white",
            cursor: "pointer",
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          ← グループへ戻る
        </button>

        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>ランキング</h1>

        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <span style={{ opacity: 0.9 }}>グループ</span>
            <span style={{ fontWeight: 900, fontSize: 16 }}>{groupId || "（未指定）"}</span>
          </div>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ opacity: 0.9 }}>期間</span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as PeriodKey)}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "white",
                color: "black",
                fontWeight: 700,
              }}
            >
              <option value="today">今日（5:00〜翌4:59）</option>
              <option value="week">今週（月曜5:00〜月曜4:59）</option>
              <option value="month">今月（1日5:00〜翌月1日4:59）</option>
            </select>
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
              whiteSpace: "nowrap",
            }}
          >
            更新
          </button>
        </div>

        <div style={{ marginTop: 8, opacity: 0.75, fontSize: 12 }}>
          集計範囲: {formatJst(rangeInfo.from)} ～ {formatJst(rangeInfo.to)}
        </div>

        {error ? <div style={{ marginTop: 8, opacity: 0.9, fontSize: 12 }}>エラー: {error}</div> : null}
        {loading ? <div style={{ marginTop: 8, opacity: 0.75, fontSize: 12 }}>更新中…</div> : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>ユーザーランキング</div>
          {data?.posters?.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {data.posters.map((p, i) => (
                <div
                  key={`${p.sender_user_id}-${i}`}
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
                    <div style={{ width: 22, textAlign: "right", opacity: 0.9, fontWeight: 800 }}>{i + 1}</div>
                    <div style={{ fontWeight: 800 }}>{p.user_name?.trim() ? p.user_name : "（名前なし）"}</div>
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
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>バトルランキング</div>
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
                    <div style={{ width: 22, textAlign: "right", opacity: 0.9, fontWeight: 800 }}>{i + 1}</div>
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
