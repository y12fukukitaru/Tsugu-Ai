-- =============================================================
-- 契約から登録した方を、そのまま中へ（2026-10-11）
-- ---------------------------------------------------------------
--  困っていたこと
--   ① 契約書でお名前・法人名を書いていただいたのに、登録のあと
--      「経営者として使う／認定パートナー」と、お名前・会社名をもう一度聞いていた。
--   ② 契約の担当パートナーが付かず「担当パートナーの登録を待っています」で止まった。
--      前に同じメールアドレスで試したアカウント（消したもの）が契約を
--      受け取ったことになっていると、新しいアカウントでは受け取れなかった。
--
--  今回の contract_claim
--   ・受け取れる契約：まだ誰も受け取っていない／自分が受け取った／
--                     受け取ったアカウントがもう無い（消した）もの。いちばん新しい同意から
--   ・顧問契約：担当（送ったパートナー）・プラン・会社名・お名前を入れ、はじめの設定を済みにする
--     　　　　　担当が記録に無いときは、送った人がパートナーならその方を担当にする
--   ・パートナー契約：役割をパートナーに。屋号・お名前を入れ、はじめの設定を済みにする
--   ・すでに入っている値（会社名・お名前・担当）は上書きしない
--  何度呼んでも同じ結果になります（自分が受け取った契約は、もう一度当てても同じ）。
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
          or not exists (select 1 from auth.users u where u.id = c.claimed_user_id))
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
select count(*) as "消したアカウントの契約も受け取れる"
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'contract_claim'
   and position('auth.users' in pg_get_functiondef(p.oid)) > 0;
