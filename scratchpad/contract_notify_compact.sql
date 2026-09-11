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
  select consultant_id into cur from public.profiles where id = me;
  if cur is not null then return 'already'; end if;
  select * into inv from public.customer_invites
   where lower(email) = my_email and status = 'pending'
   order by created_at asc limit 1;
  if not found then return 'none'; end if;
  if not exists (select 1 from public.profiles
                  where id = inv.consultant_id and role in ('consultant','admin')) then
    return 'error: 招いたパートナーが見つかりません';
  end if;
  update public.profiles
     set consultant_id = inv.consultant_id,
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
drop policy if exists "contract_offers partner insert" on public.contract_offers;
create policy "contract_offers partner insert" on public.contract_offers
  for insert to authenticated
  with check (
    offered_by = auth.uid()
    and kind = 'customer'
    and exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role in ('consultant','admin'))
    and public.ep_may_send_customer_contract()
  );
create or replace function public.contract_notify_agreed(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  o        public.contract_offers%rowtype;
  cust     uuid;
  who      uuid;
  n        integer := 0;
  ttl      text;
  bdy      text;
  whenjp   text;
  is_cust  boolean;
begin
  select * into o from public.contract_offers where id = p_id;
  if not found or o.status <> 'agreed' then return 0; end if;
  is_cust := (o.kind = 'customer');
  whenjp  := to_char(o.agreed_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI');
  select id into cust from public.profiles
   where lower(email) = lower(o.email) and role = 'customer' limit 1;
  if is_cust then
    ttl := '顧問契約が締結されました：' || o.email;
    bdy := coalesce(nullif(o.agreed_org,''), '') ||
           case when coalesce(o.agreed_org,'') <> '' then '　' else '' end ||
           coalesce(o.agreed_name,'') || ' 様が ' || whenjp || ' に同意しました。' ||
           case when o.monthly_fee is not null
                then '顧問料 ' || to_char(o.monthly_fee, 'FM999,999,999') || '円（税別）。' else '' end ||
           E'\n' ||
           case when cust is null
                then 'ご本人がこのメールアドレスで登録した瞬間に、担当が自動で付きます。'
                else 'ご本人は登録済みです。担当は自動で付きます。' end ||
           E'\n次の一手：カルテの「はじめの90日（土台づくり）」で、試算表3か月分・保険証券・借入一覧をお預かりするところから。';
  else
    ttl := 'パートナー契約が締結されました：' || o.email;
    bdy := coalesce(nullif(o.agreed_org,''), '') ||
           case when coalesce(o.agreed_org,'') <> '' then '　' else '' end ||
           coalesce(o.agreed_name,'') || ' 様が ' || whenjp || ' に同意しました。' ||
           E'\nご本人がこのメールアドレスで登録した瞬間に、認定パートナーになります。' ||
           E'\n次の一手：「パートナー」で研修の進み具合を見守り、最初の1社まで「はじめの30日」で伴走する。';
  end if;
  for who in
    select distinct u from (
      select o.offered_by as u
      union select o.consultant_id
      union select id from public.profiles where role = 'admin'
    ) s where u is not null
  loop
    insert into public.agent_insights (user_id, customer_id, kind, title, body, reason, priority, status)
    values (who, cust, 'contract_agreed', ttl, bdy, 'contract_offers.id=' || o.id::text, 1, 'unread');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.contract_notify_agreed(uuid) from public, anon, authenticated;
create or replace function public.contract_agree(
  p_token text, p_name text, p_org text default null, p_ua text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.contract_offers%rowtype;
  final_body text;
  hq text;
  nm text := btrim(coalesce(p_name,''));
  og text := btrim(coalesce(p_org,''));
begin
  if nm = '' then
    return jsonb_build_object('ok', false, 'error', 'ご担当者さまのお名前をご記入ください。');
  end if;
  select * into o from public.contract_offers where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'この契約書は見つかりませんでした。');
  end if;
  if o.status = 'agreed' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if o.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'この契約は取り消されています。');
  end if;
  if o.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'この契約書の有効期限が切れています。');
  end if;
  if o.kind in ('customer','partner_ep1','partner_ep2') and og = '' then
    return jsonb_build_object('ok', false, 'error', '法人名（会社名）をご記入ください。');
  end if;
  if o.ep_id is not null then
    select name into hq from public.ep_orgs where id = o.ep_id;
  end if;
  final_body := public.contract_fill(o.body, o.email, o.monthly_fee, nm,
                                     (now() at time zone 'Asia/Tokyo')::date, og, hq);
  update public.contract_offers
     set status = 'agreed',
         agreed_at = now(),
         agreed_name = nm,
         agreed_org = nullif(og,''),
         agreed_body = final_body,
         agreed_ua = left(coalesce(p_ua,''), 400)
   where id = o.id;
  begin
    perform public.contract_notify_agreed(o.id);
  exception when others then
    null;
  end;
  return jsonb_build_object('ok', true, 'agreed_at', now());
end;
$$;
revoke all on function public.contract_agree(text, text, text, text) from public;
grant execute on function public.contract_agree(text, text, text, text) to anon, authenticated;
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='claim_my_invite'
      and p.prosrc like '%''consultant'',''admin''%')                    as "招待の関数",
  (select count(*) from pg_policies
    where schemaname='public' and tablename='contract_offers'
      and policyname='contract_offers partner insert'
      and with_check like '%admin%')                                      as "契約の書き込み",
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='contract_notify_agreed')      as "締結の知らせ";
