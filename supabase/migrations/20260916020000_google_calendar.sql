-- =============================================================
-- Googleカレンダーと、行き来できるようにする（双方向）
-- ---------------------------------------------------------------
--  これまでは ICS の購読フィード（一方通行）でした。
--
--      TsuguAi に入れた予定 → Googleに出る（数時間かかる）
--      Googleに入れた予定   → TsuguAi には出ない
--
--  これを、どちらに入れてもすぐ両方に出るようにします。
--
--  ■ 置くもの
--
--    google_cal_links … 誰がどのGoogleアカウントとつながっているか。
--                       更新用の鍵（refresh token）は暗号化して持ちます。
--                       口座情報と同じ作り（pgp_sym_encrypt ＋ Vault の鍵）です。
--                       この表は service_role だけが触れます。画面からは
--                       読むこともできません。
--
--    agenda_events に3列 … google_id（あちらの予定の番号）、
--                       source（tsugu か google か）、google_etag（版）。
--                       予定そのものは、これまでどおり本人だけが見られます。
--
--  ■ 同じ予定が二つにならないように
--
--    こちらから送った予定には google_id が入ります。あちらから取ってくる
--    ときは google_id で突き合わせるので、送ったものが戻ってきて増える、
--    ということは起きません。Google側にも印（extendedProperties）を
--    付けておき、万一この表が失われても自分のものだと分かるようにします。
--
--  ■ 私用の予定について
--
--    Googleのメインカレンダーごと取り込みます。通院や家族の用事も
--    TsuguAi に入ります。agenda_events は**本人以外は誰も読めません**
--    （運営も読めません）。この SQL でもその権限は変えていません。
--    ただし継ナビくんに「今日の予定」を聞くと、その予定も材料として
--    AI に渡ります。見られたくない予定があるときは、Google 側で
--    「非公開」ではなく、取り込まない設定（画面の「私用も取り込む」を
--    切る）でお願いします。
--
--  確かめかた：表=1、agenda_events の新しい列=3、画面から鍵が読めない=false
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になります。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 予定に、あちらの番号と出どころを持たせる
-- ---------------------------------------------------------------
alter table public.agenda_events
  add column if not exists google_id    text,
  add column if not exists google_etag  text,
  add column if not exists source       text not null default 'tsugu',
  add column if not exists synced_at    timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agenda_events_source_check') then
    alter table public.agenda_events
      add constraint agenda_events_source_check check (source in ('tsugu','google'));
  end if;
end $$;

--  同じGoogleの予定を二重に持たない
create unique index if not exists agenda_events_google_uniq
  on public.agenda_events (owner_id, google_id) where google_id is not null;

--  まだ送っていない予定を拾うため
create index if not exists agenda_events_unsynced
  on public.agenda_events (owner_id) where google_id is null;

comment on column public.agenda_events.google_id is
  'Google側の予定の番号。こちらから送ったものにも、あちらから来たものにも入る';
comment on column public.agenda_events.source is
  'tsugu＝TsuguAiで作った／google＝Googleから取り込んだ';


-- ---------------------------------------------------------------
-- ② つながりの記録（更新用の鍵は暗号化して持つ）
-- ---------------------------------------------------------------
create table if not exists public.google_cal_links (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  google_email   text,
  refresh_enc    bytea,                  -- 更新用の鍵。暗号化して持つ
  access_token   text,                   -- 1時間で切れる短いもの
  access_expires timestamptz,
  sync_token     text,                   -- 前回からの差分をもらうための札
  pull_private   boolean not null default true,   -- 私用の予定も取り込むか
  last_sync_at   timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.google_cal_links enable row level security;
--  画面からは一切触らせません。つながっているかどうかは、下の
--  google_cal_status() が「必要な分だけ」返します
revoke all on public.google_cal_links from authenticated, anon, public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.google_cal_links to service_role';
  end if;
end $$;

comment on table public.google_cal_links is
  'Googleカレンダーとのつながり。更新用の鍵は暗号化。service_role だけが触れる';


-- ---------------------------------------------------------------
-- ③ 暗号の鍵（口座情報と同じ作り。無ければここで作る）
-- ---------------------------------------------------------------
create table if not exists public.google_keys (
  id  int primary key default 1 check (id = 1),
  k   text not null,
  created_at timestamptz not null default now()
);
alter table public.google_keys enable row level security;
revoke all on public.google_keys from authenticated, anon, public;

do $do$
declare v_has_vault boolean; v_has boolean;
begin
  select exists (select 1 from pg_namespace where nspname = 'vault') into v_has_vault;
  if v_has_vault then
    begin
      execute 'select exists (select 1 from vault.secrets where name = $1)'
        into v_has using 'tsugu_google_key';
      if not v_has then
        execute 'select vault.create_secret($1, $2, $3)'
          using encode(gen_random_bytes(32), 'base64'),
                'tsugu_google_key',
                'Googleカレンダーの更新用の鍵を包む鍵。消すとつなぎ直しになります';
      end if;
      return;
    exception when others then
      null;   -- Vault の作法が違う版もある。落ちずに下の受け皿へ
    end;
  end if;
  if not exists (select 1 from public.google_keys where id = 1) then
    insert into public.google_keys (id, k) values (1, encode(gen_random_bytes(32), 'base64'));
  end if;
end $do$;

create or replace function public.google_key() returns text
language plpgsql security definer stable set search_path = public as $$
declare v text;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
      into v using 'tsugu_google_key';
  exception when others then
    v := null;
  end;
  if coalesce(v,'') = '' then
    select k into v from public.google_keys where id = 1;
  end if;
  if coalesce(v,'') = '' then
    raise exception 'Googleカレンダーの暗号鍵が見つかりません。20260916020000 の SQL をもう一度流してください';
  end if;
  return v;
end $$;
revoke all on function public.google_key() from public, anon, authenticated;


-- ---------------------------------------------------------------
-- ④ 鍵をしまう・取り出す（Edge Function からだけ呼ぶ）
-- ---------------------------------------------------------------
create or replace function public.google_link_save(
  p_user uuid, p_email text, p_refresh text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.google_cal_links (user_id, google_email, refresh_enc, updated_at)
  values (p_user, p_email,
          case when coalesce(p_refresh,'') = '' then null
               else pgp_sym_encrypt(p_refresh, public.google_key()) end,
          now())
  on conflict (user_id) do update
    set google_email = excluded.google_email,
        --  つなぎ直しのとき、Google は更新用の鍵を返さないことがあります。
        --  そのときは前のものを残します（消すとつながらなくなる）
        refresh_enc  = coalesce(excluded.refresh_enc, public.google_cal_links.refresh_enc),
        last_error   = null,
        updated_at   = now();
end $$;
revoke all on function public.google_link_save(uuid, text, text) from public, anon, authenticated;

create or replace function public.google_refresh_get(p_user uuid)
returns text
language plpgsql security definer stable set search_path = public as $$
declare v bytea;
begin
  select refresh_enc into v from public.google_cal_links where user_id = p_user;
  if v is null then return null; end if;
  return pgp_sym_decrypt(v, public.google_key());
end $$;
revoke all on function public.google_refresh_get(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------
-- ⑤ 画面に返すのは「つながっているか」だけ
-- ---------------------------------------------------------------
--  鍵そのものは絶対に返しません。出すのは、どのアカウントか・
--  いつ同期したか・私用も取り込む設定か・直近の不具合、の4つです。
create or replace function public.google_cal_status()
returns jsonb
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select jsonb_build_object(
       'linked',       (g.refresh_enc is not null),
       'email',        g.google_email,
       'pull_private', g.pull_private,
       'last_sync_at', g.last_sync_at,
       'last_error',   g.last_error)
       from public.google_cal_links g where g.user_id = auth.uid()),
    jsonb_build_object('linked', false))
  where auth.uid() is not null;
$$;
revoke all on function public.google_cal_status() from public, anon;
grant execute on function public.google_cal_status() to authenticated;

--  私用も取り込むかの切り替え（本人だけ）
create or replace function public.google_cal_set_private(p_on boolean)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 'error: ログインが必要です'; end if;
  update public.google_cal_links
     set pull_private = coalesce(p_on, true), updated_at = now()
   where user_id = auth.uid();
  if not found then return 'error: まだ連携していません'; end if;
  return 'ok';
end $$;
revoke all on function public.google_cal_set_private(boolean) from public, anon;
grant execute on function public.google_cal_set_private(boolean) to authenticated;

--  連携を切る（本人だけ）。取り込んだ予定も一緒に消します。
--  こちらで作った予定は残します（Google側に出したものは Google に残ります）
create or replace function public.google_cal_unlink()
returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 'error: ログインが必要です'; end if;
  delete from public.agenda_events
   where owner_id = auth.uid() and source = 'google';
  update public.agenda_events
     set google_id = null, google_etag = null, synced_at = null
   where owner_id = auth.uid() and google_id is not null;
  delete from public.google_cal_links where user_id = auth.uid();
  return 'ok';
end $$;
revoke all on function public.google_cal_unlink() from public, anon;
grant execute on function public.google_cal_unlink() to authenticated;


-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='google_cal_links')::text            as つながりの表,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='agenda_events'
      and column_name in ('google_id','google_etag','source','synced_at'))::text    as 予定の新しい列,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('google_cal_status','google_cal_unlink','google_cal_set_private',
                        'google_link_save','google_refresh_get','google_key'))::text as 関数,
  (select has_table_privilege('authenticated','public.google_cal_links','select'))::text as 画面から鍵が読めるか;
-- 期待：つながりの表=1、予定の新しい列=4、関数=6、画面から鍵が読めるか=false
