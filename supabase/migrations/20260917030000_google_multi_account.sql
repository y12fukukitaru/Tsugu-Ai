-- =============================================================
-- Googleカレンダーを、1人につき複数のアカウントとつなげるようにする
-- ---------------------------------------------------------------
--  「個人のアカウントと会社のアカウント、両方つなぎたい」に応えます。
--
--  ■ 考えかた
--
--    ・つながりの表（google_cal_links）を「1人1行」から「1人に何行でも」に
--    ・Google → TsuguAi は、つないだアカウント**全部**から取り込む
--      （アカウントごとに「取り込む／取り込まない」を選べる）
--    ・TsuguAi → Google は、**送り先を一つ**決めて、そこにだけ送る
--      （両方に送ると、同じ予定が二つのカレンダーに出て散らかります）
--    ・送り先を変えても、すでに送った予定はそのまま。新しい予定から
--      新しい送り先に出ます（片方から消して片方に作り直す、はしません。
--      消し損ねが残るより、変えないほうが確かです）
--
--  ■ 予定には「どのアカウントから来たか」を持たせる（link_id）
--
--    解除したとき、そのアカウントの予定だけを消すためです。
--
--  ■ 前回、画面から直していただいた二つを、ここに記録として残す
--
--    ・一意の索引を「条件なし」に作り直す（条件つきだと upsert が使えず、
--      取り込みが黙って失敗していました）
--    ・古い札（syncToken）を捨てる
--    どちらも、もう一度流しても害はありません。
--
--  確かめかた：つながりの主キー=id、送り先が二つある人=0、関数=8、
--             画面から鍵が読めるか=false、暗号化できるか=true
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になります。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 予定の一意（前回の手直しを記録として残す）
-- ---------------------------------------------------------------
--  PostgREST の upsert（onConflict）は、条件つきの索引を使えません。
--  条件なしでも、google_id が空の行どうしはぶつかりません
--  （空は空と等しくない、という決まりがあります）。
drop index if exists public.agenda_events_google_uniq;
create unique index if not exists agenda_events_google_uniq
  on public.agenda_events (owner_id, google_id);


-- ---------------------------------------------------------------
-- ② つながりの表を「1人に複数」へ
-- ---------------------------------------------------------------
alter table public.google_cal_links
  add column if not exists id          uuid    not null default gen_random_uuid(),
  add column if not exists push_target boolean not null default false;

--  主キーを user_id から id へ付け替える（まだ user_id のときだけ）
do $do$
declare v_pk text;
begin
  select string_agg(a.attname, ',') into v_pk
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
   where c.conrelid = 'public.google_cal_links'::regclass and c.contype = 'p';
  if v_pk = 'user_id' then
    alter table public.google_cal_links drop constraint google_cal_links_pkey;
    alter table public.google_cal_links add primary key (id);
  elsif v_pk is null then
    alter table public.google_cal_links add primary key (id);
  end if;
end $do$;

--  アカウント名が空の行は '' にそろえる（空どうしを同じものとして扱うため）
update public.google_cal_links set google_email = '' where google_email is null;
alter table public.google_cal_links alter column google_email set default '';

--  同じアカウントを二度つながない（つなぎ直しは同じ行に上書き）
create unique index if not exists google_cal_links_user_email_uniq
  on public.google_cal_links (user_id, google_email);
create index if not exists google_cal_links_user
  on public.google_cal_links (user_id);

--  送り先は1人に一つだけ
create unique index if not exists google_cal_links_target_uniq
  on public.google_cal_links (user_id) where push_target;

--  いまつながっている方は、その行を送り先にする（いちばん古い行を一つ）
update public.google_cal_links l
   set push_target = true
  from (select distinct on (user_id) id, user_id
          from public.google_cal_links order by user_id, created_at) f
 where l.id = f.id
   and not exists (select 1 from public.google_cal_links t
                    where t.user_id = l.user_id and t.push_target);

comment on column public.google_cal_links.push_target is
  'TsuguAiで入れた予定の送り先。1人に一つだけ true';


-- ---------------------------------------------------------------
-- ③ 予定に「どのアカウントか」を持たせる
-- ---------------------------------------------------------------
alter table public.agenda_events add column if not exists link_id uuid;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'agenda_events_link_id_fkey') then
    alter table public.agenda_events
      add constraint agenda_events_link_id_fkey
      foreign key (link_id) references public.google_cal_links(id) on delete set null;
  end if;
end $do$;

--  すでに Google と結び付いている予定に、アカウントを書き込む。
--  つながりが一つしかない方だけ（二つある方は、どちらか分からない）
update public.agenda_events e
   set link_id = l.id
  from public.google_cal_links l
 where e.owner_id = l.user_id
   and e.google_id is not null
   and e.link_id is null
   and (select count(*) from public.google_cal_links x where x.user_id = l.user_id) = 1;

comment on column public.agenda_events.link_id is
  'どのGoogleアカウントと結び付いているか（google_cal_links.id）。解除のとき、そのぶんだけ消すため';


-- ---------------------------------------------------------------
-- ④ 鍵をしまう・取り出す（Edge Function からだけ呼ぶ）
-- ---------------------------------------------------------------
--  同じアカウントなら上書き、新しいアカウントなら行を足す。
--  返すのは行の番号（Edge Function が短い鍵を入れるのに使う）。
--  返す型が変わるので、作り直します。
drop function if exists public.google_link_save(uuid, text, text);
create function public.google_link_save(
  p_user uuid, p_email text, p_refresh text)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
  v_has_target boolean;
begin
  select exists (select 1 from public.google_cal_links
                  where user_id = p_user and push_target) into v_has_target;

  insert into public.google_cal_links (user_id, google_email, refresh_enc, push_target, updated_at)
  values (p_user, coalesce(p_email, ''),
          case when coalesce(p_refresh,'') = '' then null
               else pgp_sym_encrypt(p_refresh, public.google_key()) end,
          --  はじめてのアカウントなら、そのまま送り先になる
          not v_has_target,
          now())
  on conflict (user_id, google_email) do update
    set --  つなぎ直しのとき、Google は更新用の鍵を返さないことがあります。
        --  そのときは前のものを残します（消すとつながらなくなる）
        refresh_enc  = coalesce(excluded.refresh_enc, public.google_cal_links.refresh_enc),
        --  同じアカウントなので、札（syncToken）はそのまま差分で続けてよい
        last_error   = null,
        updated_at   = now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.google_link_save(uuid, text, text) from public, anon, authenticated;
comment on function public.google_link_save(uuid, text, text) is
  'Googleとのつながりを保存する。同じアカウントなら上書き、新しければ行を足す。行の番号を返す';

--  取り出しは「つながりの番号」で（引数の名前が変わるので作り直し）
drop function if exists public.google_refresh_get(uuid);
create function public.google_refresh_get(p_link uuid)
returns text
language plpgsql security definer stable set search_path = public, extensions as $$
declare v bytea;
begin
  select refresh_enc into v from public.google_cal_links where id = p_link;
  if v is null then return null; end if;
  return pgp_sym_decrypt(v, public.google_key());
end $$;
revoke all on function public.google_refresh_get(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------
-- ⑤ 画面に返すのは「つながっているか」と、アカウントの一覧だけ
-- ---------------------------------------------------------------
--  鍵そのものは絶対に返しません。
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
                 'last_error',   g.last_error)
               order by g.created_at)
          from public.google_cal_links g where g.user_id = auth.uid()), '[]'::jsonb))
  end;
$$;
revoke all on function public.google_cal_status() from public, anon;
grant execute on function public.google_cal_status() to authenticated;

--  取り込むかの切り替え（アカウントごと・本人だけ）
drop function if exists public.google_cal_set_private(boolean);
create function public.google_cal_set_private(p_link uuid, p_on boolean)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 'error: ログインが必要です'; end if;
  update public.google_cal_links
     set pull_private = coalesce(p_on, true), updated_at = now()
   where id = p_link and user_id = auth.uid();
  if not found then return 'error: そのつながりはありません'; end if;
  return 'ok';
end $$;
revoke all on function public.google_cal_set_private(uuid, boolean) from public, anon;
grant execute on function public.google_cal_set_private(uuid, boolean) to authenticated;

--  送り先を決める（本人だけ。前の送り先は自動で外れる）
create or replace function public.google_cal_set_target(p_link uuid)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 'error: ログインが必要です'; end if;
  if not exists (select 1 from public.google_cal_links
                  where id = p_link and user_id = auth.uid()) then
    return 'error: そのつながりはありません';
  end if;
  --  先に外してから付ける（同時に二つにならないように）
  update public.google_cal_links set push_target = false, updated_at = now()
   where user_id = auth.uid() and push_target;
  update public.google_cal_links set push_target = true, updated_at = now()
   where id = p_link;
  return 'ok';
end $$;
revoke all on function public.google_cal_set_target(uuid) from public, anon;
grant execute on function public.google_cal_set_target(uuid) to authenticated;

--  連携を切る（アカウントごと・本人だけ）。そのアカウントから取り込んだ
--  予定も一緒に消します。こちらで作った予定は残します。
drop function if exists public.google_cal_unlink();
create function public.google_cal_unlink(p_link uuid)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 'error: ログインが必要です'; end if;
  if not exists (select 1 from public.google_cal_links
                  where id = p_link and user_id = auth.uid()) then
    return 'error: そのつながりはありません';
  end if;
  delete from public.agenda_events
   where owner_id = auth.uid() and source = 'google'
     and (link_id = p_link or link_id is null);
  update public.agenda_events
     set google_id = null, google_etag = null, synced_at = null, link_id = null
   where owner_id = auth.uid() and (link_id = p_link or (link_id is null and google_id is not null));
  delete from public.google_cal_links where id = p_link;
  --  送り先が無くなったら、残っている中でいちばん古いものに引き継ぐ
  if not exists (select 1 from public.google_cal_links
                  where user_id = auth.uid() and push_target) then
    update public.google_cal_links set push_target = true, updated_at = now()
     where id = (select id from public.google_cal_links
                  where user_id = auth.uid() order by created_at limit 1);
  end if;
  return 'ok';
end $$;
revoke all on function public.google_cal_unlink(uuid) from public, anon;
grant execute on function public.google_cal_unlink(uuid) to authenticated;


-- ---------------------------------------------------------------
-- ⑥ 古い札を一度捨てる（前回の手直しを記録として残す）
-- ---------------------------------------------------------------
--  次の同期は日付を区切った取り方から始まり、link_id も入り直します。
update public.google_cal_links set sync_token = null where sync_token is not null;


-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select string_agg(a.attname, ',')
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.google_cal_links'::regclass and c.contype = 'p')  as つながりの主キー,
  (select count(*) from (select user_id from public.google_cal_links
                          where push_target group by user_id having count(*) > 1) x)::text as 送り先が二つある人,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('google_cal_status','google_cal_unlink','google_cal_set_private',
                        'google_cal_set_target','google_link_save','google_refresh_get',
                        'google_key','crypto_ok'))::text                          as 関数,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'agenda_events'
      and column_name = 'link_id')::text                                          as 予定のアカウント列,
  (select has_table_privilege('authenticated','public.google_cal_links','select'))::text as 画面から鍵が読めるか,
  public.crypto_ok()::text                                                        as 暗号化できるか;
-- 期待：つながりの主キー=id、送り先が二つある人=0、関数=8、予定のアカウント列=1、
--       画面から鍵が読めるか=false、暗号化できるか=true
