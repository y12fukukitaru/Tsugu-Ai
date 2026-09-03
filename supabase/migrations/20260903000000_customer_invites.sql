-- =============================================================
-- 顧客の招待：パートナーが「先に」登録しておけるようにする
-- ---------------------------------------------------------------
--  いまは、経営者が自分で新規登録したあとでないとパートナーが紐づけられない。
--  そのため経営者は、登録した直後に「担当パートナーの登録を待っています」の
--  門で待たされ、パートナーが紐づけてから呼び戻される。顧問契約を終えた方に
--  最初にする仕打ちとしては、順序が逆立ちしている。
--
--  正しい順序はこう：
--    ① 顧問契約
--    ② パートナーが顧客管理でメールアドレスを登録（＝ここに1行入る）
--    ③ 経営者が自分で新規登録 → その瞬間に担当が付き、門は出ない
--
--  この「先に枠を作り、本人が現れたら結びつける」やり方は、顧問税理士や
--  閲覧メンバーを招くときに既に使っている（company_members.member_email）。
--  同じ考え方を顧客にも広げるもの。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           一度だけ。二度流しても壊れない（if not exists / drop policy）。
-- =============================================================

create table if not exists public.customer_invites (
  id            uuid primary key default gen_random_uuid(),
  --  招く相手。本人がこのアドレスで登録したときに結びつける
  email         text not null,
  --  招いたパートナー。この人が担当になる
  consultant_id uuid not null references auth.users(id) on delete cascade,
  --  分かっていれば入れておく。本人が登録したとき会社名の初期値になる
  company_name  text,
  --  パートナー自身の覚え書き（顧客には見えない）
  note          text,
  --  pending（登録待ち）→ claimed（結びついた）／cancelled（取り消した）
  status        text not null default 'pending'
                check (status in ('pending','claimed','cancelled')),
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  claimed_id    uuid
);

--  同じアドレスを二人のパートナーが同時に待つことはできない。
--  大文字小文字は同じものとして扱う（Gmail の表記ゆれで二重にならないように）。
--  取り消し済み・結びつき済みは対象外なので、あとから招き直せる。
create unique index if not exists customer_invites_pending_uniq
  on public.customer_invites (lower(email)) where status = 'pending';

create index if not exists customer_invites_consultant_idx
  on public.customer_invites (consultant_id, status, created_at desc);

alter table public.customer_invites enable row level security;

-- ---- 権限（grant）----
--  Supabase では既定で authenticated / service_role に権限が付くよう
--  設定されているが、それに頼ると、その設定が変わった日に黙って動かなくなる。
--  この SQL だけで完結するよう、必要なぶんを明示しておく。
--  実際に何が見えるかは、この下の RLS が決める。
grant select, insert, update on public.customer_invites to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.customer_invites to service_role';
  end if;
end $do$;


-- ---- パートナー：自分が招いたぶんだけ。他人の招待は見えない ----
drop policy if exists "customer_invites own" on public.customer_invites;
create policy "customer_invites own" on public.customer_invites
  for all to authenticated
  using (consultant_id = auth.uid())
  with check (consultant_id = auth.uid());

-- ---- 運営：全部見える。担当が未登録の方を把握するため ----
drop policy if exists "customer_invites admin" on public.customer_invites;
create policy "customer_invites admin" on public.customer_invites
  for select to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin'));

-- ---- 招かれた本人：自分宛のものだけ読める ----
--  「あなたは○○パートナーから招かれています」と画面に出すため。
--  書き換えはできない（下の claim_my_invite が代わりに行う）。
drop policy if exists "customer_invites invitee" on public.customer_invites;
create policy "customer_invites invitee" on public.customer_invites
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

comment on table public.customer_invites is
  'パートナーが先に登録しておく顧客の招待。本人が登録した瞬間に claim_my_invite が担当を付ける';


-- =============================================================
-- 本人が登録したときに、招待と結びつける
-- ---------------------------------------------------------------
--  経営者本人が呼ぶ。自分のメールアドレス宛の招待を探し、あれば
--  自分の profiles に担当パートナーを書き込む。
--
--  なぜ関数にするか：
--    経営者が自分で profiles.consultant_id を書き換えられるようにすると、
--    好きなパートナーを自分の担当だと言い張れてしまう。だから書き込みは
--    この関数の中だけで行い（security definer）、条件を関数が握る。
--
--  すでに担当がいる人には何もしない。担当の付け替えは運営の仕事。
-- =============================================================
create or replace function public.claim_my_invite()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  my_email text;
  inv      public.customer_invites%rowtype;
  cur      uuid;
begin
  if me is null then return 'error: ログインが必要です'; end if;

  select lower(coalesce(auth.jwt() ->> 'email','')) into my_email;
  if my_email = '' then return 'error: メールアドレスが取れません'; end if;

  --  すでに担当がいるなら触らない
  select consultant_id into cur from public.profiles where id = me;
  if cur is not null then return 'already'; end if;

  --  自分宛の、まだ使われていない招待。古いものから
  select * into inv from public.customer_invites
   where lower(email) = my_email and status = 'pending'
   order by created_at asc limit 1;
  if not found then return 'none'; end if;

  --  招いたパートナーが、いまもパートナーであることを確かめる
  if not exists (select 1 from public.profiles
                  where id = inv.consultant_id and role = 'consultant') then
    return 'error: 招いたパートナーが見つかりません';
  end if;

  update public.profiles
     set consultant_id = inv.consultant_id,
         --  会社名が空のときだけ、招待に書かれていたものを入れる。
         --  本人が入れた名前を、あとから上書きしない
         company_name  = coalesce(nullif(company_name,''), inv.company_name)
   where id = me;

  update public.customer_invites
     set status = 'claimed', claimed_at = now(), claimed_id = me
   where id = inv.id;

  return 'claimed';
end;
$$;

revoke all on function public.claim_my_invite() from public;
grant execute on function public.claim_my_invite() to authenticated;

comment on function public.claim_my_invite() is
  '本人が呼ぶ。自分宛の招待があれば担当パートナーを付ける。すでに担当がいれば何もしない';


-- ---------------------------------------------------------------
-- 確認（Run のあとに、これだけ見れば十分）
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='customer_invites')        as 表,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='customer_invites')           as 権限の本数,
  (select count(*) from pg_indexes
    where schemaname='public' and indexname='customer_invites_pending_uniq') as 二重招待止め,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='claim_my_invite')             as 結びつけ関数;
--  期待値：表=1、権限の本数=3、二重招待止め=1、結びつけ関数=1
