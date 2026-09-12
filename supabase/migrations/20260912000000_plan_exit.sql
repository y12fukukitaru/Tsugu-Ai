-- =============================================================
-- 顧問プラン（買い手／売り手）・出口の設計・M&A の優遇
-- ---------------------------------------------------------------
--  ① プラン
--    買い手プラン（成長）＝月額 45,000円、売り手プラン（譲渡準備）＝30,000円
--    （税別・運営の料金表 bl-adv / bl-seller）。既存の顧客はすべて買い手。
--    切替は「顧客 → 担当パートナーが運営に依頼 → 運営が切り替える」。
--    切り替えた翌月の請求から新しい月額（plan_from）。
--  ② 契約書
--    金額の選択ではなく「プランと切替の規定」を条文に。{{プラン}} を差し込む。
--    M&A の報酬と顧問先の優遇（1年以上：最低報酬なし・継続年数×10%、最大50%）、
--    同一案件で相手方も顧問先のときの利益相反の説明を明文化。
--    公開中の本文に「プラン」の語が無いときだけ新しい版を公開する。
--  ③ 出口の設計（全員）
--    第三者への譲渡／親族内承継／従業員承継／廃業／自分で続けて買い手になる。
--    目標年と目標値、持株会社の検討フラグ。
--
--  確かめかた：列=4、表=2、関数=6、契約書にプラン=1
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。Edge Function の変更はありません。
-- =============================================================

-- ---------------------------------------------------------------
-- ① プラン（profiles）
-- ---------------------------------------------------------------
alter table public.profiles add column if not exists plan      text not null default 'buyer';
alter table public.profiles add column if not exists plan_from date;
alter table public.profiles add column if not exists plan_prev text;
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('buyer','seller'));
comment on column public.profiles.plan is
  '顧問プラン。buyer＝買い手プラン（成長）／seller＝売り手プラン（譲渡準備）。切替は運営だけ';
comment on column public.profiles.plan_from is
  'いまの plan が請求に効く最初の日（翌月1日）。null なら最初から';
comment on column public.profiles.plan_prev is
  'plan_from より前の月に効くプラン';

alter table public.contract_offers add column if not exists plan text;
comment on column public.contract_offers.plan is '契約時のプラン。登録した瞬間に profiles.plan へ引き継ぐ';

--  料金表からプランの月額（税別）
create or replace function public.plan_fee(p_plan text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when p_plan = 'seller'
    then coalesce(nullif(btrim(v->>'bl-seller'), '')::numeric, 30000)::integer
    else coalesce(nullif(btrim(v->>'bl-adv'),    '')::numeric, 45000)::integer end
  from (select coalesce((select s.value from public.app_settings s where s.key='billing_rates'), '{}'::jsonb) as v) t;
$$;

--  その日に効いているプラン（切替は翌月1日から）
create or replace function public.plan_effective(p_customer uuid, p_on date)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when p.plan_from is null or p.plan_from <= p_on then p.plan
              else coalesce(p.plan_prev, 'buyer') end
  from public.profiles p where p.id = p_customer;
$$;

-- ---------------------------------------------------------------
-- ② 切替の依頼（パートナー → 運営）と、運営の切替
-- ---------------------------------------------------------------
create table if not exists public.plan_requests (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.profiles(id) on delete cascade,
  requested_by  uuid not null,
  to_plan       text not null check (to_plan in ('buyer','seller')),
  reason        text,
  status        text not null default 'pending' check (status in ('pending','done','rejected')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid,
  decision_note text
);
alter table public.plan_requests enable row level security;
drop policy if exists "plan_requests may read" on public.plan_requests;
create policy "plan_requests may read" on public.plan_requests
  for select to authenticated using (public.customer_may(customer_id));
--  書き込みは関数だけ

create or replace function public.plan_request(p_customer uuid, p_to text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  r    text;
  c    public.profiles%rowtype;
  who  uuid;
  nm   text;
begin
  if me is null then return 'error: ログインが必要です'; end if;
  select role into r from public.profiles where id = me;
  if r not in ('consultant','admin') then
    return 'error: 切替の依頼は担当パートナーから運営へお願いします';
  end if;
  if not public.customer_may(p_customer) then return 'error: この顧客の担当ではありません'; end if;
  if p_to not in ('buyer','seller') then return 'error: プランは buyer か seller です'; end if;
  select * into c from public.profiles where id = p_customer and role = 'customer';
  if not found then return 'error: 顧客が見つかりません'; end if;
  if c.plan = p_to then return 'error: すでにそのプランです'; end if;
  if exists (select 1 from public.plan_requests where customer_id = p_customer and status = 'pending') then
    return 'error: 切替の依頼をすでに受け付けています（運営の対応待ち）';
  end if;
  insert into public.plan_requests (customer_id, requested_by, to_plan, reason)
  values (p_customer, me, p_to, nullif(left(btrim(coalesce(p_reason,'')), 500), ''));
  nm := coalesce(nullif(c.company_name,''), nullif(c.contact_name,''), c.email, '');
  for who in select id from public.profiles where role = 'admin' loop
    insert into public.agent_insights (user_id, customer_id, kind, title, body, reason, priority, status)
    values (who, p_customer, 'plan_request',
            '顧問プランの切替依頼：' || nm,
            case when p_to = 'seller' then '買い手プラン → 売り手プラン（譲渡準備）' else '売り手プラン → 買い手プラン（成長）' end
            || E'\n' || coalesce('理由：' || nullif(btrim(coalesce(p_reason,'')),''), '理由の記載なし')
            || E'\n次の一手：運営コンソールの「顧客」→「プラン切替の依頼」で切り替える（翌月の請求から新しい月額）。',
            'plan_requests', 1, 'unread');
  end loop;
  return 'ok';
end;
$$;

--  運営が切り替える。翌月1日から新しい月額
create or replace function public.plan_set(p_customer uuid, p_to text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  c   public.profiles%rowtype;
  d   date := (now() at time zone 'Asia/Tokyo')::date;
  nxt date := (date_trunc('month', d) + interval '1 month')::date;
  who uuid;
  nm  text;
  lbl text;
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role = 'admin') then
    return 'error: 運営のみが切り替えられます';
  end if;
  if p_to not in ('buyer','seller') then return 'error: プランは buyer か seller です'; end if;
  select * into c from public.profiles where id = p_customer and role = 'customer';
  if not found then return 'error: 顧客が見つかりません'; end if;
  if c.plan = p_to then return 'error: すでにそのプランです'; end if;
  update public.profiles
     set plan_prev = case when plan_from is null or plan_from <= d then plan else plan_prev end,
         plan      = p_to,
         plan_from = nxt
   where id = p_customer;
  update public.plan_requests
     set status = 'done', decided_at = now(), decided_by = me, decision_note = nullif(left(btrim(coalesce(p_note,'')),500),'')
   where customer_id = p_customer and status = 'pending' and to_plan = p_to;
  nm  := coalesce(nullif(c.company_name,''), nullif(c.contact_name,''), c.email, '');
  lbl := case when p_to = 'seller' then '売り手プラン（譲渡準備）' else '買い手プラン（成長）' end;
  for who in
    select distinct u from (
      select p_customer as u union select c.consultant_id
    ) s where u is not null
  loop
    insert into public.agent_insights (user_id, customer_id, kind, title, body, reason, priority, status)
    values (who, p_customer, 'plan_changed',
            '顧問プランを切り替えました：' || nm,
            lbl || ' に切り替えました。' || to_char(nxt, 'YYYY/MM') || ' の請求から月額 '
            || to_char(public.plan_fee(p_to), 'FM999,999,999') || '円（税別）になります。'
            || E'\n出口の設計と伴走の1年の節目も、新しいプランに合わせて変わります。',
            'plan_set', 2, 'unread');
  end loop;
  return 'ok';
end;
$$;

--  依頼を断る（記録に残す）
create or replace function public.plan_reject(p_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  q  public.plan_requests%rowtype;
begin
  if me is null or not exists (select 1 from public.profiles where id = me and role = 'admin') then
    return 'error: 運営のみが操作できます';
  end if;
  select * into q from public.plan_requests where id = p_id and status = 'pending';
  if not found then return 'error: 受付中の依頼が見つかりません'; end if;
  update public.plan_requests
     set status = 'rejected', decided_at = now(), decided_by = me, decision_note = nullif(left(btrim(coalesce(p_note,'')),500),'')
   where id = p_id;
  insert into public.agent_insights (user_id, customer_id, kind, title, body, reason, priority, status)
  values (q.requested_by, q.customer_id, 'plan_rejected',
          '顧問プランの切替依頼は見送りになりました',
          coalesce('運営より：' || nullif(btrim(coalesce(p_note,'')),''), '運営が見送りました。') || E'\n詳しくは運営にお問い合わせください。',
          'plan_requests', 2, 'unread');
  return 'ok';
end;
$$;

revoke all on function public.plan_fee(text)                     from public, anon;
revoke all on function public.plan_effective(uuid, date)         from public, anon;
revoke all on function public.plan_request(uuid, text, text)     from public, anon;
revoke all on function public.plan_set(uuid, text, text)         from public, anon;
revoke all on function public.plan_reject(uuid, text)            from public, anon;
grant execute on function public.plan_fee(text)                  to authenticated;
grant execute on function public.plan_effective(uuid, date)      to authenticated;
grant execute on function public.plan_request(uuid, text, text)  to authenticated;
grant execute on function public.plan_set(uuid, text, text)      to authenticated;
grant execute on function public.plan_reject(uuid, text)         to authenticated;

--  パートナーが契約書を送るときに出す月額（買い手・売り手）
create or replace function public.my_billing_rates()
returns jsonb
language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'base',   coalesce(nullif(btrim(v->>'bl-pbase'),     '')::numeric,  3000),
    'per',    coalesce(nullif(btrim(v->>'bl-ai'),        '')::numeric,  2000),
    'seat',   coalesce(nullif(btrim(v->>'bl-seat'),      '')::numeric,  3000),
    'pack',   coalesce(nullif(btrim(v->>'bl-seatpack'),  '')::numeric, 15000),
    'packn',  coalesce(nullif(btrim(v->>'bl-seatpackn'), '')::numeric,    10),
    'adv',    coalesce(nullif(btrim(v->>'bl-adv'),       '')::numeric, 45000),
    'seller', coalesce(nullif(btrim(v->>'bl-seller'),    '')::numeric, 30000)
  )
  from (
    select coalesce(
      (select s.value from public.app_settings s where s.key = 'billing_rates'),
      '{}'::jsonb) as v
  ) t
  where auth.uid() is not null;
$$;

-- ---------------------------------------------------------------
-- ③ 請求の自動生成：その月に効いているプランの月額
-- ---------------------------------------------------------------
create or replace function public.invoice_generate(p_period text, p_due_day int default 27)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rates  jsonb;
  v_direct integer;
  v_start  date;
  v_end    date;
  v_due    date;
  v_made   int := 0;
  v_skip   int := 0;
  r        record;
  v_ex     integer;
  v_plan   text;
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;
  if coalesce(p_period,'') !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', '年月は YYYY-MM の形でご指定ください');
  end if;

  v_start := (p_period || '-01')::date;
  v_end   := (v_start + interval '1 month')::date;
  v_due   := least((v_start + interval '1 month' - interval '1 day')::date,
                   (v_start + make_interval(days => greatest(p_due_day,1) - 1))::date);

  select coalesce((select value from public.app_settings where key='billing_rates'), '{}'::jsonb)
    into v_rates;
  v_direct := coalesce(nullif(btrim(v_rates->>'bl-direct'), '')::numeric, 30000)::integer;

  for r in
    select p.id,
           coalesce(p.company_name, p.contact_name, p.email, '') as nm,
           (a.id is not null) as is_direct
      from public.profiles p
      left join public.profiles a
        on a.id = p.consultant_id and a.role = 'admin'
     where p.role = 'customer'
       and p.created_at < v_end
       and not exists (select 1 from public.account_deletions d
                        where d.deleted_user_id = p.id)
  loop
    --  その月の1日に効いているプランの月額。切替は翌月1日から効く
    v_plan := public.plan_effective(r.id, v_start);
    v_ex   := case when r.is_direct then v_direct else public.plan_fee(v_plan) end;
    begin
      insert into public.invoices
        (customer_id, period, kind, title, amount_ex, tax, amount, due_on)
      values
        (r.id, p_period,
         case when r.is_direct then 'direct' else 'advisory' end,
         case when r.is_direct then p_period || ' 顧問料（運営直接担当）'
              when v_plan = 'seller' then p_period || ' 顧問料（売り手プラン）'
              else p_period || ' 顧問料（買い手プラン）' end,
         v_ex, v_ex * 10 / 100, v_ex + v_ex * 10 / 100, v_due);
      v_made := v_made + 1;
    exception when unique_violation then
      v_skip := v_skip + 1;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'made', v_made, 'skipped', v_skip,
                            'due_on', v_due, 'period', p_period);
end $$;

-- ---------------------------------------------------------------
-- ④ 契約：{{プラン}} の差し込みと、登録時のプランの引き継ぎ
-- ---------------------------------------------------------------
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
  --  プランの名前。顧問契約以外や未指定なら「—」
  final_body := replace(final_body, '{{プラン}}',
    case when o.plan = 'seller' then '売り手プラン（譲渡準備）'
         when o.plan = 'buyer'  then '買い手プラン（成長）'
         else '—' end);

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

create or replace function public.contract_claim()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  my_email text;
  o        public.contract_offers%rowtype;
  cur      uuid;
begin
  if me is null then return 'error: ログインが必要です'; end if;
  select lower(coalesce(auth.jwt() ->> 'email','')) into my_email;
  if my_email = '' then return 'error: メールアドレスが取れません'; end if;

  select * into o from public.contract_offers
   where lower(email) = my_email and status = 'agreed' and claimed_user_id is null
   order by agreed_at asc limit 1;
  if not found then return 'none'; end if;

  if o.kind in ('partner','partner_ep1','partner_ep2') then
    update public.profiles set role = 'consultant'
     where id = me and role = 'customer';
  else
    select consultant_id into cur from public.profiles where id = me;
    if cur is null and o.consultant_id is not null then
      update public.profiles set consultant_id = o.consultant_id where id = me;
    end if;
    --  契約時のプランを引き継ぐ。最初から効く（plan_from は空）
    if o.plan in ('buyer','seller') then
      update public.profiles set plan = o.plan, plan_from = null, plan_prev = null
       where id = me and role = 'customer';
    end if;
  end if;

  if o.agreed_org is not null and o.agreed_org <> '' then
    update public.profiles
       set company_name = o.agreed_org
     where id = me and coalesce(company_name,'') = '';
  end if;

  update public.contract_offers set claimed_user_id = me where id = o.id;
  return 'claimed:' || o.kind;
end;
$$;

--  顧問契約書ひな形：プランと切替の規定、M&A の報酬と優遇、利益相反の説明
do $do$
declare
  cur  public.contract_templates%rowtype;
  nb   text;
  nv   int;
begin
  select * into cur from public.contract_templates
   where kind = 'customer' and active = true
   order by version desc limit 1;
  if not found then return; end if;
  if position('プラン' in cur.body) > 0 then return; end if;   -- もう書いてある

  nb := cur.body;
  nb := replace(nb, '  顧問料：月額 {{月額}}', '  プラン：{{プラン}}' || E'\n' || '  顧問料：月額 {{月額}}');
  if position('第2条（顧問料）' in nb) > 0 and position('第2条の2（初期導入費）' in nb) > 0 then
    nb := regexp_replace(nb,
      '第2条（顧問料）.*?第2条の2（初期導入費）',
      '第2条（顧問料）' || E'\n' ||
      '  乙は甲に対し、契約時のプラン（{{プラン}}）に定める月額の顧問料を毎月お支払いいただきます。' || E'\n' ||
      '  プランは「買い手プラン（成長）」と「売り手プラン（譲渡準備）」の2つとし、月額は運営の料金表によります。' || E'\n' ||
      '  乙は担当パートナーを通じて運営にプランの切替を申し出ることができ、運営が切替を行った' || E'\n' ||
      '  翌月の請求から新しい月額を適用します。料金表を改定するときは、運営が事前にお知らせします。' || E'\n' ||
      '  お支払いの方法および期日は、別途ご案内します。' || E'\n\n' ||
      '第2条の2（初期導入費）');
  end if;
  if position('第3条（成果の非保証）' in nb) > 0 then
    nb := replace(nb, '第3条（成果の非保証）',
      '第2条の3（M&Aの報酬と、顧問先の優遇）' || E'\n' ||
      '  乙が会社・事業の譲渡または譲受を行う際に、甲または運営がファイナンシャル・アドバイザー' || E'\n' ||
      '  として関与するときの報酬は、別途のFA契約によります。' || E'\n' ||
      '  本契約が1年以上継続している乙については、FA報酬の最低報酬額を設けず、本契約の継続年数' || E'\n' ||
      '  1年につき10%（最大50%）をFA報酬から割り引きます。' || E'\n' ||
      '  同一の案件で相手方も甲または運営の顧問先であるときは、利益相反のおそれについて双方に' || E'\n' ||
      '  事前に説明し、書面による同意を得たうえで関与します。' || E'\n\n' ||
      '第3条（成果の非保証）');
  else
    nb := nb || E'\n\n' ||
      '（プランと切替）契約時のプラン（{{プラン}}）の月額を毎月お支払いいただきます。切替は担当パートナーを通じて運営に申し出、翌月の請求から適用します。' || E'\n' ||
      '（M&Aの報酬と優遇）FA報酬は別途のFA契約によります。1年以上の顧問先は最低報酬なし、継続年数1年につき10%（最大50%）を割り引きます。相手方も顧問先のときは利益相反を事前に説明し同意を得ます。';
  end if;

  select coalesce(max(version),0) + 1 into nv from public.contract_templates where kind = 'customer';
  update public.contract_templates set active = false where kind = 'customer' and active = true;
  insert into public.contract_templates (kind, version, title, body, active, created_by)
  values ('customer', nv, cur.title, nb, true, cur.created_by);
end $do$;

-- ---------------------------------------------------------------
-- ⑤ 出口の設計（全員）
-- ---------------------------------------------------------------
create table if not exists public.exit_plans (
  customer_id   uuid primary key references public.profiles(id) on delete cascade,
  exit_type     text check (exit_type in ('sell','family','employee','close','buyer')),
  target_year   integer,
  targets       jsonb not null default '{}'::jsonb,     -- {"price":万円,"op":万円,"net":万円,"debt":万円,...}
  holding_flag  boolean not null default false,          -- 持株会社の検討
  holding_note  text,
  notes         text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
comment on table public.exit_plans is
  '出口の設計。どの出口へ、いつまでに、どの数字を。持株会社の検討フラグ。相続税評価額は持たない';
alter table public.exit_plans enable row level security;
drop policy if exists "exit_plans may" on public.exit_plans;
create policy "exit_plans may" on public.exit_plans
  for all to authenticated
  using (public.customer_may(customer_id))
  with check (public.customer_may(customer_id));

-- ---------------------------------------------------------------
-- ⑥ 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema='public'
      and ((table_name='profiles' and column_name in ('plan','plan_from','plan_prev'))
        or (table_name='contract_offers' and column_name='plan')))                     as "列",
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name in ('plan_requests','exit_plans'))      as "表",
  (select count(*) from information_schema.routines
    where routine_schema='public'
      and routine_name in ('plan_fee','plan_effective','plan_request','plan_set','plan_reject','my_billing_rates')) as "関数",
  (select count(*) from public.contract_templates
    where kind='customer' and active and position('{{プラン}}' in body) > 0)           as "契約書にプラン";
--  期待値：列=4、表=2、関数=6、契約書にプラン=1
-- =============================================================
