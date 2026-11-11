-- ============================================================
-- raid_daily_stats セットアップ
-- Supabase SQL エディタで上から順に実行してください
-- ============================================================

-- ------------------------------------------------------------
-- 1. テーブル作成
-- ------------------------------------------------------------

-- 投稿者ごとの日次集計
CREATE TABLE IF NOT EXISTS raid_stats_poster_daily (
  group_id       UUID    NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  stat_date      DATE    NOT NULL,   -- JST 05:00 起算の "集計日"
  sender_user_id TEXT    NOT NULL,
  user_name      TEXT,
  post_count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, stat_date, sender_user_id)
);
CREATE INDEX IF NOT EXISTS idx_rspd_group_date ON raid_stats_poster_daily(group_id, stat_date);

-- バトルごとの日次集計
CREATE TABLE IF NOT EXISTS raid_stats_battle_daily (
  group_id   UUID    NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  stat_date  DATE    NOT NULL,
  battle_key TEXT    NOT NULL,
  post_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, stat_date, battle_key)
);
CREATE INDEX IF NOT EXISTS idx_rsbd_group_date ON raid_stats_battle_daily(group_id, stat_date);

-- ------------------------------------------------------------
-- 2. 集計関数
--    JST "集計日" D = [D 05:00 JST, D+1 05:00 JST)
--    UTC では  [(D-1) 20:00 UTC, D 20:00 UTC)
--    → (created_at + 4h)::date = stat_date
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION aggregate_raids_daily(target_date DATE DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  d        DATE        := COALESCE(target_date, (NOW() AT TIME ZONE 'Asia/Tokyo')::date - 1);
  d_start  TIMESTAMPTZ := (d::timestamp AT TIME ZONE 'UTC') - INTERVAL '4 hours';
  d_end    TIMESTAMPTZ := d_start + INTERVAL '24 hours';
BEGIN
  -- 投稿者集計 (user_name は当日最後のものを採用)
  INSERT INTO raid_stats_poster_daily (group_id, stat_date, sender_user_id, user_name, post_count)
  SELECT
    group_id,
    d,
    sender_user_id,
    MAX(user_name),
    COUNT(*)::integer
  FROM raids
  WHERE created_at >= d_start AND created_at < d_end
    AND sender_user_id IS NOT NULL
  GROUP BY group_id, sender_user_id
  ON CONFLICT (group_id, stat_date, sender_user_id)
  DO UPDATE SET
    post_count = EXCLUDED.post_count,
    user_name  = EXCLUDED.user_name;

  -- バトル集計
  INSERT INTO raid_stats_battle_daily (group_id, stat_date, battle_key, post_count)
  SELECT
    group_id,
    d,
    COALESCE(NULLIF(TRIM(battle_name), ''), NULLIF(TRIM(boss_name), ''), '(unknown)') AS battle_key,
    COUNT(*)::integer
  FROM raids
  WHERE created_at >= d_start AND created_at < d_end
  GROUP BY group_id, battle_key
  ON CONFLICT (group_id, stat_date, battle_key)
  DO UPDATE SET post_count = EXCLUDED.post_count;
END;
$$;

-- ------------------------------------------------------------
-- 3. 全期間バックフィル関数
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION backfill_all_raid_stats()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  d DATE;
BEGIN
  FOR d IN
    SELECT DISTINCT (created_at + INTERVAL '4 hours')::date
    FROM raids
    ORDER BY 1
  LOOP
    PERFORM aggregate_raids_daily(d);
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 4. ランキング取得 RPC (日次stats + 当日ライブデータの合算)
-- ------------------------------------------------------------

-- 4-a. 投稿者ランキング
CREATE OR REPLACE FUNCTION get_poster_rankings_hist(
  p_from_utc TIMESTAMPTZ,
  p_to_utc   TIMESTAMPTZ,
  p_group    TEXT    DEFAULT NULL,
  p_limit    INTEGER DEFAULT 10
)
RETURNS TABLE(sender_user_id TEXT, user_name TEXT, post_count BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
  v_group_id  UUID;
  v_today     DATE := (NOW() + INTERVAL '4 hours')::date;
  v_from_date DATE := (p_from_utc + INTERVAL '4 hours')::date;
  v_to_date   DATE := ((p_to_utc - INTERVAL '1 second') + INTERVAL '4 hours')::date;
BEGIN
  IF p_group IS NULL OR p_group = '' THEN
    v_group_id := NULL;
  ELSIF p_group ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_group_id := p_group::UUID;
  ELSE
    SELECT g.id INTO v_group_id FROM groups g WHERE g.name = p_group LIMIT 1;
  END IF;

  RETURN QUERY
  WITH hist AS (
    SELECT s.sender_user_id AS uid, s.user_name AS uname, SUM(s.post_count)::BIGINT AS cnt
    FROM raid_stats_poster_daily s
    WHERE (v_group_id IS NULL OR s.group_id = v_group_id)
      AND s.stat_date >= v_from_date AND s.stat_date <= v_to_date
      AND s.stat_date < v_today
    GROUP BY s.sender_user_id, s.user_name
  ),
  live AS (
    SELECT r.sender_user_id AS uid, r.user_name AS uname, COUNT(*)::BIGINT AS cnt
    FROM raids r
    WHERE (v_group_id IS NULL OR r.group_id = v_group_id)
      AND r.created_at >= p_from_utc AND r.created_at < p_to_utc
      AND (r.created_at + INTERVAL '4 hours')::date = v_today
      AND v_today >= v_from_date AND v_today <= v_to_date
    GROUP BY r.sender_user_id, r.user_name
  ),
  combined AS (
    SELECT uid, uname, cnt FROM hist
    UNION ALL
    SELECT uid, uname, cnt FROM live
  )
  SELECT
    c.uid::TEXT,
    (array_agg(c.uname ORDER BY LENGTH(COALESCE(c.uname,'')) DESC NULLS LAST))[1]::TEXT,
    SUM(c.cnt)::BIGINT
  FROM combined c
  GROUP BY c.uid
  ORDER BY SUM(c.cnt) DESC
  LIMIT p_limit;
END;
$$;

-- 4-b. バトルランキング
CREATE OR REPLACE FUNCTION get_battle_rankings_hist(
  p_from_utc TIMESTAMPTZ,
  p_to_utc   TIMESTAMPTZ,
  p_group    TEXT    DEFAULT NULL,
  p_limit    INTEGER DEFAULT 10
)
RETURNS TABLE(battle_name TEXT, post_count BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
  v_group_id  UUID;
  v_today     DATE := (NOW() + INTERVAL '4 hours')::date;
  v_from_date DATE := (p_from_utc + INTERVAL '4 hours')::date;
  v_to_date   DATE := ((p_to_utc - INTERVAL '1 second') + INTERVAL '4 hours')::date;
BEGIN
  IF p_group IS NULL OR p_group = '' THEN
    v_group_id := NULL;
  ELSIF p_group ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_group_id := p_group::UUID;
  ELSE
    SELECT g.id INTO v_group_id FROM groups g WHERE g.name = p_group LIMIT 1;
  END IF;

  RETURN QUERY
  WITH hist AS (
    SELECT s.battle_key AS bkey, SUM(s.post_count)::BIGINT AS cnt
    FROM raid_stats_battle_daily s
    WHERE (v_group_id IS NULL OR s.group_id = v_group_id)
      AND s.stat_date >= v_from_date AND s.stat_date <= v_to_date
      AND s.stat_date < v_today
    GROUP BY s.battle_key
  ),
  live AS (
    SELECT
      COALESCE(NULLIF(TRIM(r.battle_name), ''), NULLIF(TRIM(r.boss_name), ''), '(unknown)') AS bkey,
      COUNT(*)::BIGINT AS cnt
    FROM raids r
    WHERE (v_group_id IS NULL OR r.group_id = v_group_id)
      AND r.created_at >= p_from_utc AND r.created_at < p_to_utc
      AND (r.created_at + INTERVAL '4 hours')::date = v_today
      AND v_today >= v_from_date AND v_today <= v_to_date
    GROUP BY COALESCE(NULLIF(TRIM(r.battle_name), ''), NULLIF(TRIM(r.boss_name), ''), '(unknown)')
  ),
  combined AS (
    SELECT bkey, cnt FROM hist
    UNION ALL
    SELECT bkey, cnt FROM live
  )
  SELECT c.bkey::TEXT, SUM(c.cnt)::BIGINT
  FROM combined c
  GROUP BY c.bkey
  ORDER BY SUM(c.cnt) DESC
  LIMIT p_limit;
END;
$$;

-- ------------------------------------------------------------
-- 5. pg_cron ジョブ登録
--    ※ Supabase の Extensions で pg_cron を有効化してから実行
-- ------------------------------------------------------------

-- 毎月1日 JST 05:30 (UTC 20:30) に全期間を一括集計
SELECT cron.schedule(
  'aggregate-raids-monthly',
  '30 20 1 * *',
  $cron$SELECT backfill_all_raid_stats()$cron$
);

-- 毎月1日 JST 05:35 (UTC 20:35) に2ヶ月超のraidsを削除（集計の5分後）
SELECT cron.schedule(
  'delete-old-raids',
  '35 20 1 * *',
  $cron$DELETE FROM raids WHERE created_at < NOW() - INTERVAL '2 months'$cron$
);

-- ------------------------------------------------------------
-- 6. 既存データのバックフィル (初回のみ実行)
-- ------------------------------------------------------------
SELECT backfill_all_raid_stats();
