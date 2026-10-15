-- =============================================================
-- 口座振替の手続きの記録 と、初期導入費のお支払いのご案内（2026-10-15）
-- ---------------------------------------------------------------
--  ① 口座振替の手続き（顧客ごと）
--     用紙をお渡し → 集金代行へ送付 → 不備で返却 → 登録完了（→ やめた）
--     の進み具合だけを記録します。口座番号・名義・届出印は持ちません
--     （用紙は紙のまま集金代行へ。口座はこのシステムに置かない決まり）。
--     「お客様番号」（数字6桁）を発行し、依頼書と集金代行のCSVをこれでひも付けます。
--     登録完了の方だけを口座振替にする関数（invoice_apply_mandates）で、
--     切り替え忘れと二重のお支払いを防ぎます。初回のお振込みに入れた顧問料と、
--     ご登録の翌月分までは口座振替にしません（口座振替はご登録の2か月後の分から）。
--
--  ② 初回のお振込み（初期導入費＋翌月分の顧問料）
--     顧客が顧問契約を受け取った最初の一度（contract_offers.claimed_user_id が
--     入った瞬間）に、次を立て、ご案内メールの送り先を記録します。
--     メールは Edge Function「billing-mail」が送ります（送ったら mailed_at）。
--       ・初期導入費 … 料金表（概要タブ）の額。空なら 買い手 100,000円／売り手 50,000円（税別）
--       ・顧問料     … ご登録の翌月分（プランの月額）
--       期日  … どちらもご登録の翌月末
--       方法  … 銀行振込（口座振替は、ご登録の2か月後の分から）
--     ご登録の月の顧問料はいただきません（profiles.bill_from＝翌月1日。月の請求は
--     この日より前の月を立てない）。すでに初期導入費・翌月分の顧問料の請求
--     （取り消し以外）があれば、新しくは立てずにそれを案内します。
--     料金表の「初期導入費の請求」を「自動では立てない」にすると、請求とメールは作りません
--     （ご登録の月をいただかない決まりは同じ）。
--     この SQL を流す前に契約した方には、さかのぼって立てません。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。
--           あわせて Edge Function「billing-mail」をデプロイしてください。
--
-- 確かめかた（最後の select）: 表=2、関数=6、引き金=1、列=2
-- =============================================================

-- ---------------------------------------------------------------
-- ⓪ 顧問料をいただく最初の月（ご登録の翌月1日。null は今までどおり登録の月から）
-- ---------------------------------------------------------------
alter table public.profiles add column if not exists bill_from date;
comment on column public.profiles.bill_from is
  '顧問料をいただく最初の月の1日。ご登録の月はいただかない（初回のお振込みに翌月分を入れる）。null は登録の月から';

-- ---------------------------------------------------------------
-- ① 口座振替の手続き
-- ---------------------------------------------------------------
create sequence if not exists public.debit_mandate_no_seq start 1;

create table if not exists public.debit_mandates (
  customer_id   uuid primary key references auth.users(id) on delete cascade,
  --  依頼書に書いていただく「お客様番号」。数字だけ（用紙の枠が数字のことが多いため）
  ref_no        text not null unique,
  status        text not null default 'preparing'
                check (status in ('preparing','sent','returned','registered','stopped')),
  handed_on     date,      -- 用紙をお渡しした日
  sent_on       date,      -- 集金代行へ送った日
  returned_on   date,      -- 不備で戻った日
  return_reason text,      -- 戻った理由（印鑑相違・名義の書き方 など）
  registered_on date,      -- 登録が済んだ日
  stopped_on    date,      -- 口座振替をやめた日
  note          text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
comment on table public.debit_mandates is
  '口座振替の手続きの進み具合。口座番号・名義・届出印は持たない（用紙は紙のまま集金代行へ）';

alter table public.debit_mandates enable row level security;
drop policy if exists debit_mandates_admin on public.debit_mandates;
create policy debit_mandates_admin on public.debit_mandates
  for select to authenticated using (public.invoice_is_admin());
--  ご本人（お支払い画面に「お手続き中」を出す）
drop policy if exists debit_mandates_self on public.debit_mandates;
create policy debit_mandates_self on public.debit_mandates
  for select to authenticated using (customer_id = auth.uid());
--  担当パートナー（不備で戻ったとき、もう一度伺うのは担当のため）
drop policy if exists debit_mandates_partner on public.debit_mandates;
create policy debit_mandates_partner on public.debit_mandates
  for select to authenticated using (exists (
    select 1 from public.profiles p where p.id = debit_mandates.customer_id and p.consultant_id = auth.uid()));
revoke all on public.debit_mandates from anon, authenticated;
grant select on public.debit_mandates to authenticated;

--  進み具合を記録する（運営だけ）。行が無ければお客様番号を発行して作る
create or replace function public.debit_mandate_set(
  p_customer uuid,
  p_status   text,
  p_on       date default null,
  p_reason   text default null,
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_on  date := coalesce(p_on, (now() at time zone 'Asia/Tokyo')::date);
  v_ref text;
  v_old text;
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;
  if coalesce(p_status,'') not in ('preparing','sent','returned','registered','stopped') then
    return jsonb_build_object('ok', false, 'error', '手続きの状態が正しくありません');
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_customer and p.role = 'customer') then
    return jsonb_build_object('ok', false, 'error', 'お客様が見つかりません');
  end if;
  if exists (select 1 from public.account_deletions d where d.deleted_user_id = p_customer) then
    return jsonb_build_object('ok', false, 'error', '解約済みの方です');
  end if;
  if p_status = 'returned' and btrim(coalesce(p_reason,'')) = '' then
    return jsonb_build_object('ok', false, 'error', '戻ってきた理由をご記入ください（例：印鑑相違）');
  end if;

  select status into v_old from public.debit_mandates where customer_id = p_customer;
  if not found then
    insert into public.debit_mandates (customer_id, ref_no, status, updated_by)
    values (p_customer, (100000 + nextval('public.debit_mandate_no_seq'))::text, 'preparing', auth.uid());
  end if;

  update public.debit_mandates m set
    status        = p_status,
    handed_on     = case when p_status = 'preparing'  then v_on else m.handed_on end,
    sent_on       = case when p_status = 'sent'       then v_on else m.sent_on end,
    returned_on   = case when p_status = 'returned'   then v_on else m.returned_on end,
    return_reason = case when p_status = 'returned'   then btrim(p_reason)
                         when p_status = 'registered' then null else m.return_reason end,
    registered_on = case when p_status = 'registered' then v_on
                         when p_status in ('preparing','sent','returned') then null else m.registered_on end,
    stopped_on    = case when p_status = 'stopped'    then v_on
                         when p_status <> 'stopped' then null else m.stopped_on end,
    note          = coalesce(nullif(btrim(coalesce(p_note,'')),''), m.note),
    updated_at    = now(),
    updated_by    = auth.uid()
  where m.customer_id = p_customer
  returning ref_no into v_ref;

  return jsonb_build_object('ok', true, 'ref_no', v_ref, 'status', p_status, 'was', v_old);
end $$;
revoke all on function public.debit_mandate_set(uuid, text, date, text, text) from public, anon;
grant execute on function public.debit_mandate_set(uuid, text, date, text, text) to authenticated;

--  その月の顧問料の請求を、手続きに合わせる（運営だけ）。
--  登録完了の方 → 口座振替、それ以外で口座振替になっている方 → 銀行振込。
--  触るのは、まだ1円も入っていない請求だけ（入金のあるものを変えると突き合わせが崩れる）
create or replace function public.invoice_apply_mandates(p_period text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_to_transfer int := 0;
  v_to_bank     int := 0;
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;
  if coalesce(p_period,'') !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', '年月は YYYY-MM の形でご指定ください');
  end if;

  update public.invoices i set method = 'transfer', updated_at = now()
   where i.period = p_period and i.kind in ('advisory','direct')
     and i.status = 'open' and coalesce(i.paid_amount,0) = 0
     and coalesce(i.method,'bank') <> 'transfer'
     and exists (select 1 from public.debit_mandates m
                  where m.customer_id = i.customer_id and m.status = 'registered')
     --  初回のお振込みに入れた顧問料は、振込でご案内済み
     and not exists (select 1 from public.setup_fee_notices n where n.advisory_invoice_id = i.id)
     --  口座振替は、ご登録の2か月後の分から（bill_from はご登録の翌月1日）
     and not exists (select 1 from public.profiles p
                      where p.id = i.customer_id and p.bill_from is not null
                        and i.period < to_char(p.bill_from + interval '1 month', 'YYYY-MM'));
  get diagnostics v_to_transfer = row_count;

  update public.invoices i set method = 'bank', updated_at = now()
   where i.period = p_period and i.kind in ('advisory','direct')
     and i.status = 'open' and coalesce(i.paid_amount,0) = 0
     and i.method = 'transfer'
     and not exists (select 1 from public.debit_mandates m
                      where m.customer_id = i.customer_id and m.status = 'registered');
  get diagnostics v_to_bank = row_count;

  return jsonb_build_object('ok', true, 'to_transfer', v_to_transfer, 'to_bank', v_to_bank);
end $$;
revoke all on function public.invoice_apply_mandates(text) from public, anon;
grant execute on function public.invoice_apply_mandates(text) to authenticated;

-- ---------------------------------------------------------------
-- ② 初期導入費
-- ---------------------------------------------------------------
--  料金表からプランの初期導入費（税別）。月額の plan_fee と同じ読み方
create or replace function public.setup_fee(p_plan text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when p_plan = 'seller'
    then coalesce(nullif(btrim(v->>'bl-initseller'), '')::numeric, 50000)::integer
    else coalesce(nullif(btrim(v->>'bl-init'),       '')::numeric, 100000)::integer end
  from (select coalesce((select s.value from public.app_settings s where s.key='billing_rates'), '{}'::jsonb) as v) t;
$$;
revoke all on function public.setup_fee(text) from public, anon;
grant execute on function public.setup_fee(text) to authenticated;

--  ご案内メールの記録（契約1本につき1行）。メールの送り先そのものは持たない
--  （送るときに登録のアドレスを引く）
create table if not exists public.setup_fee_notices (
  offer_id    uuid primary key,
  customer_id uuid not null references auth.users(id) on delete cascade,
  invoice_id  uuid references public.invoices(id) on delete set null,
  created_at  timestamptz not null default now(),
  mailed_at   timestamptz,
  mail_count  int not null default 0,
  mail_error  text
);
comment on table public.setup_fee_notices is
  '初期導入費のご案内メール。契約を受け取った最初の一度に作り、billing-mail が送る';
create index if not exists setup_fee_notices_customer on public.setup_fee_notices(customer_id);
--  初回のお振込みに一緒に入れた、ご登録の翌月分の顧問料
alter table public.setup_fee_notices add column if not exists advisory_invoice_id uuid
  references public.invoices(id) on delete set null;

alter table public.setup_fee_notices enable row level security;
drop policy if exists setup_fee_notices_admin on public.setup_fee_notices;
create policy setup_fee_notices_admin on public.setup_fee_notices
  for select to authenticated using (public.invoice_is_admin());
drop policy if exists setup_fee_notices_self on public.setup_fee_notices;
create policy setup_fee_notices_self on public.setup_fee_notices
  for select to authenticated using (customer_id = auth.uid());
revoke all on public.setup_fee_notices from anon, authenticated;
grant select on public.setup_fee_notices to authenticated;

--  契約を受け取った最初の一度に、初期導入費の請求とご案内の記録を作る。
--  ログインのたびに contract_apply が同じ値を書き直すが、値が変わらないので動かない。
--  ここで失敗しても、ログイン（契約の受け取り）は止めない
create or replace function public.setup_fee_on_claim()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_auto text;
  v_plan text;
  v_ex   integer;
  v_inv  uuid;
  v_adv  uuid;
  v_now  date := (now() at time zone 'Asia/Tokyo')::date;
  v_next date := (date_trunc('month', (now() at time zone 'Asia/Tokyo')::date) + interval '1 month')::date;
  v_due  date;
  v_fee  integer;
begin
  begin
    if exists (select 1 from public.setup_fee_notices n where n.offer_id = new.id) then return new; end if;
    if not exists (select 1 from public.profiles p where p.id = new.claimed_user_id and p.role = 'customer') then
      return new;
    end if;
    --  ご登録の月の顧問料はいただかない（自動の請求を外していても同じ決まり）
    update public.profiles set bill_from = v_next
     where id = new.claimed_user_id and bill_from is null;

    select coalesce(s.value->>'bl-setup-auto', '1') into v_auto
      from public.app_settings s where s.key = 'billing_rates';
    if coalesce(v_auto, '1') = '0' then return new; end if;

    --  運営が手で立てた初期導入費があれば、それを案内する（二本にしない）
    select i.id into v_inv from public.invoices i
     where i.customer_id = new.claimed_user_id and i.kind = 'setup' and i.status <> 'void'
     order by i.created_at desc limit 1;

    select coalesce(new.plan, p.plan, 'buyer') into v_plan from public.profiles p where p.id = new.claimed_user_id;
    v_plan := case when v_plan = 'seller' then 'seller' else 'buyer' end;
    v_due  := (v_next + interval '1 month' - interval '1 day')::date;   -- ご登録の翌月末

    if v_inv is null then
      v_ex   := public.setup_fee(v_plan);
      insert into public.invoices
        (customer_id, period, kind, title, amount_ex, tax, amount, due_on, method, note)
      values
        (new.claimed_user_id, to_char(v_now, 'YYYY-MM'), 'setup',
         case when v_plan = 'seller' then '初期導入費（売り手プラン）' else '初期導入費（買い手プラン）' end,
         v_ex, v_ex * 10 / 100, v_ex + v_ex * 10 / 100, v_due, 'bank',
         'ご契約の登録のときに自動で立てた請求')
      returning id into v_inv;
    end if;

    --  ご登録の翌月分の顧問料。月の請求（invoice_generate）は同じ月・同じ方を二本立てない
    select i.id into v_adv from public.invoices i
     where i.customer_id = new.claimed_user_id and i.kind = 'advisory'
       and i.period = to_char(v_next, 'YYYY-MM') and i.status <> 'void'
     limit 1;
    if v_adv is null then
      v_fee := public.plan_fee(v_plan);
      insert into public.invoices
        (customer_id, period, kind, title, amount_ex, tax, amount, due_on, method, note)
      values
        (new.claimed_user_id, to_char(v_next, 'YYYY-MM'), 'advisory',
         to_char(v_next, 'YYYY-MM') || case when v_plan = 'seller' then ' 顧問料（売り手プラン）' else ' 顧問料（買い手プラン）' end,
         v_fee, v_fee * 10 / 100, v_fee + v_fee * 10 / 100, v_due, 'bank',
         '初回のお振込み（初期導入費と一緒にご案内）')
      returning id into v_adv;
    end if;

    insert into public.setup_fee_notices (offer_id, customer_id, invoice_id, advisory_invoice_id)
    values (new.id, new.claimed_user_id, v_inv, v_adv)
    on conflict (offer_id) do nothing;
  exception when others then
    raise warning 'setup_fee_on_claim: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.setup_fee_on_claim() from public, anon, authenticated;

drop trigger if exists setup_fee_on_claim on public.contract_offers;
create trigger setup_fee_on_claim
  after update of claimed_user_id on public.contract_offers
  for each row
  when (new.kind = 'customer' and new.claimed_user_id is not null
        and new.claimed_user_id is distinct from old.claimed_user_id)
  execute function public.setup_fee_on_claim();

--  まだ送っていないご案内があるか（ご本人の画面が、メールを頼むかどうかを決める）
create or replace function public.setup_notice_pending()
returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.setup_fee_notices n
   where n.customer_id = auth.uid() and n.mailed_at is null;
$$;
revoke all on function public.setup_notice_pending() from public, anon;
grant execute on function public.setup_notice_pending() to authenticated;

-- ---------------------------------------------------------------
-- ③ 月の請求：顧問料をいただく最初の月（bill_from）より前は立てない
--    20260916010000_direct_to_plan.sql の invoice_generate に、その条件だけを足したもの
-- ---------------------------------------------------------------
create or replace function public.invoice_generate(
  p_period text, p_due_day int default 27, p_method text default 'bank')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_start  date;
  v_end    date;
  v_due    date;
  v_made   int := 0;
  v_skip   int := 0;
  r        record;
  v_ex     integer;
  v_plan   text;
  v_method text;
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;
  if coalesce(p_period,'') !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', '年月は YYYY-MM の形でご指定ください');
  end if;
  v_method := coalesce(p_method,'bank');
  if v_method not in ('transfer','bank','card','other') then
    return jsonb_build_object('ok', false, 'error', 'お支払い方法が正しくありません');
  end if;

  v_start := (p_period || '-01')::date;
  v_end   := (v_start + interval '1 month')::date;
  v_due   := least((v_start + interval '1 month' - interval '1 day')::date,
                   (v_start + make_interval(days => greatest(p_due_day,1) - 1))::date);

  for r in
    select p.id
      from public.profiles p
     where p.role = 'customer'
       and p.created_at < v_end
       --  ご登録の月はいただかない（bill_from＝ご登録の翌月1日）
       and (p.bill_from is null or p.bill_from <= v_start)
       and not exists (select 1 from public.account_deletions d
                        where d.deleted_user_id = p.id)
  loop
    v_plan := public.plan_effective(r.id, v_start);
    v_ex   := public.plan_fee(v_plan);
    begin
      insert into public.invoices
        (customer_id, period, kind, title, amount_ex, tax, amount, due_on, method)
      values
        (r.id, p_period, 'advisory',
         case when v_plan = 'seller' then p_period || ' 顧問料（売り手プラン）'
              else p_period || ' 顧問料（買い手プラン）' end,
         v_ex, v_ex * 10 / 100, v_ex + v_ex * 10 / 100, v_due, v_method);
      v_made := v_made + 1;
    exception when unique_violation then
      v_skip := v_skip + 1;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'made', v_made, 'skipped', v_skip,
                            'due_on', v_due, 'period', p_period, 'method', v_method);
end $$;
comment on function public.invoice_generate(text, int, text) is
  'その月の顧問料を顧客ごとに立てる。金額はプランだけで決まる。bill_from（ご登録の翌月）より前の月は立てない';

-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name in ('debit_mandates','setup_fee_notices'))              as "表",
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('debit_mandate_set','invoice_apply_mandates','setup_fee','setup_fee_on_claim','setup_notice_pending','invoice_generate')) as "関数",
  (select count(*) from pg_trigger where tgname='setup_fee_on_claim')                                  as "引き金",
  (select count(*) from information_schema.columns
    where table_schema='public' and ((table_name='profiles' and column_name='bill_from')
       or (table_name='setup_fee_notices' and column_name='advisory_invoice_id')))                      as "列";
--  期待値：表=2、関数=6、引き金=1、列=2
