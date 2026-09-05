-- =============================================================
-- EP-I は、法人口座へまとめてお支払いする
-- ---------------------------------------------------------------
--  EP-I（顧客基盤型）は、顧客との関係を法人が持ちます。契約も法人と
--  巻きました。ならばお支払いも法人へまとめるのが筋です。
--
--  ここで気をつけたいのは、**担当者（staff）が自分の口座を登録して
--  しまうこと**です。登録した本人は「これで振り込まれる」と思って
--  待ちますが、お支払いは法人へ行くので、いつまでも届きません。
--  黙って受け付けないのがいちばん不親切なので、登録の入り口で
--  「法人へまとめます／ご登録は管理者に」とお伝えして止めます。
--
--  EP-II はこれまでどおり、本部と所属パートナーがそれぞれ受け取ります
--  （契約も二本立てにしたのと同じ理由です）。ここは変えません。
--
--  確かめかた：法人の欄=1、EP-Iの判定=1、関数=9、読める列=0
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           20260907000000_payout_accounts.sql のあとに流してください。
-- =============================================================

-- ---------------------------------------------------------------
-- ① どの法人の口座か
-- ---------------------------------------------------------------
alter table public.payout_accounts add column if not exists ep_id uuid;
comment on column public.payout_accounts.ep_id is
  '法人（EP-I）の口座として登録された場合の法人ID。個人の口座なら null';

--  法人の口座はひとつ。二つあると、どちらに振り込むか決まらない
create unique index if not exists payout_accounts_ep_uniq
  on public.payout_accounts (ep_id) where ep_id is not null;

--  ep_id は控えの側（これだけでは送金できない）なので読めてよい
grant select (ep_id) on public.payout_accounts to authenticated;

-- ---------------------------------------------------------------
-- ② EP-I に属しているか、その人は管理者か
-- ---------------------------------------------------------------
--  ほかの関数の中からだけ使う。誰にでも答える必要はない
create or replace function public.payout_ep1_of(p_user uuid)
returns table (ep_id uuid, ep_name text, is_mgr boolean)
language sql security definer stable set search_path = public as $$
  select o.id, o.name, (m.seat_role = 'manager')
    from public.ep_members m
    join public.ep_orgs    o on o.id = m.ep_id
   where m.user_id = p_user and m.status = 'active' and o.kind = 'EP1'
   limit 1;
$$;
revoke all on function public.payout_ep1_of(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- ③ 登録：EP-I の管理者が入れたものは、法人の口座になる
-- ---------------------------------------------------------------
create or replace function public.payout_account_submit(
  p_bank_name    text,
  p_bank_code    text,
  p_branch_name  text,
  p_branch_code  text,
  p_account_type text,
  p_account_no   text,
  p_holder_kana  text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_no     text;
  v_holder text;
  v_ep     uuid;
  v_mgr    boolean;
begin
  if auth.uid() is null then return 'error: ログインが必要です'; end if;

  --  EP-I の担当者は、登録しても振り込まれない。待たせないために止める
  select e.ep_id, e.is_mgr into v_ep, v_mgr from public.payout_ep1_of(auth.uid()) e;
  if v_ep is not null and not coalesce(v_mgr,false) then
    return 'error: EP-I のお支払いは法人口座へまとめます。口座のご登録は、法人の管理者にお願いしてください';
  end if;

  v_no     := regexp_replace(coalesce(p_account_no,''), '[^0-9]', '', 'g');
  v_holder := upper(btrim(coalesce(p_holder_kana,'')));

  if coalesce(btrim(p_bank_name),'') = '' then
    return 'error: 銀行名をご入力ください';
  end if;
  if coalesce(btrim(p_branch_name),'') = '' then
    return 'error: 支店名をご入力ください';
  end if;
  if coalesce(btrim(p_bank_code),'') <> '' and btrim(p_bank_code) !~ '^[0-9]{4}$' then
    return 'error: 銀行コードは数字4桁です（お分かりにならなければ空欄で結構です）';
  end if;
  if coalesce(btrim(p_branch_code),'') <> '' and btrim(p_branch_code) !~ '^[0-9]{3}$' then
    return 'error: 支店コードは数字3桁です（お分かりにならなければ空欄で結構です）';
  end if;
  if coalesce(p_account_type,'') not in ('futsu','touza','chochiku') then
    return 'error: 預金の種別をお選びください';
  end if;
  if v_no !~ '^[0-9]{4,8}$' then
    return 'error: 口座番号は数字4〜8桁です（多くの銀行は7桁）';
  end if;
  if v_holder = '' then
    return 'error: 口座名義（カタカナ）をご入力ください';
  end if;
  if v_holder !~ '^[ｦ-ﾟア-ンー・（）\(\)\.\-A-Z0-9 　]+$' then
    return 'error: 口座名義はカタカナ・英数字でご入力ください（漢字・ひらがなは通りません）';
  end if;

  insert into public.payout_accounts as t
    (user_id, ep_id, bank_name, account_type, last4, status,
     bank_code, branch_code, branch_name, account_no, holder_kana,
     submitted_at, collected_at, collected_by, updated_at)
  values
    (auth.uid(), v_ep, btrim(p_bank_name), p_account_type, right(v_no,4), 'pending',
     nullif(btrim(coalesce(p_bank_code,'')),''), nullif(btrim(coalesce(p_branch_code,'')),''),
     btrim(p_branch_name), v_no, v_holder,
     now(), null, null, now())
  on conflict (user_id) do update set
    ep_id        = excluded.ep_id,
    bank_name    = excluded.bank_name,
    account_type = excluded.account_type,
    last4        = excluded.last4,
    status       = 'pending',
    bank_code    = excluded.bank_code,
    branch_code  = excluded.branch_code,
    branch_name  = excluded.branch_name,
    account_no   = excluded.account_no,
    holder_kana  = excluded.holder_kana,
    submitted_at = now(),
    collected_at = null,
    collected_by = null,
    updated_at   = now();

  return 'ok';
end $$;

-- ---------------------------------------------------------------
-- ④ 控えに「法人の口座かどうか」を足す
-- ---------------------------------------------------------------
--  返す形が変わるので、古いものを消してから作り直す。
--  残しておくと、古い画面が古い関数を呼び、法人かどうかが出ないまま
--  「登録できています」と見えてしまう
drop function if exists public.payout_account_mine();
create or replace function public.payout_account_mine()
returns table (bank_name text, account_type text, last4 text,
               status text, submitted_at timestamptz, collected_at timestamptz,
               ep_id uuid, ep_name text)
language sql security definer stable set search_path = public as $$
  select a.bank_name, a.account_type, a.last4,
         a.status, a.submitted_at, a.collected_at,
         a.ep_id, o.name
    from public.payout_accounts a
    left join public.ep_orgs o on o.id = a.ep_id
   where a.user_id = auth.uid();
$$;

drop function if exists public.payout_account_pending();
create or replace function public.payout_account_pending()
returns table (user_id uuid, name text, email text,
               bank_name text, last4 text, submitted_at timestamptz,
               ep_name text)
language sql security definer stable set search_path = public as $$
  select a.user_id,
         coalesce(p.full_name, p.company_name, ''), coalesce(p.email,''),
         a.bank_name, a.last4, a.submitted_at, o.name
    from public.payout_accounts a
    left join public.profiles p on p.id = a.user_id
    left join public.ep_orgs  o on o.id = a.ep_id
   where a.status = 'pending'
     and exists (select 1 from public.profiles q
                  where q.id = auth.uid() and q.role = 'admin')
   order by a.submitted_at;
$$;

-- ---------------------------------------------------------------
-- ⑤ 配分画面が「法人の口座」を引けるように
-- ---------------------------------------------------------------
create or replace function public.payout_account_status_ep(p_eps uuid[])
returns table (ep_id uuid, status text, bank_name text, last4 text)
language sql security definer stable set search_path = public as $$
  select a.ep_id, a.status, a.bank_name, a.last4
    from public.payout_accounts a
   where a.ep_id = any(p_eps)
     and exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin');
$$;

--  ご本人の画面が「あなたは EP-I の担当者です」と出せるように。
--  自分のことだけ答える
create or replace function public.payout_my_ep1()
returns table (ep_id uuid, ep_name text, is_mgr boolean)
language sql security definer stable set search_path = public as $$
  select e.ep_id, e.ep_name, e.is_mgr from public.payout_ep1_of(auth.uid()) e;
$$;

revoke all on function public.payout_account_mine()            from public, anon;
revoke all on function public.payout_account_pending()         from public, anon;
revoke all on function public.payout_account_status_ep(uuid[]) from public, anon;
revoke all on function public.payout_my_ep1()                  from public, anon;

grant execute on function public.payout_account_mine()            to authenticated;
grant execute on function public.payout_account_pending()         to authenticated;
grant execute on function public.payout_account_status_ep(uuid[]) to authenticated;
grant execute on function public.payout_my_ep1()                  to authenticated;

-- ---------------------------------------------------------------
-- ⑥ 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='payout_accounts'
      and column_name='ep_id')                                  as "法人の欄",
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='payout_ep1_of')     as "EP-Iの判定",
  (select count(*) from information_schema.routines
    where routine_schema='public' and routine_name like 'payout%') as "関数",
  --  ここが 0 でないと、口座番号がクライアントから読めてしまう
  (select count(*) from information_schema.column_privileges
    where table_schema='public' and table_name='payout_accounts'
      and grantee='authenticated' and privilege_type='SELECT'
      and column_name in ('account_no','holder_kana','bank_code','branch_code')) as "読める列";
--  期待値：法人の欄=1、EP-Iの判定=1、関数=9、読める列=0
-- =============================================================
