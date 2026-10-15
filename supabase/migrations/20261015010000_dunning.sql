-- =============================================================
-- 引き落とせなかった分の「お振込みのお願い」と、3か月の滞納で請求を止める（2026-10-15）
-- ---------------------------------------------------------------
--  ① お振込みのお願い（運営コンソール・パートナーポータルから）
--     期日を過ぎて入っていない請求（未入金・一部入金）を、お客様ごとにまとめて、
--     「〇月分・いくら（内訳）」をメールでお知らせします。送るのは Edge Function
--     「billing-mail」（action:"dunning"）。送れるのは運営と、その方の担当パートナーだけ。
--       ・まとめた請求は、口座振替 → 銀行振込 に切り替えます（集金代行の次の引き落としに
--         載らないように。振込と引き落としの二重払いを防ぐ）
--       ・同じ方へは1日に1回まで（押し間違い・送りすぎを止める）
--       ・送った記録は dunning_notices に残ります（誰が・いつ・どの請求・いくら）
--
--  ② 3か月の滞納で、月の請求を一旦止める
--     期日を過ぎて入っていない顧問料が3か月分たまった方には、次の月から
--     「この月の請求を立てる」で新しい請求を立てません（invoice_generate）。
--     お振込みいただいて未収が3か月分を下回れば、次の月から自動で再開します。
--     止めていたあいだの月は、さかのぼって立てません。
--     そのため、お振込みのお願いは最大で3か月分の合算になります。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。
--           先に 20261015000000_debit_mandate_setup_fee.sql を流しておいてください。
--           あわせて Edge Function「billing-mail」を新しい中身で入れ直してください。
--
-- 確かめかた（最後の select）: 表=1、関数=5
-- =============================================================

-- ---------------------------------------------------------------
-- ⓪ 送れる人：運営と、その方の担当パートナー（主担当・2名体制のサブ担当）
-- ---------------------------------------------------------------
create or replace function public.dunning_can(p_customer uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.invoice_is_admin()
      or exists (select 1 from public.profiles c
                  where c.id = p_customer and c.consultant_id = auth.uid())
      or exists (select 1 from public.partner_assignments a
                  where a.customer_id = p_customer and a.status = 'approved'
                    and (a.main_id = auth.uid() or a.sub_id = auth.uid()));
$$;
revoke all on function public.dunning_can(uuid) from public, anon;
grant execute on function public.dunning_can(uuid) to authenticated;

-- ---------------------------------------------------------------
-- ① お振込みのお願いの記録
-- ---------------------------------------------------------------
create table if not exists public.dunning_notices (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  sent_by     uuid not null,
  sent_role   text not null check (sent_role in ('admin','partner')),
  invoice_ids uuid[] not null,
  amount_due  integer not null,          -- お振込みのお願い額（税込・入金済みの分を引いた残り）
  pay_by      date not null,             -- お支払期日
  created_at  timestamptz not null default now(),
  mailed_at   timestamptz,
  mail_error  text
);
comment on table public.dunning_notices is
  '引き落とせなかった・期日を過ぎた分のお振込みのお願い。誰が・いつ・どの請求・いくら を残す';
create index if not exists dunning_notices_customer on public.dunning_notices(customer_id, created_at desc);

alter table public.dunning_notices enable row level security;
drop policy if exists dunning_notices_read on public.dunning_notices;
create policy dunning_notices_read on public.dunning_notices
  for select to authenticated using (public.dunning_can(customer_id));
revoke all on public.dunning_notices from anon, authenticated;
grant select on public.dunning_notices to authenticated;

--  まとめる請求：期日を過ぎて入っていないもの（取り消し・入金済みは除く）
create or replace function public.dunning_preview(p_customer uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_items jsonb;
  v_rest  integer;
  v_last  timestamptz;
  v_months int;
begin
  if not public.dunning_can(p_customer) then
    return jsonb_build_object('ok', false, 'error', '運営か、担当のパートナーだけが送れます');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'period', i.period, 'kind', i.kind, 'title', i.title,
           'amount_ex', i.amount_ex, 'tax', i.tax, 'amount', i.amount,
           'paid_amount', coalesce(i.paid_amount,0), 'rest', i.amount - coalesce(i.paid_amount,0),
           'due_on', i.due_on, 'method', coalesce(i.method,'bank')) order by i.due_on, i.period), '[]'::jsonb),
         coalesce(sum(i.amount - coalesce(i.paid_amount,0)),0)::integer,
         count(*) filter (where i.kind in ('advisory','direct'))::int
    into v_items, v_rest, v_months
    from public.invoices i
   where i.customer_id = p_customer and i.status in ('open','partial')
     and i.due_on < v_today and i.amount - coalesce(i.paid_amount,0) > 0;
  select max(mailed_at) into v_last from public.dunning_notices where customer_id = p_customer;
  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_rest,
                            'months', v_months, 'held', v_months >= 3, 'last_sent_at', v_last);
end $$;
revoke all on function public.dunning_preview(uuid) from public, anon;
grant execute on function public.dunning_preview(uuid) to authenticated;

--  送る直前：まとめる請求を決め、口座振替 → 銀行振込 に切り替え、記録を作る。
--  メールは、返した id で billing-mail（action:"dunning"）が送る
create or replace function public.dunning_prepare(p_customer uuid, p_pay_by date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_ids   uuid[];
  v_rest  integer;
  v_id    uuid;
  v_last  timestamptz;
begin
  if not public.dunning_can(p_customer) then
    return jsonb_build_object('ok', false, 'error', '運営か、担当のパートナーだけが送れます');
  end if;
  if p_pay_by is null or p_pay_by <= v_today or p_pay_by > v_today + 60 then
    return jsonb_build_object('ok', false, 'error', 'お支払期日は、明日から60日以内でご指定ください');
  end if;
  --  同じ方へは1日に1回まで。数えるのは送れたものと、いま送っている途中（10分以内）のもの。
  --  送れなかったもの・途中で止まったものは数えない（もう一度送れる）
  select max(coalesce(mailed_at, created_at)) into v_last
    from public.dunning_notices
   where customer_id = p_customer
     and (mailed_at > now() - interval '1 day'
          or (mailed_at is null and mail_error is null and created_at > now() - interval '10 minutes'));
  if v_last is not null then
    return jsonb_build_object('ok', false, 'error',
      'この方には ' || to_char(v_last at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') || ' に送っています。続けて送るのは翌日からにしてください');
  end if;

  select array_agg(i.id order by i.due_on), coalesce(sum(i.amount - coalesce(i.paid_amount,0)),0)::integer
    into v_ids, v_rest
    from public.invoices i
   where i.customer_id = p_customer and i.status in ('open','partial')
     and i.due_on < v_today and i.amount - coalesce(i.paid_amount,0) > 0;
  if v_ids is null then
    return jsonb_build_object('ok', false, 'error', '期日を過ぎた未入金はありません');
  end if;

  --  集金代行の次の引き落としに載らないよう、振込に切り替える（二重払いを防ぐ）
  update public.invoices set method = 'bank', updated_at = now()
   where id = any(v_ids) and method = 'transfer';

  insert into public.dunning_notices (customer_id, sent_by, sent_role, invoice_ids, amount_due, pay_by)
  values (p_customer, auth.uid(), case when public.invoice_is_admin() then 'admin' else 'partner' end,
          v_ids, v_rest, p_pay_by)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'count', array_length(v_ids,1), 'amount', v_rest);
end $$;
revoke all on function public.dunning_prepare(uuid, date) from public, anon;
grant execute on function public.dunning_prepare(uuid, date) to authenticated;

-- ---------------------------------------------------------------
-- ② 3か月の滞納で、月の請求を一旦止める
-- ---------------------------------------------------------------
--  その日より前が期日の顧問料のうち、入っていないものが3か月分以上あるか
create or replace function public.billing_held(p_customer uuid, p_on date)
returns boolean
language sql stable security definer set search_path = public as $$
  select count(*) >= 3
    from public.invoices i
   where i.customer_id = p_customer and i.kind in ('advisory','direct')
     and i.status in ('open','partial') and i.due_on < p_on;
$$;
revoke all on function public.billing_held(uuid, date) from public, anon;
grant execute on function public.billing_held(uuid, date) to authenticated;

--  20261015000000_debit_mandate_setup_fee.sql の invoice_generate に、
--  「3か月の滞納で止める」を足したもの（止めた社数を held で返す）
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
  v_held   int := 0;
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
    --  3か月分の滞納がある方には、新しい月を立てない（未収が減れば次の月から再開）。
    --  すでにその月の請求があれば、そのまま（二本にもしない）
    if public.billing_held(r.id, v_start)
       and not exists (select 1 from public.invoices x
                        where x.customer_id = r.id and x.period = p_period and x.kind = 'advisory') then
      v_held := v_held + 1;
      continue;
    end if;
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

  return jsonb_build_object('ok', true, 'made', v_made, 'skipped', v_skip, 'held', v_held,
                            'due_on', v_due, 'period', p_period, 'method', v_method);
end $$;
comment on function public.invoice_generate(text, int, text) is
  'その月の顧問料を顧客ごとに立てる。金額はプランだけで決まる。bill_from より前の月と、3か月分の滞納がある方には立てない';

-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name = 'dunning_notices')                               as "表",
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('dunning_can','dunning_preview','dunning_prepare','billing_held','invoice_generate'))      as "関数";
--  期待値：表=1、関数=5
