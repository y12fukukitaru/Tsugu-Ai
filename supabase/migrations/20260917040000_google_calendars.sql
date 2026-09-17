-- =============================================================
-- Googleの「他のカレンダー」も取り込めるようにする（カレンダーごとに選ぶ）
-- ---------------------------------------------------------------
--  これまで取り込んでいたのは、各アカウントの**メインカレンダーだけ**でした。
--  Google の画面左に並ぶ「家族」「誕生日」「共有されたカレンダー」
--  「日本の祝日」などは別のカレンダーなので、入っていませんでした。
--
--  ■ 考えかた
--
--    ・アカウントごとに、そのアカウントが持つカレンダーの一覧を持つ
--      （google_calendars。同期のたびに Google から取り直して合わせる）
--    ・**メインカレンダーだけ最初からオン**、ほかはオフ。
--      祝日や誕生日を勝手に入れると、週表示が一気に読めなくなります。
--      要るものだけ、本人がチェックを入れる
--    ・差分の札（syncToken）は**カレンダーごと**に持つ。
--      アカウントに一つでは、二つ目のカレンダーから通じません
--    ・TsuguAi で入れた予定の送り先は、これまでどおりメインカレンダー。
--      購読しているだけのカレンダーには書き込めません
--
--  ■ 予定には「どのカレンダーから来たか」を持たせる（cal_id）
--
--    チェックを外したとき、そのカレンダーの予定だけを消すためです。
--
--  ■ TsuguAi 自身の購読（旧・ICS）は一覧に出さない
--
--    Google 側に旧来の「見るだけ」の購読が残っていると、TsuguAi の
--    予定が Google 経由で TsuguAi に戻ってきて、際限なく増えます。
--    Edge Function 側で、その購読は一覧から外し、その予定も取り込みません。
--
--  確かめかた：カレンダーの表=1、予定のカレンダー列=1、関数=3、
--             画面から一覧の表が読めるか=false、札が残っている行=0
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になります。
-- =============================================================

-- ---------------------------------------------------------------
-- ① アカウントごとのカレンダーの一覧
-- ---------------------------------------------------------------
create table if not exists public.google_calendars (
  link_id    uuid    not null references public.google_cal_links(id) on delete cascade,
  cal_id     text    not null,                    -- Google 側の番号（メインは通常メールアドレス）
  name       text    not null default '',
  is_primary boolean not null default false,
  enabled    boolean not null default false,      -- 取り込むか（メインだけ最初から true）
  sync_token text,                                -- 差分の札。カレンダーごと
  color      text,                                -- Google 側の色（画面の目印に）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (link_id, cal_id)
);

alter table public.google_calendars enable row level security;
--  画面からは触らせません。一覧は google_cal_status() が返します
revoke all on public.google_calendars from authenticated, anon, public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.google_calendars to service_role';
  end if;
end $$;

comment on table public.google_calendars is
  'Googleアカウントごとのカレンダーの一覧と、取り込むかどうか。同期のたびに Google と合わせる';


-- ---------------------------------------------------------------
-- ② 予定に「どのカレンダーか」を持たせる
-- ---------------------------------------------------------------
alter table public.agenda_events add column if not exists cal_id text;
comment on column public.agenda_events.cal_id is
  'どのGoogleカレンダーから来たか（google_calendars.cal_id）。チェックを外したとき、そのぶんだけ消すため';

--  札はカレンダーごとに持つようになるので、アカウントの札は捨てる。
--  次の同期は日付を区切った取り方から始まり、cal_id も入り直します
update public.google_cal_links set sync_token = null where sync_token is not null;


-- ---------------------------------------------------------------
-- ③ 一覧を Google と合わせる（Edge Function からだけ呼ぶ）
-- ---------------------------------------------------------------
--  新しく見つかったカレンダーは足す（メインだけオン、ほかはオフ）。
--  すでにあるものは名前と色だけ直し、**オン／オフと札は触らない**。
--  Google 側で無くなったものは、その予定ごと消す。
create or replace function public.google_cal_list_merge(p_link uuid, p_items jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  select user_id into v_user from public.google_cal_links where id = p_link;
  if v_user is null then return; end if;

  insert into public.google_calendars (link_id, cal_id, name, is_primary, color, enabled, updated_at)
  select p_link, x.id, coalesce(x.name, ''), coalesce(x.is_primary, false), x.color,
         coalesce(x.is_primary, false),   -- はじめて見つけたとき：メインだけオン
         now()
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
           as x(id text, name text, is_primary boolean, color text)
   where coalesce(x.id, '') <> ''
  on conflict (link_id, cal_id) do update
    set name       = excluded.name,
        is_primary = excluded.is_primary,
        color      = excluded.color,
        updated_at = now();

  --  Google 側で無くなったカレンダー：その予定を消してから、行を消す
  delete from public.agenda_events e
   where e.owner_id = v_user and e.link_id = p_link and e.source = 'google'
     and e.cal_id is not null
     and not exists (select 1 from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(id text)
                      where x.id = e.cal_id);
  delete from public.google_calendars c
   where c.link_id = p_link
     and not exists (select 1 from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(id text)
                      where x.id = c.cal_id);
end $$;
revoke all on function public.google_cal_list_merge(uuid, jsonb) from public, anon, authenticated;
comment on function public.google_cal_list_merge(uuid, jsonb) is
  'カレンダーの一覧を Google と合わせる。オン／オフと札は触らない';


-- ---------------------------------------------------------------
-- ④ 画面に返す一覧に、カレンダーを足す
-- ---------------------------------------------------------------
create or replace function public.google_cal_status()
returns jsonb
language sql security definer stable set search_path = public as $$
  select case when auth.uid() is null then null else
    jsonb_build_object(
      'linked', exists (select 1 from public.google_cal_links g
                         where g.user_id = auth.uid() and g.refresh_enc is not null),
      'links', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id',           g.id,
                 'email',        g.google_email,
                 'linked',       (g.refresh_enc is not null),
                 'pull_private', g.pull_private,
                 'push_target',  g.push_target,
                 'last_sync_at', g.last_sync_at,
                 'last_error',   g.last_error,
                 --  そのアカウントのカレンダー。メインを先頭に、あとは名前順
                 'calendars',    coalesce((
                    select jsonb_agg(jsonb_build_object(
                             'id',      c.cal_id,
                             'name',    c.name,
                             'primary', c.is_primary,
                             'on',      c.enabled,
                             'color',   c.color)
                           order by c.is_primary desc, c.name)
                      from public.google_calendars c where c.link_id = g.id), '[]'::jsonb))
               order by g.created_at)
          from public.google_cal_links g where g.user_id = auth.uid()), '[]'::jsonb))
  end;
$$;
revoke all on function public.google_cal_status() from public, anon;
grant execute on function public.google_cal_status() to authenticated;


-- ---------------------------------------------------------------
-- ⑤ カレンダーごとの「取り込む／取り込まない」（本人だけ）
-- ---------------------------------------------------------------
--  外したときは、そのカレンダーから取り込んだ予定を消し、札も捨てる。
--  同じ予定が二つのカレンダーに出ていることがある（招待など）ので、
--  同じアカウントのほかのカレンダーの札も捨てて、次の同期で取り直す。
--  そうしないと、片方を外したときにもう片方の予定まで消えたままになる。
create or replace function public.google_cal_set_cal(p_link uuid, p_cal text, p_on boolean)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 'error: ログインが必要です'; end if;
  if not exists (select 1 from public.google_cal_links
                  where id = p_link and user_id = auth.uid()) then
    return 'error: そのつながりはありません';
  end if;
  update public.google_calendars
     set enabled = coalesce(p_on, false), updated_at = now(),
         sync_token = null            -- 入れるときも外すときも、次は取り直しから
   where link_id = p_link and cal_id = p_cal;
  if not found then return 'error: そのカレンダーはありません'; end if;

  if not coalesce(p_on, false) then
    delete from public.agenda_events
     where owner_id = auth.uid() and link_id = p_link and source = 'google'
       and cal_id = p_cal;
    --  ほかのカレンダーにも出ていた予定を、次の同期で戻すため
    update public.google_calendars set sync_token = null
     where link_id = p_link and enabled;
  end if;
  return 'ok';
end $$;
revoke all on function public.google_cal_set_cal(uuid, text, boolean) from public, anon;
grant execute on function public.google_cal_set_cal(uuid, text, boolean) to authenticated;


-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'google_calendars')::text     as カレンダーの表,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'agenda_events'
      and column_name = 'cal_id')::text                                          as 予定のカレンダー列,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('google_cal_list_merge','google_cal_set_cal','google_cal_status'))::text as 関数,
  (select has_table_privilege('authenticated','public.google_calendars','select'))::text as 画面から一覧の表が読めるか,
  (select count(*) from public.google_cal_links where sync_token is not null)::text     as 札が残っている行;
-- 期待：カレンダーの表=1、予定のカレンダー列=1、関数=3、
--       画面から一覧の表が読めるか=false、札が残っている行=0
