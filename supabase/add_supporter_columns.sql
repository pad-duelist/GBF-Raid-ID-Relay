-- サポーター遷移モード用カラム
-- Supabase の SQL Editor で実行してください（未実行でも既存機能は従来どおり動きます）
--
-- 生成するURL:
--   https://game.granbluefantasy.jp/#quest/supporter_raid/{raid_internal_id}/{quest_id}/{supporter_suffix}
--   例) raid_internal_id=47207450449, quest_id=303141, supporter_suffix=1/5/0/7

alter table public.raids
  add column if not exists raid_internal_id text,
  add column if not exists quest_id text,
  add column if not exists supporter_suffix text;

-- PostgREST のスキーマキャッシュを即時更新
notify pgrst, 'reload schema';
