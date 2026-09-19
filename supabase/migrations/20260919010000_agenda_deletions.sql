-- =============================================================
-- 消した予定を、Googleカレンダーからも消す
-- ---------------------------------------------------------------
--  これまで、TsuguAi で予定を消しても Google 側には残っていました。
--
--      TsuguAi に入れる・直す → Googleに出る（すぐ）
--      TsuguAi で消す        → Googleには残ったまま ←ここ
--
--  消したことを Google に伝えられなかったのは、消した瞬間に
--  agenda_events の行ごと無くなり、「あちらの番号（google_id）」が
--  どこにも残らないからです。鍵は画面に降りてこない作りなので、
--  消すのは Edge Function（google-sync）の役目ですが、次に同期した
--  ときには何を消せばよいか分からない、という状態でした。
--
--  ■ 置くもの
--
--    agenda_deletions … 消した予定の「あちらの番号」だけを残す表。
--                       墓標（tombstone）です。中身（題名・日時・場所）は
--                       持ちません。消すのに要らないからです。
--                       次の同期で Google 側を消したら、この行も消えます。
--
--    引き金（トリガ）… agenda_events から行が消えるとき、google_id が
--                       入っていれば自動で墓標を立てます。画面のどこから
--                       消しても、運営が消しても、必ず残ります。
--
--  ■ 誰が触れるか
--
--    この表は service_role だけが触ります（画面からは読めません）。
--    墓標を立てるのは SECURITY DEFINER の関数なので、消した本人の
--    権限に関係なく必ず入ります。
--
--  ■ 墓標を立てるのは「こちらで作った予定」だけです
--
--    source='tsugu'（この画面で入れて Google に出した予定）にだけ
--    立てます。Google から取り込んだ予定（source='google'）には
--    立てません。取り込んだ予定の行は、連携を解除したときや
--    「取り込むカレンダー」のチェックを外したときにも、まとめて
--    消えます。そこで墓標を立てると、次の同期で**本物の Google の
--    予定が消えます**。祝日のチェックを外しただけで Google から
--    祝日が全部消える——そういう事故を、作りの側で起こらなくします。
--
--    取り込んだ予定をこの画面から消しても、Google 側には残ります。
--    画面の削除ボタンは、押す前にそのことをお伝えします。
--
--  確かめかた：墓標の表=1、引き金=1、画面から読めるか=false
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になります。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 墓標の表
-- ---------------------------------------------------------------
create table if not exists public.agenda_deletions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id)            on delete cascade,
  google_id  text not null,                                   -- あちらの予定の番号
  link_id    uuid references public.google_cal_links(id)        on delete cascade,
  cal_id     text,                                            -- 空ならメインカレンダー
  created_at timestamptz not null default now()
);

--  同じ予定の墓標は一つでよい
create unique index if not exists agenda_deletions_uniq
  on public.agenda_deletions (user_id, google_id);
--  古いものの掃除で使う
create index if not exists agenda_deletions_created_idx
  on public.agenda_deletions (created_at);

alter table public.agenda_deletions enable row level security;
--  画面からは触らせません。墓標は引き金が立て、Edge Function が下ろします
revoke all on public.agenda_deletions from authenticated, anon, public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.agenda_deletions to service_role';
  end if;
end $$;

comment on table public.agenda_deletions is
  '消した予定の墓標。次の同期で Google 側からも消すために番号だけ残す。service_role だけが触れる';


-- ---------------------------------------------------------------
-- ② 予定が消えたら、墓標を立てる
-- ---------------------------------------------------------------
--  SECURITY DEFINER なのは、消した本人が agenda_deletions に
--  書けないため（画面からは触れない表にしてあります）。
create or replace function public.agenda_event_deleted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  --  Google に出ていない予定は、消しても向こうに何もありません
  if old.google_id is null or old.google_id = '' then
    return old;
  end if;
  --  ★ここが肝心★ 墓標を立てるのは、こちらで作って Google に出した
  --  予定だけです（source='tsugu'）。Google から取り込んだ予定
  --  （source='google'）には立てません。取り込んだ予定の行は、
  --  連携を解除したときや「取り込むカレンダー」のチェックを外したとき
  --  にも、まとめて消えます。そこで墓標を立ててしまうと、
  --  次の同期で**本物の Google の予定が消えます**。祝日のチェックを
  --  外しただけで、Google から祝日が全部消える——そういう事故になります。
  if coalesce(old.source, 'tsugu') <> 'tsugu' then
    return old;
  end if;
  insert into public.agenda_deletions (user_id, google_id, link_id, cal_id)
  values (old.owner_id, old.google_id, old.link_id, old.cal_id)
  on conflict (user_id, google_id) do nothing;
  return old;
end $$;

--  実行権限は取り上げません。Postgres は引き金の関数にも EXECUTE を
--  見にいくので、取り上げると予定そのものが消せなくなります。
--  引き金の外から直に呼んでもエラーになるだけの関数です。

drop trigger if exists agenda_events_deleted on public.agenda_events;
create trigger agenda_events_deleted
  after delete on public.agenda_events
  for each row execute function public.agenda_event_deleted();


-- ---------------------------------------------------------------
-- ③ 確かめる
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='agenda_deletions')::text      as 墓標の表,
  (select count(*) from pg_trigger
    where tgname='agenda_events_deleted' and not tgisinternal)::text          as 引き金,
  (select has_table_privilege('authenticated','public.agenda_deletions','select'))::text as 画面から読めるか;
