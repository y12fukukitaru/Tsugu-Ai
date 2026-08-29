-- =============================================================
-- プロアクティブAIエージェント: agent_insights テーブル
-- AI（agent-heartbeat）が生成した「働きかけ」を貯め、
-- アプリ内（通知センター / AI秘書）・メール・LINEへ配信する土台。
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて実行
-- =============================================================

create table if not exists public.agent_insights (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  customer_id uuid,                          -- 対象顧客（全体ブリーフはnull）
  kind        text not null,                 -- 'daily_brief' | 'meeting_prep' | 'silence' | 'report_draft' | 'subsidy' | 'succession' | 'cashflow'
  title       text not null,                 -- 一覧に出す短い見出し
  body        text not null,                 -- 本文（根拠と「最初の一言」を含む）
  reason      text,                          -- 検出根拠（例: 試算表が2ヶ月未入力）
  priority    int  not null default 2,       -- 1=至急 2=今日中 3=今週
  status      text not null default 'unread',-- 'unread' | 'read' | 'done' | 'dismissed'
  feedback    text,                          -- 'useful' | 'not_needed'（生成品質の改善に使う）
  created_at  timestamptz not null default now()
);

create index if not exists agent_insights_user_idx
  on public.agent_insights (user_id, status, created_at desc);

alter table public.agent_insights enable row level security;

-- 本人だけが読める・状態更新できる。生成（insert）はservice roleのみ。
drop policy if exists "own insights: select" on public.agent_insights;
create policy "own insights: select" on public.agent_insights
  for select using (auth.uid() = user_id);

drop policy if exists "own insights: update status/feedback" on public.agent_insights;

create policy "own insights: update status/feedback" on public.agent_insights
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =============================================================
-- 定期実行: pg_cron + pg_net で agent-heartbeat を毎朝6:00 JSTに起動
-- ※ <PROJECT-REF> と <CRON_SECRET> を自環境の値に書き換えてから実行。
--    CRON_SECRET は Edge Function 側の Secret と同じ値にすること。
--
-- ※※ 下の登録は「まだ無いときだけ」行う。ここを素通しにすると、この
--     ファイルをもう一度流したときに、動いている設定を穴埋めのままの
--     URL（<PROJECT-REF>）で上書きしてしまい、毎朝の配信が止まる。
--     掃除のほうも、あとから 20260825000000 で14日に縮めた設定を
--     90日へ巻き戻してしまう。
-- =============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 6:00 JST = 21:00 UTC（前日）
do $do$
begin
  if not exists (select 1 from cron.job where jobname = 'agent-heartbeat-daily') then
    perform cron.schedule(
      'agent-heartbeat-daily',
      '0 21 * * *',
      $$
      select net.http_post(
        url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/agent-heartbeat',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', '<CRON_SECRET>'
        ),
        body    := '{}'::jsonb
      );
      $$
    );
  end if;
end
$do$;

-- 古い提案の掃除（この時点では90日・毎週日曜。20260825000000 で14日・毎日に変更）
do $do$
begin
  if not exists (select 1 from cron.job where jobname = 'agent-insights-cleanup') then
    perform cron.schedule(
      'agent-insights-cleanup',
      '0 18 * * 0',
      $$ delete from public.agent_insights where created_at < now() - interval '90 days'; $$
    );
  end if;
end
$do$;
