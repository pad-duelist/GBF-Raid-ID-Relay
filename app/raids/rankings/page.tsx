"use client";
export const dynamic = "force-dynamic";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { computeRangeUtc, todayYmdJst, RankingPeriod } from "@/lib/rankingRange";

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

type PeriodKey = "today" | "week" | "month";

function periodToRankingPeriod(p: PeriodKey): RankingPeriod {
  if (p === "today") return "day";
  return p;
}

// refDate (YYYY-MM-DD) を period に沿って ±1 移動する
function navigateDate(refDate: string, period: PeriodKey, direction: -1 | 1): string {
  const [y, m, d] = refDate.split("-").map(Number);
  if (period === "today") {
    const base = new Date(Date.UTC(y, m - 1, d));
    base.setUTCDate(base.getUTCDate() + direction);
    return base.toISOString().slice(0, 10);
  }
  if (period === "week") {
    const base = new Date(Date.UTC(y, m - 1, d));
    base.setUTCDate(base.getUTCDate() + direction * 7);
    return base.toISOString().slice(0, 10);
  }
  // month
  const newM = m - 1 + direction;
  const date = new Date(Date.UTC(y, newM, 1));
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const clampedD = Math.min(d, daysInMonth);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(clampedD).padStart(2, "0")}`;
}

// refDate が today と同じ集計期間かどうか
function isCurrentPeriod(period: PeriodKey, refDate: string): boolean {
  const today = todayYmdJst();
  const rp = periodToRankingPeriod(period);
  try {
    const { startUtc: rs } = computeRangeUtc(rp, refDate);
    const { startUtc: ts } = computeRangeUtc(rp, today);
    return rs === ts;
  } catch {
    return false;
  }
}

const JST_OFFSET_MIN = 9 * 60;
function jstDateStr(utcIso: string): string {
  const d = new Date(utcIso);
  const jst = new Date(d.getTime() + JST_OFFSET_MIN * 60 * 1000);
  return `${jst.getUTCFullYear()}/${String(jst.getUTCMonth() + 1).padStart(2, "0")}/${String(jst.getUTCDate()).padStart(2, "0")}`;
}

function formatPeriodLabel(period: PeriodKey, startUtc: string, endUtc: string): string {
  if (period === "today") {
    return jstDateStr(startUtc);
  }
  if (period === "week") {
    // endUtc は排他なので -1s
    const endInclusive = new Date(new Date(endUtc).getTime() - 1000).toISOString();
    return `${jstDateStr(startUtc)} 〜 ${jstDateStr(endInclusive)}`;
  }
  // month
  const d = new Date(startUtc);
  const jst = new Date(d.getTime() + JST_OFFSET_MIN * 60 * 1000);
  return `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月`;
}

export default function RaidRankingsPage() {
  const router = useRouter();
  const [initialized, setInitialized] = useState(false);

  const [groupId, setGroupId] = useState<string>("");
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [refDate, setRefDate] = useState<string>(() => todayYmdJst());
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
    try {
      return computeRangeUtc(periodToRankingPeriod(period), refDate);
    } catch {
      const now = new Date().toISOString();
      return { startUtc: now, endUtc: now };
    }
  }, [period, refDate]);

  const periodLabel = useMemo(
    () => formatPeriodLabel(period, rangeInfo.startUtc, rangeInfo.endUtc),
    [period, rangeInfo]
  );

  const atCurrentPeriod = useMemo(() => isCurrentPeriod(period, refDate), [period, refDate]);

  const handlePrev = useCallback(() => {
    setRefDate((d) => navigateDate(d, period, -1));
  }, [period]);

  const handleNext = useCallback(() => {
    if (!atCurrentPeriod) setRefDate((d) => navigateDate(d, period, 1));
  }, [period, atCurrentPeriod]);

  const handlePeriodChange = useCallback((newPeriod: PeriodKey) => {
    setPeriod(newPeriod);
    setRefDate(todayYmdJst());
  }, []);

  const handleGoToToday = useCallback(() => {
    setRefDate(todayYmdJst());
  }, []);

  const fetchRankings = useCallback(async () => {
    if (!initialized) return;
    setLoading(true);
    setError("");

    try {
      const safeLimit = Math.max(1, limit);
      const fetchLimit = Math.min(200, safeLimit + 5);

      const { startUtc: from, endUtc: to } = computeRangeUtc(periodToRankingPeriod(period), refDate);

      const qs = new URLSearchParams();
      qs.set("limit", String(fetchLimit));
      qs.set("from", from);
      qs.set("to", to);
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
  }, [initialized, period, refDate, limit, groupId]);

  useEffect(() => {
    if (!initialized) return;
    fetchRankings();
  }, [initialized, fetchRankings]);

  const btnBase: React.CSSProperties = {
    padding: "9px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "#1f2937",
    color: "white",
    cursor: "pointer",
    fontWeight: 800,
    whiteSpace: "nowrap",
  };

  const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
    ...btnBase,
    padding: "7px 14px",
    fontSize: 18,
    opacity: disabled ? 0.3 : 1,
    cursor: disabled ? "default" : "pointer",
  });

  return (
    <div style={{ padding: 16, color: "white", maxWidth: 980, margin: "0 auto" }}>
      <div style={{ position: "relative", paddingRight: 160 }}>
        <button
          onClick={handleBack}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            ...btnBase,
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
              onChange={(e) => handlePeriodChange(e.target.value as PeriodKey)}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "white",
                color: "black",
                fontWeight: 700,
              }}
            >
              <option value="today">日</option>
              <option value="week">週</option>
              <option value="month">月</option>
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

          <button onClick={fetchRankings} style={btnBase}>更新</button>
        </div>

        {/* 期間ナビゲーション */}
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={handlePrev} style={navBtnStyle(false)}>‹</button>

          <span style={{ fontWeight: 800, fontSize: 15, minWidth: 200, textAlign: "center" }}>
            {periodLabel}
          </span>

          <button
            onClick={handleNext}
            disabled={atCurrentPeriod}
            style={navBtnStyle(atCurrentPeriod)}
          >
            ›
          </button>

          {!atCurrentPeriod && (
            <button onClick={handleGoToToday} style={{ ...btnBase, background: "#374151", fontSize: 13 }}>
              現在へ
            </button>
          )}
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
