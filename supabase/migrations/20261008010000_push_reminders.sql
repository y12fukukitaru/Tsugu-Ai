-- =============================================================
-- 予定とTODOのスマホ通知（アプリ版＝ホーム画面に追加したアプリへのプッシュ）
-- ---------------------------------------------------------------
--  これまでプッシュ通知で届いていたのは、毎朝の継ナビくんのブリーフだけでした。
--  予定の直前や、TODO の期限の時刻には何も来ない。
--  アプリを開いていなければ、予定もTODOも思い出せないままになります。
--
--  ■ 何が届くか（Edge Function push-reminders が5分ごとに見て送る）
--    ・予定（継ナビくんの予定タブ・面談）……開始の 10／30／60 分前（既定30分）
--    ・TODO（期限の時刻があるもの）……期限の時刻に
--    ・終日の予定と、時刻のない今日のTODO……朝8時（日本時間）にまとめて1通
--
--  ■ この SQL がすること
--    ① notify_prefs     ……ひとりずつの通知の設定（本人だけが読み書き）
--    ② push_reminder_log……送った記録。同じ通知を二度送らないための控え
--                          （service role だけが使う。画面からは見えない）
--    ③ 5分ごとの呼び出し（pg_cron）
--       URL と合言葉（CRON_SECRET）は、毎朝のブリーフ（agent-heartbeat-daily）
--       に登録済みのものをそのまま写します。合言葉をここに書き写す必要は
--       ありません（画面やチャットに貼らずに済むように）。
--
--  確かめかた（いちばん下）：表=2、呼び出し=1 が出れば完了
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--   先に Edge Function「push-reminders」をデプロイしておくこと（Verify JWT はオフ）
-- =============================================================

-- ① 通知の設定 ------------------------------------------------
create table if not exists public.notify_prefs (
  user_id          uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  --  予定の通知。何分前に知らせるか
  event_on         boolean  not null default true,
  event_before_min smallint not null default 30 check (event_before_min in (10, 30, 60)),
  --  TODO の通知（期限の時刻に／時刻のないものは朝8時のまとめに）
  todo_on          boolean  not null default true,
  updated_at       timestamptz not null default now()
);

alter table public.notify_prefs enable row level security;
grant select, insert, update on public.notify_prefs to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.notify_prefs to service_role';
  end if;
end $do$;

drop policy if exists "notify prefs own" on public.notify_prefs;
create policy "notify prefs own" on public.notify_prefs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.notify_prefs_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists notify_prefs_touch on public.notify_prefs;
create trigger notify_prefs_touch before update on public.notify_prefs
  for each row execute function public.notify_prefs_touch();

comment on table public.notify_prefs is
  '予定・TODOのスマホ通知の設定。行が無い人は既定（予定は30分前・TODOは知らせる）';

-- ② 送った記録 ------------------------------------------------
--  (誰に・何の通知・どの予定/TODO・いつの分) が同じなら二度送らない。
--  予定の時刻を変えたときは fire_at が変わるので、新しい時刻でまた届く。
create table if not exists public.push_reminder_log (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references auth.users(id) on delete cascade,
  kind     text not null,          -- event / meeting / todo / morning
  ref_id   text not null,          -- 予定・TODO の id（朝のまとめは日付）
  fire_at  timestamptz not null,   -- 知らせるはずだった時刻
  sent_at  timestamptz not null default now(),
  unique (user_id, kind, ref_id, fire_at)
);
create index if not exists push_reminder_log_sent_idx on public.push_reminder_log (sent_at);

alter table public.push_reminder_log enable row level security;
--  画面からは使わない。ポリシーを置かないので、ログインした方からは読めない
revoke all on public.push_reminder_log from anon, authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.push_reminder_log to service_role';
  end if;
end $do$;

-- ③ 5分ごとの呼び出し -----------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $do$
declare
  c text;
begin
  if exists (select 1 from cron.job where jobname = 'push-reminders') then
    raise notice 'push-reminders はすでに登録済みです（そのままにします）';
    return;
  end if;
  select command into c from cron.job where jobname = 'agent-heartbeat-daily';
  if c is null then
    raise exception '毎朝のブリーフ（agent-heartbeat-daily）が見つかりません。先に 20260807000000_agent_insights.sql を流してください';
  end if;
  if position('/functions/v1/agent-heartbeat' in c) = 0 or position('<CRON_SECRET>' in c) > 0 or position('<PROJECT-REF>' in c) > 0 then
    raise exception '毎朝のブリーフの呼び出しに URL か合言葉が入っていません。そちらを先に直してください';
  end if;
  c := replace(c, '/functions/v1/agent-heartbeat', '/functions/v1/push-reminders');
  perform cron.schedule('push-reminders', '*/5 * * * *', c);
end
$do$;

-- 確かめる -----------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in ('notify_prefs', 'push_reminder_log')) as "表",
  (select count(*) from cron.job where jobname = 'push-reminders')                      as "呼び出し";
