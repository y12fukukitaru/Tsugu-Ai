-- =============================================================
-- 契約を送ったパートナーを、必ず最初の担当に（2026-10-11）
-- ---------------------------------------------------------------
--  困っていたこと
--    契約に同意して登録した顧客が「担当未割当」のまま残り、運営が担当を選んでいた。
--    原因：v3（20261011020000）で「運営コンソールで消したアカウントが受け取った契約は、
--    登録し直しても受け取らせない」としたが、テストで消したアカウントまで含めてしまい、
--    新しいアカウントに契約（担当・会社名・プラン）が付かなかった。
--
--  今回
--   ① 受け取らせない契約は、「解約のご依頼にもとづいて消した方」の契約だけにする
--      （account_deletions.cancel_request_id があるもの）。ご依頼なしで消したアカウント
--      （テストや登録の間違い）が受け取っていた契約は、新しいアカウントで受け取れる。
--   ② 契約を当てる中身を contract_apply(利用者, メール) にまとめる。
--      ・ログインしたとき（contract_claim）……これまでどおり本人の確認済みのメールで
--      ・運営の画面から（contract_apply_for）…運営だけ。「契約の内容で整える」ボタン
--   ③ いま登録済みで担当が空の顧客に、同意済みの契約があれば、この SQL を流した時点で当てる
--      （本人のログインを待たない）
--  当てる中身（これまでと同じ）
--    顧問契約：担当（契約を送ったパートナー。記録が無ければ送った人がパートナーならその方）・
--              プラン・会社名・お名前・電話番号、はじめの設定を済みに。すでにある値は上書きしない
--    パートナー契約（EP-II 所属を含む）：役割をパートナーに・お名前・屋号・電話番号
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--   何度流しても同じ結果になります。
-- =============================================================

-- ① 当てる中身（内側の関数。画面からは直接呼べない）
create or replace function public.contract_apply(p_user uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  em   text := lower(btrim(coalesce(p_email,'')));
  o    public.contract_offers%rowtype;
  cur  uuid;
  sender_role text;
  cons uuid;
begin
  if p_user is null or em = '' then return 'none'; end if;

  select * into o from public.contract_offers c
   where lower(c.email) = em and c.status = 'agreed'
     and (c.claimed_user_id is null
          or c.claimed_user_id = p_user
          or (not exists (select 1 from auth.users u where u.id = c.claimed_user_id)
              --  解約のご依頼にもとづいて消した方の契約は、登録し直しても受け取らせない（新規のお客様）。
              --  ご依頼なしで消したアカウント（テスト・登録の間違い）の契約は受け取れる
              and not exists (select 1 from public.account_deletions d
                               where d.deleted_user_id = c.claimed_user_id
                                 and d.cancel_request_id is not null)))
   order by c.agreed_at desc nulls last
   limit 1;
  if not found then return 'none'; end if;

  if o.kind in ('partner','partner_ep1','partner_ep2','partner_ep2_member') then
    update public.profiles set role = 'consultant'
     where id = p_user and role = 'customer';
    update public.profiles
       set full_name = coalesce(nullif(btrim(full_name),''), nullif(btrim(o.agreed_name),'')),
           company_name = coalesce(nullif(btrim(company_name),''), nullif(btrim(o.agreed_org),'')),
           phone = coalesce(nullif(btrim(phone),''), nullif(btrim(o.agreed_tel),'')),
           onboarded = true
     where id = p_user;
  else
    --  担当：契約の記録（送ったパートナー）→ 無ければ、送った人がパートナーならその方
    cons := o.consultant_id;
    if cons is null and o.offered_by is not null then
      select role into sender_role from public.profiles where id = o.offered_by;
      if sender_role = 'consultant' then cons := o.offered_by; end if;
    end if;
    select consultant_id into cur from public.profiles where id = p_user;
    if cur is null and cons is not null then
      update public.profiles set consultant_id = cons where id = p_user;
    end if;
    if o.plan in ('buyer','seller') then
      update public.profiles set plan = o.plan, plan_from = null, plan_prev = null
       where id = p_user and role = 'customer';
    end if;
    update public.profiles
       set company_name = coalesce(nullif(btrim(company_name),''), nullif(btrim(o.agreed_org),'')),
           contact_name = coalesce(nullif(btrim(contact_name),''), nullif(btrim(o.agreed_name),'')),
           phone = coalesce(nullif(btrim(phone),''), nullif(btrim(o.agreed_tel),'')),
           onboarded = true
     where id = p_user;
  end if;

  update public.contract_offers set claimed_user_id = p_user where id = o.id;
  return 'claimed:' || o.kind;
end;
$$;
revoke all on function public.contract_apply(uuid, text) from public, anon, authenticated;

-- ② ログインしたとき：本人の確認済みのメールで
create or replace function public.contract_claim()
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  my_email text := lower(coalesce(auth.jwt() ->> 'email',''));
begin
  if auth.uid() is null then return 'error: ログインが必要です'; end if;
  if my_email = '' then return 'error: メールアドレスが取れません'; end if;
  return public.contract_apply(auth.uid(), my_email);
end;
$$;
revoke all on function public.contract_claim() from public, anon;
grant execute on function public.contract_claim() to authenticated;

--    運営の画面から：運営だけ。メールは登録の記録（確認済み）から取る
create or replace function public.contract_apply_for(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare em text;
begin
  if not public.tsugu_is_admin() then return 'error: 運営のみ実行できます'; end if;
  select lower(u.email) into em from auth.users u
   where u.id = p_user and u.email_confirmed_at is not null;
  if em is null then return 'error: メールアドレスの確認が済んでいません'; end if;
  return public.contract_apply(p_user, em);
end;
$$;
revoke all on function public.contract_apply_for(uuid) from public, anon;
grant execute on function public.contract_apply_for(uuid) to authenticated;

-- ③ いま担当が空の顧客に、同意済みの契約があれば当てる（本人のログインを待たない）
do $do$
declare r record; n int := 0; res text;
begin
  for r in
    select p.id, lower(u.email) as em
      from public.profiles p
      join auth.users u on u.id = p.id and u.email_confirmed_at is not null
     where p.role = 'customer' and p.consultant_id is null
  loop
    res := public.contract_apply(r.id, r.em);
    if res like 'claimed:%' then n := n + 1; end if;
  end loop;
  raise notice '担当が空だった顧客のうち、契約を当てた数: %', n;
end $do$;

-- 確かめ
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'contract_apply_for')                                as "運営の画面から当てる",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'contract_apply'
      and position('cancel_request_id is not null' in pg_get_functiondef(p.oid)) > 0)              as "解約のご依頼で消した方だけ除く",
  (select count(*) from public.profiles p
    where p.role = 'customer' and p.consultant_id is null
      and exists (select 1 from public.contract_offers c
                   where lower(c.email) = lower(p.email) and c.kind = 'customer' and c.status = 'agreed')) as "契約があるのに担当が空の顧客（解約で消した方・メール確認前の方だけが残る）";
