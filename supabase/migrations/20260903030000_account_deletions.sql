-- =============================================================
-- アカウント削除の記録
-- ---------------------------------------------------------------
--  削除すると、その方の profiles ごと消える。消えたあとに
--  「いつ、誰が、どなたを消したのか」を確かめる手立てが何も残らない。
--  取り消せない操作だからこそ、記録のほうは残す。
--
--  だからこの表は auth.users を参照しない（外部キーを張らない）。
--  張ると、削除と同時にこの記録まで消えてしまう。
--  代わりに、消す直前の姿を写し取って持っておく。
--
--  書き込むのは Edge Function（admin-delete-user）だけ。
--  service_role で書くので RLS は素通りする。ここでは読む権限だけ決める。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           一度だけ。二度流しても壊れない。
-- =============================================================

create table if not exists public.account_deletions (
  id                uuid primary key default gen_random_uuid(),
  --  消えた方の id。外部キーは張らない（張ると記録ごと消える）
  deleted_user_id   uuid not null,
  --  消す直前の姿。あとから人が読んで分かるように、名前も控える
  email             text,
  company_name      text,
  contact_name      text,
  role              text,
  consultant_id     uuid,
  consultant_email  text,
  --  どのご依頼にもとづく削除か。ご依頼なしの削除も記録する
  cancel_request_id uuid,
  reason            text,
  --  誰が消したか
  deleted_by        uuid,
  deleted_by_email  text,
  deleted_at        timestamptz not null default now()
);

create index if not exists account_deletions_at_idx
  on public.account_deletions (deleted_at desc);

alter table public.account_deletions enable row level security;

-- ---- 権限（grant）----
--  Supabase では既定で authenticated / service_role に権限が付くよう
--  設定されているが、それに頼ると、その設定が変わった日に黙って動かなくなる。
--  この SQL だけで完結するよう、必要なぶんを明示しておく。
--  実際に何が見えるかは、この下の RLS が決める。
--  読むだけ。書き込みの権限は与えない（書くのは service_role の Edge Function だけ）
grant select on public.account_deletions to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.account_deletions to service_role';
  end if;
end $do$;


-- ---- 運営だけが読める ----
--  書き込みの権限は誰にも与えない。service_role だけが書く
drop policy if exists "account_deletions admin read" on public.account_deletions;
create policy "account_deletions admin read" on public.account_deletions
  for select to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin'));

comment on table public.account_deletions is
  '削除したアカウントの控え。取り消せない操作なので、消える前の姿を残す';


-- ---------------------------------------------------------------
-- 確認（Run のあとに、これだけ見れば十分）
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='account_deletions')        as 表,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='account_deletions')           as 権限の本数,
  (select count(*) from information_schema.table_constraints
    where table_schema='public' and table_name='account_deletions'
      and constraint_type='FOREIGN KEY')                                   as 外部キー;
--  期待値：表=1、権限の本数=1、外部キー=0
--  外部キーが 0 であることが大事。1本でもあると、削除と一緒に記録が消える
-- =============================================================
