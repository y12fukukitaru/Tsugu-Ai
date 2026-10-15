-- =============================================================
-- 請求書をメールで送る（運営・2026-10-15）
-- ---------------------------------------------------------------
--  口座振替が始まるまでは、毎月の顧問料も銀行振込でお願いする。
--  「請求と未収」で立てた月の請求を、お客様ごとに1通の請求書にまとめ、
--  登録のメールアドレスへ送る（Edge Function billing-mail の action:"invoice"）。
--
--  決めたこと
--    ・まとめるのは、その月の・銀行振込の・まだ入っていない請求（顧問料・FA手数料など）。
--      口座振替の請求は載せない（引き落とすので）。
--      初回のお振込み（初期導入費と一緒）でご案内した請求も載せない（そちらのメールで案内済み）
--    ・請求書番号は「年月-通し番号」（例：202611-0007）。同じ方・同じ月はいつも同じ番号。
--      載せる請求が変わったときは、発行日をその日にする
--    ・送れるのは運営だけ。送った日時・回数・送れなかった理由を残す。もう一度送ることもできる
--    ・中身（どの請求を載せるか）は DB が決める（invoice_mail_prepare）。画面からは受け取らない
--    ・発行者（社名・所在地・電話・インボイスの登録番号）は、概要タブの「請求書の発行者」から
--      （app_settings.billing_rates）。登録番号が空のあいだは載せない
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           先に 20261015020000_suspension.sql を流しておいてください。
--           あわせて Edge Function「billing-mail」を新しい中身で入れ直してください。
--
-- 確かめかた（最後の select）: 表=1、関数=1、守り=1
-- =============================================================

create sequence if not exists public.invoice_mail_no_seq;

create table if not exists public.invoice_mails (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references auth.users(id) on delete cascade,
  period       text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  invoice_no   text not null unique,              -- 請求書番号（例：202611-0007）
  invoice_ids  uuid[] not null default '{}',      -- 載せた請求
  total        integer not null default 0,        -- ご請求額（税込・入金済みの分を引いた残り）
  issued_on    date not null default ((now() at time zone 'Asia/Tokyo')::date),
  prepared_by  uuid,
  prepared_at  timestamptz not null default now(),
  sending_at   timestamptz,                       -- 送っている最中（二重に送らない）
  mailed_at    timestamptz,                       -- 最後に送れた日時
  mail_count   integer not null default 0,
  mail_error   text,
  unique (customer_id, period)
);
comment on table public.invoice_mails is
  '請求書メール（お客様ごと・月ごとに1通）。載せる請求は invoice_mail_prepare が決める';

alter table public.invoice_mails enable row level security;
drop policy if exists invoice_mails_read on public.invoice_mails;
create policy invoice_mails_read on public.invoice_mails
  for select to authenticated using (customer_id = auth.uid() or public.dunning_can(customer_id));
revoke all on public.invoice_mails from anon, authenticated;
grant select on public.invoice_mails to authenticated;

--  ご利用を止めている方には見せない（20261015020000_suspension.sql と同じ守り）
do $do$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'tsugu_active') then
    execute 'drop policy if exists "service active" on public.invoice_mails';
    execute 'create policy "service active" on public.invoice_mails as restrictive for all to authenticated '
            'using (public.tsugu_active()) with check (public.tsugu_active())';
  end if;
end $do$;

--  その方・その月の請求書を用意する（運営のみ）。載せる請求と合計を決め、請求書番号を振る
create or replace function public.invoice_mail_prepare(p_period text, p_customer uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ids   uuid[];
  v_total integer;
  v_row   public.invoice_mails;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが送れます');
  end if;
  if coalesce(p_period, '') !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', '年月の形が正しくありません');
  end if;
  select coalesce(array_agg(i.id order by i.due_on, i.kind, i.title), '{}'::uuid[]),
         coalesce(sum(i.amount - coalesce(i.paid_amount, 0)), 0)::integer
    into v_ids, v_total
    from public.invoices i
   where i.customer_id = p_customer and i.period = p_period
     and i.status in ('open', 'partial')
     and coalesce(i.method, 'bank') <> 'transfer'
     and i.amount - coalesce(i.paid_amount, 0) > 0
     and not exists (select 1 from public.setup_fee_notices n
                      where n.invoice_id = i.id or n.advisory_invoice_id = i.id);
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'error',
      'この月にお送りする請求がありません（銀行振込で未入金のもの。口座振替・初回のお振込みの分は載せません）');
  end if;

  insert into public.invoice_mails (customer_id, period, invoice_no, invoice_ids, total, prepared_by)
  values (p_customer, p_period,
          replace(p_period, '-', '') || '-' || lpad(nextval('public.invoice_mail_no_seq')::text, 4, '0'),
          v_ids, v_total, auth.uid())
  on conflict (customer_id, period) do update
    set issued_on   = case when public.invoice_mails.invoice_ids is distinct from excluded.invoice_ids
                           then v_today else public.invoice_mails.issued_on end,
        invoice_ids = excluded.invoice_ids,
        total       = excluded.total,
        prepared_by = excluded.prepared_by,
        prepared_at = now(),
        --  送っている途中で止まったもの（5分たっても終わらない）は、送り直せるようにする
        sending_at  = case when public.invoice_mails.sending_at < now() - interval '5 minutes'
                           then null else public.invoice_mails.sending_at end
  returning * into v_row;

  return jsonb_build_object('ok', true, 'id', v_row.id, 'invoice_no', v_row.invoice_no,
    'count', cardinality(v_row.invoice_ids), 'total', v_row.total, 'issued_on', v_row.issued_on,
    'mailed_at', v_row.mailed_at, 'mail_count', v_row.mail_count);
end $$;
revoke all on function public.invoice_mail_prepare(text, uuid) from public, anon;
grant execute on function public.invoice_mail_prepare(text, uuid) to authenticated;

-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'invoice_mails')                       as "表",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoice_mail_prepare')                    as "関数",
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'invoice_mails' and policyname = 'service active') as "守り";
--  期待値：表=1、関数=1、守り=1
