-- =============================================================
-- 契約の受け取り：解約で消した方の契約は、登録し直しても受け取らない（2026-10-11）
-- ---------------------------------------------------------------
--  20261011010000_contract_claim_v2.sql の続きです（あちらを流したあとに流してください）。
--
--  v2 では「受け取ったアカウントがもう無い契約」も受け取れるようにした
--  （前に同じメールで試して、Supabase の画面から消したアカウントがあっても、
--   新しいアカウントに担当が付くように）。
--  ただしそのままだと、解約の手続き（運営コンソールの「アカウントを削除する」）で
--  消した方が同じメールで登録し直したときにも、以前の担当とプランが付いてしまう。
--  説明書の「登録し直した場合は新規のお客様として扱う」と食い違う。
--
--  そこで、解約の手続きで消した方（account_deletions に記録がある方）の契約は除く。
--    ・Supabase の画面から消したアカウント（記録なし）… これまでどおり受け取れる
--    ・解約の手続きで消したアカウント（記録あり）     … 受け取らない（新規扱い）
--  ほかは v2 と同じです。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--   何度流しても同じ結果になります。
-- =============================================================

create or replace function public.contract_claim()
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  me       uuid := auth.uid();
  my_email text;
  o        public.contract_offers%rowtype;
  cur      uuid;
  sender_role text;
  cons     uuid;
begin
  if me is null then return 'error: ログインが必要です'; end if;
  select lower(coalesce(auth.jwt() ->> 'email','')) into my_email;
  if my_email = '' then return 'error: メールアドレスが取れません'; end if;

  select * into o from public.contract_offers c
   where lower(c.email) = my_email and c.status = 'agreed'
     and (c.claimed_user_id is null
          or c.claimed_user_id = me
          or (not exists (select 1 from auth.users u where u.id = c.claimed_user_id)
              --  解約の手続き（運営コンソールの「アカウントを削除する」）で消した方の契約は
              --  受け取らせない。登録し直したら新規のお客様（以前の担当・プランは付かない）
              and not exists (select 1 from public.account_deletions d
                               where d.deleted_user_id = c.claimed_user_id)))
   order by c.agreed_at desc nulls last
   limit 1;
  if not found then return 'none'; end if;

  if o.kind in ('partner','partner_ep1','partner_ep2') then
    update public.profiles set role = 'consultant'
     where id = me and role = 'customer';
    update public.profiles
       set full_name = coalesce(nullif(btrim(full_name),''), nullif(btrim(o.agreed_name),'')),
           company_name = coalesce(nullif(btrim(company_name),''), nullif(btrim(o.agreed_org),'')),
           onboarded = true
     where id = me;
  else
    --  担当：契約の記録 → 無ければ、送った人がパートナーならその方
    cons := o.consultant_id;
    if cons is null and o.offered_by is not null then
      select role into sender_role from public.profiles where id = o.offered_by;
      if sender_role = 'consultant' then cons := o.offered_by; end if;
    end if;
    select consultant_id into cur from public.profiles where id = me;
    if cur is null and cons is not null then
      update public.profiles set consultant_id = cons where id = me;
    end if;
    --  契約時のプランを引き継ぐ。最初から効く（plan_from は空）
    if o.plan in ('buyer','seller') then
      update public.profiles set plan = o.plan, plan_from = null, plan_prev = null
       where id = me and role = 'customer';
    end if;
    --  契約書に書いていただいた会社名・お名前。はじめの設定はもう聞かない
    update public.profiles
       set company_name = coalesce(nullif(btrim(company_name),''), nullif(btrim(o.agreed_org),'')),
           contact_name = coalesce(nullif(btrim(contact_name),''), nullif(btrim(o.agreed_name),'')),
           onboarded = true
     where id = me;
  end if;

  update public.contract_offers set claimed_user_id = me where id = o.id;
  return 'claimed:' || o.kind;
end;
$$;

revoke all on function public.contract_claim() from public, anon;
grant execute on function public.contract_claim() to authenticated;

-- 確かめ（1 なら完了）
select count(*) as "解約で消した方の契約は受け取らない"
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'contract_claim'
   and position('account_deletions' in pg_get_functiondef(p.oid)) > 0;
