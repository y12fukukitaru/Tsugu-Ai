-- =============================================================
-- 担当の付け方を、EP-I と EP-II それぞれの実態に合わせる
-- ---------------------------------------------------------------
--  ■ EP-I（顧客基盤型）
--    顧問先は法人に帰属し、法人が「この会社は誰が見るか」を決める。
--    これまでは担当者×顧問先の総当たり（何人でも付けられる）にして
--    いたが、数十社になると表が横に伸びて使いものにならないうえ、
--    「結局この会社は誰の担当なのか」がどこにも定まらない。
--
--    そこで ep_grants に役どころを持たせ、1社につき
--      主担当 … 必ず1名
--      副担当 … 任意で1名（休みや引継ぎのため）
--    に限る。上限は index で担保する。画面の作りだけで守ると、
--    二重に押されたときにすり抜ける。
--
--  ■ EP-II（所属営業型）
--    顧客は継に帰属し、担当は個々の認定パートナーである。つまり
--    profiles.consultant_id という紐づきがすでに正であり、本部が
--    別に顧問先を登録すると二重管理になって必ず食い違う。
--    そこで本部の画面は「所属パートナー → その担当顧客」を
--    その場で集めて出す。登録作業は要らない。
--    ep_book() がその窓口で、本部と運営は全員ぶん、担当者本人は
--    自分のぶんだけを返す。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になる。
-- =============================================================


-- ---------------------------------------------------------------
-- 1. 主担当／副担当
-- ---------------------------------------------------------------
alter table public.ep_grants
  add column if not exists grant_role text not null default 'main';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ep_grants'::regclass
       and conname  = 'ep_grants_grant_role_check'
  ) then
    alter table public.ep_grants
      add constraint ep_grants_grant_role_check check (grant_role in ('main','sub'));
  end if;
end $$;

--  すでに1社に複数ぶら下がっている場合に備えて整える。
--  いちばん古いものを主担当、次を副担当にし、3つ目からは外す
--  （記録は残す）。この移行より前に付けた割当がある環境でも通るように。
with ranked as (
  select id,
         row_number() over (partition by ep_id, customer_id order by granted_at, id) as rn
    from public.ep_grants
   where revoked_at is null
)
update public.ep_grants g
   set grant_role = case when r.rn = 1 then 'main' else 'sub' end,
       revoked_at = case when r.rn > 2 then now() else g.revoked_at end
  from ranked r
 where r.id = g.id
   and (g.grant_role is distinct from (case when r.rn = 1 then 'main' else 'sub' end)
        or r.rn > 2);

--  1社につき 主担当1名・副担当1名まで
create unique index if not exists ep_grants_role_uniq
  on public.ep_grants (ep_id, customer_id, grant_role) where revoked_at is null;

comment on column public.ep_grants.grant_role is
  'main＝主担当（1社1名）／sub＝副担当（1社1名まで）。EP-I で使う';


-- ---------------------------------------------------------------
-- 2. EP-II の担当表（所属パートナー → その担当顧客）
-- ---------------------------------------------------------------
--  profiles を広く読ませずに済ませるため security definer で包む。
--  本部と運営には全員ぶん、担当者本人には自分のぶんだけを返す。
create or replace function public.ep_book(p_ep uuid)
returns table (
  member_id   uuid,
  user_id     uuid,
  user_name   text,
  user_email  text,
  fde_rank    text,
  customer_id uuid,
  customer_name text,
  customer_email text,
  stage       text
)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.user_id,
         coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.company_name), ''), p.email),
         p.email, p.fde_rank,
         c.id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(c.contact_name), ''), c.email),
         c.email, c.stage
    from public.ep_members m
    join public.profiles  p on p.id = m.user_id
    left join public.profiles c
           on c.consultant_id = m.user_id and c.role = 'customer'
   where m.ep_id = p_ep
     and m.status = 'active'
     and (
       public.ep_is_manager(p_ep) or public.ep_is_admin()
       or m.user_id = auth.uid()          -- 担当者本人は自分のぶんだけ
     );
$$;

revoke all on function public.ep_book(uuid) from public;
grant execute on function public.ep_book(uuid) to authenticated;


-- ---------------------------------------------------------------
-- 3. 「この人はどの法人に所属しているか」を引く
-- ---------------------------------------------------------------
--  運営の一覧と、顧客のカルテで札を出すために使う。
--  運営は全員ぶん、パートナーは自分と同じ法人の人だけを引ける。
create or replace function public.ep_affiliation(p_users uuid[])
returns table (user_id uuid, ep_id uuid, ep_name text, ep_kind text, seat_role text)
language sql
security definer
stable
set search_path = public
as $$
  select m.user_id, o.id, o.name, o.kind, m.seat_role
    from public.ep_members m
    join public.ep_orgs    o on o.id = m.ep_id
   where m.status = 'active'
     and m.user_id = any(p_users)
     and (
       public.ep_is_admin()
       or public.ep_is_member(m.ep_id)     -- 同じ法人の人までにする
     );
$$;

revoke all on function public.ep_affiliation(uuid[]) from public;
grant execute on function public.ep_affiliation(uuid[]) to authenticated;


-- =============================================================
-- 確認（Run したあとに、この select だけを実行してください）
-- =============================================================
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='ep_grants'
--       and column_name='grant_role')                          as 主副の列,
--   (select count(*) from pg_constraint
--     where conname='ep_grants_grant_role_check')              as 制約,
--   (select count(*) from pg_indexes
--     where schemaname='public' and indexname='ep_grants_role_uniq') as 上限の索引,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname in ('ep_book','ep_affiliation')) as 関数;
--   -- 主副の列=1、制約=1、上限の索引=1、関数=2 なら成功です。
