-- =============================================================
-- 「今日の一手」の古い行を、実態に合わせて短く保つ
-- ---------------------------------------------------------------
--  画面に出るのは「その日に作られたぶん」だけ（日本時間で日付を切る）。
--  仕組みの側で古い行を読むのは、毎朝の二重生成を防ぐ照合だけで、
--  その窓は 0.8日 しかない。つまり数日より古い行は、誰も読まない。
--
--  これまでは 90日 ぶん・週1回の掃除だった。読まれないものを3か月
--  抱えることになるので、14日・毎日に改める。0.8日の照合に対して
--  十分な余裕を残しつつ、常に平らに保つ（週1回だと溜まっては減る）。
--
--  ※ feedback（役に立った／不要）もこの行に入っている。いまはどこからも
--    読んでいないため、消えて困るものは無い。将来この判断を提案の生成に
--    使うのであれば、その前にここの日数を見直すこと。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になる。
-- =============================================================

-- 既存の掃除をいったん外してから入れ直す（名前が同じでも設定が上書きされない環境があるため）
do $$
begin
  if exists (select 1 from cron.job where jobname = 'agent-insights-cleanup') then
    perform cron.unschedule('agent-insights-cleanup');
  end if;
end $$;

-- 毎日 03:30 JST（＝前日 18:30 UTC）に、14日より古い行を消す。
-- 朝6時の生成（21:00 UTC）とぶつからない時刻を選んでいる。
select cron.schedule(
  'agent-insights-cleanup',
  '30 18 * * *',
  $$ delete from public.agent_insights where created_at < now() - interval '14 days'; $$
);

-- いま溜まっているぶんも、この場で一度きれいにする
delete from public.agent_insights where created_at < now() - interval '14 days';


-- =============================================================
-- 確認（Run したあとに、この select だけを実行してください）
-- =============================================================
-- select jobname, schedule, active
--   from cron.job
--  where jobname in ('agent-heartbeat-daily','agent-insights-cleanup')
--  order by jobname;
--   -- agent-heartbeat-daily     0 21 * * *    t
--   -- agent-insights-cleanup    30 18 * * *   t
--   -- の2行が出れば成功です。
--
-- select count(*) as 残っている行数,
--        min(created_at) as いちばん古い
--   from public.agent_insights;
--   -- 「いちばん古い」が14日以内なら、掃除が効いています。
