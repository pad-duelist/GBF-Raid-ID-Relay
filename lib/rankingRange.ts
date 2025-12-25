export type RankingPeriod = "day" | "week" | "month";

/** "YYYY-MM-DD" をパース */
export function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/**
 * JST日時(=UTC+9) を UTC Date に変換
 * 例) JST 2025-12-25 05:00 -> UTC 2025-12-24 20:00
 */
function utcDateFromJst(y: number, m: number, d: number, hh = 0, mm = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm, 0, 0));
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfWeekMondayJst(ymd: { y: number; m: number; d: number }): { y: number; m: number; d: number } {
  // JST の曜日を安全に取るため、JST正午を基準にする
  const noonUtc = utcDateFromJst(ymd.y, ymd.m, ymd.d, 12, 0);
  const dow = noonUtc.getUTCDay(); // JST正午相当の曜日
  const diffToMonday = (dow + 6) % 7; // Mon=0, Sun=6

  // 週開始は「月曜 05:00 JST」
  const base = utcDateFromJst(ymd.y, ymd.m, ymd.d, 5, 0);
  const mondayStartUtc = addDaysUtc(base, -diffToMonday);

  // UTC->JSTへ戻して暦日だけ返す
  const jstMillis = mondayStartUtc.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMillis);
  return { y: jst.getUTCFullYear(), m: jst.getUTCMonth() + 1, d: jst.getUTCDate() };
}

/**
 * 選択日(YYYY-MM-DD) と period から [startUtc, endUtc) を返す
 * 週：月曜 05:00 JST 始まり
 */
export function computeRangeUtc(period: RankingPeriod, ymdStr: string): { startUtc: string; endUtc: string } {
  const ymd = parseYmd(ymdStr);
  if (!ymd) throw new Error(`Invalid date: ${ymdStr}`);

  if (period === "day") {
    const start = utcDateFromJst(ymd.y, ymd.m, ymd.d, 5, 0);
    const end = addDaysUtc(start, 1);
    return { startUtc: start.toISOString(), endUtc: end.toISOString() };
  }

  if (period === "week") {
    const monday = startOfWeekMondayJst(ymd);
    const start = utcDateFromJst(monday.y, monday.m, monday.d, 5, 0);
    const end = addDaysUtc(start, 7);
    return { startUtc: start.toISOString(), endUtc: end.toISOString() };
  }

  // month
  const start = utcDateFromJst(ymd.y, ymd.m, 1, 5, 0);
  const nextY = ymd.m === 12 ? ymd.y + 1 : ymd.y;
  const nextM = ymd.m === 12 ? 1 : ymd.m + 1;
  const end = utcDateFromJst(nextY, nextM, 1, 5, 0);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

export function todayYmdJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatJst(isoUtc: string): string {
  const d = new Date(isoUtc);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const da = String(jst.getUTCDate()).padStart(2, "0");
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${y}/${m}/${da} ${hh}:${mm}`;
}
