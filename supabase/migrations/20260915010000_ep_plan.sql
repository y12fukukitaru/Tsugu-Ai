-- =============================================================
-- エンタープライズの画面に、顧問先のプランを届ける
-- ---------------------------------------------------------------
--  顧問料と初期導入費は、買い手プランと売り手プランで額が違います。
--
--    買い手プラン … 顧問料 45,000円／月・初期導入費 100,000円
--    売り手プラン … 顧問料 30,000円／月・初期導入費  50,000円
--
--  ところがエンタープライズの画面は、どの顧問先も買い手プランの額で
--  出していました。売り手プランの顧問先が混ざると、御社の受取も
--  TsuguAi へのお支払いも、実際より大きく見えます。金額の画面が
--  実際と違うのは、そのまま行き違いになります。
--
--  画面がプランで出し分けられるように、いま名前を返している窓口に
--  プランを足します。返す列が増えるので、いちど drop してから作り直します
--  （create or replace では戻り値の形を変えられません）。
--
--  プランは金額そのものではなく、どちらの区分かを示す文字（buyer／seller）
--  だけを返します。金額は画面側の設定（課金・契約タブ）から出します。
--
--  確かめかた：関数=2、ep_people にプランの列=1、ep_book にプランの列=1
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になります。
-- =============================================================

-- ---------------------------------------------------------------
-- ① ep_people に plan を足す（顧問先のときだけ入る。担当者は null）
-- ---------------------------------------------------------------
drop function if exists public.ep_people(uuid);

create or replace function public.ep_people(p_ep uuid)
returns table (id uuid, email text, name text, role text, plan text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.email,
         coalesce(nullif(btrim(p.company_name), ''), nullif(btrim(p.full_name), ''), p.email),
         p.role,
         --  プランは顧客のものだけ。担当者（認定パートナー）には無い
         case when p.role = 'customer' then p.plan else null end
    from public.profiles p
   where (public.ep_is_member(p_ep) or public.ep_is_admin())
     and (
       p.id in (select m.user_id from public.ep_members m where m.ep_id = p_ep)
       or (
         (public.ep_is_manager(p_ep) or public.ep_is_admin())
         and p.id in (select c.customer_id from public.ep_clients c where c.ep_id = p_ep)
       )
       or p.id in (
         select g.customer_id from public.ep_grants g
           join public.ep_members m2 on m2.id = g.member_id
          where g.ep_id = p_ep and g.revoked_at is null
            and m2.user_id = auth.uid() and m2.status = 'active'
       )
     );
$$;

comment on function public.ep_people(uuid) is
  'エンタープライズの画面に出す名前。顧問先にはプラン（buyer／seller）も返す';

revoke all on function public.ep_people(uuid) from public, anon;
grant execute on function public.ep_people(uuid) to authenticated;


-- ---------------------------------------------------------------
-- ② ep_book（EP-II の担当表）にも customer_plan を足す
-- ---------------------------------------------------------------
--  本部の受取は顧問料の10%なので、顧問先のプランで額が変わります。
--  担当表と概要の両方がこの列を見ます。
drop function if exists public.ep_book(uuid);

create or replace function public.ep_book(p_ep uuid)
returns table (
  member_id     uuid,
  user_id       uuid,
  user_name     text,
  user_email    text,
  fde_rank      text,
  customer_id   uuid,
  customer_name text,
  customer_email text,
  stage         text,
  customer_plan text
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
         c.email, c.stage, c.plan
    from public.ep_members m
    join public.profiles  p on p.id = m.user_id
    left join public.profiles c
           on c.consultant_id = m.user_id and c.role = 'customer'
   where m.ep_id = p_ep
     and m.status = 'active'
     and (
       public.ep_is_manager(p_ep) or public.ep_is_admin()
       --  担当者本人は自分のぶんだけ
       or m.user_id = auth.uid()
     );
$$;

comment on function public.ep_book(uuid) is
  'EP-II の担当表。所属パートナーと、その担当顧客（プランつき）';

revoke all on function public.ep_book(uuid) from public, anon;
grant execute on function public.ep_book(uuid) to authenticated;


-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname in ('ep_people','ep_book'))::text   as 関数,
  (select count(*) from information_schema.columns
    where table_schema='public'
      and table_name='profiles' and column_name='plan')::text                  as プランの列,
  (select has_function_privilege('anon','public.ep_people(uuid)','execute'))::text as anonが実行;
-- 期待：関数=2、プランの列=1、anonが実行=false
