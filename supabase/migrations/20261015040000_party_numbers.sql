-- =============================================================
-- 顧客番号・パートナー番号（2026-10-15）
-- ---------------------------------------------------------------
--  決めたこと
--    ・顧客番号は「C」、パートナー番号は「P」から始まる。番号の帯をはじめから分ける
--      （同じ数字でも C と P は別の番号。取り違えない）
--    ・形：C＋8桁＋検査数字1桁（例：C482719531 → 画面では C-4827-1953-1）。
--      8桁は乱数（10000000〜99999999 の 9,000万通り）。通し番号ではないので、
--      番号から登録の順番や件数は分からない。100万件でも埋まるのは 1.1% ほど
--    ・最後の1桁は検査数字（Luhn）。1桁の打ち間違い・隣どうしの入れ替えに気づける
--    ・一度付けた番号は変わらない（画面からも運営からも書き換えられない）。
--      解約・削除しても、ほかの方に使い回さない（発行台帳 party_numbers に残す）
--    ・付けるのは自動：顧客（role=customer）になったとき C、パートナー（consultant）になったとき P。
--      すでにいる方には、この SQL を流したときに付ける
--    ・口座振替の依頼書の「お客様番号」は、これから作る手続きから、顧客番号の数字9桁にそろえる
--      （すでに作った手続きの番号はそのまま）。請求書番号も「年月-顧客番号」にする
--      （どちらも通し番号をやめ、件数が分からないようにする）
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           先に 20261015030000_invoice_mail.sql を流しておいてください。
--           あわせて Edge Function「billing-mail」を入れ直してください（メールにお客様番号を載せる）。
--
-- 確かめかた（最後の select）: 台帳=1、番号の無い顧客=0、番号の無いパートナー=0、重なり=0、見張り=1
-- =============================================================

-- ---------------------------------------------------------------
-- ① 発行台帳（使った番号はここに残し、使い回さない）
-- ---------------------------------------------------------------
create table if not exists public.party_numbers (
  no         text primary key check (no ~ '^[CP][1-9][0-9]{8}$'),
  kind       text not null check (kind in ('C','P')),
  user_id    uuid references auth.users(id) on delete set null,
  issued_at  timestamptz not null default now(),
  check (left(no, 1) = kind)
);
create unique index if not exists party_numbers_user_kind on public.party_numbers(user_id, kind) where user_id is not null;
comment on table public.party_numbers is
  '顧客番号（C）・パートナー番号（P）の発行台帳。番号は乱数で、解約・削除後も使い回さない';
alter table public.party_numbers enable row level security;
revoke all on public.party_numbers from anon, authenticated;

alter table public.profiles add column if not exists customer_no text;
alter table public.profiles add column if not exists partner_no  text;
create unique index if not exists profiles_customer_no on public.profiles(customer_no) where customer_no is not null;
create unique index if not exists profiles_partner_no  on public.profiles(partner_no)  where partner_no  is not null;
comment on column public.profiles.customer_no is '顧客番号（C＋8桁＋検査数字）。変わらない';
comment on column public.profiles.partner_no  is 'パートナー番号（P＋8桁＋検査数字）。変わらない';

-- ---------------------------------------------------------------
-- ② 番号を作る
-- ---------------------------------------------------------------
--  検査数字（Luhn）。右端の桁から1つおきに2倍して足す
create or replace function public.party_no_check(p_digits text)
returns integer
language sql immutable set search_path = public as $$
  select (10 - (coalesce(sum(case when (length(p_digits) - i) % 2 = 0
                                  then case when d * 2 > 9 then d * 2 - 9 else d * 2 end
                                  else d end), 0) % 10)) % 10
    from (select i, substr(p_digits, i, 1)::int as d from generate_series(1, length(p_digits)) as i) t;
$$;

--  その方の番号（無ければ乱数で作って台帳に残す）。同じ方・同じ種類なら、いつも同じ番号
create or replace function public.party_no_issue(p_user uuid, p_kind text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_no   text;
  v_body text;
  v_try  integer := 0;
begin
  if p_kind not in ('C', 'P') or p_user is null then return null; end if;
  select no into v_no from public.party_numbers where user_id = p_user and kind = p_kind;
  if v_no is not null then return v_no; end if;
  loop
    v_try := v_try + 1;
    --  乱数の8桁（先頭は1〜9）。gen_random_uuid の乱数部分から取る（順番や件数を映さない）
    v_body := (10000000 + (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint % 90000000))::text;
    v_no := p_kind || v_body || public.party_no_check(v_body)::text;
    begin
      insert into public.party_numbers (no, kind, user_id) values (v_no, p_kind, p_user);
      return v_no;
    exception when unique_violation then
      --  同じ番号がもうある（まれ）か、同じ方の番号を同時に作った。後者なら、それを返す
      select no into v_no from public.party_numbers where user_id = p_user and kind = p_kind;
      if v_no is not null then return v_no; end if;
      if v_try >= 50 then raise exception '番号を作れませんでした（もう一度お試しください）'; end if;
    end;
  end loop;
end $$;
revoke all on function public.party_no_issue(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- ③ 自動で付ける・書き換えさせない（profiles の見張り）
-- ---------------------------------------------------------------
--  権限の見張り（profiles_freeze_privileged）のあとに動く（名前の順）。役割が決まってから付ける
create or replace function public.profiles_party_no()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' then
    new.customer_no := old.customer_no;     -- 一度付いた番号は変えない（誰が書いても元に戻す）
    new.partner_no  := old.partner_no;
  else
    new.customer_no := null;                -- 画面から渡された番号は使わない
    new.partner_no  := null;
  end if;
  if new.role = 'customer' and new.customer_no is null then
    new.customer_no := public.party_no_issue(new.id, 'C');
  end if;
  if new.role = 'consultant' and new.partner_no is null then
    new.partner_no := public.party_no_issue(new.id, 'P');
  end if;
  return new;
end $$;
drop trigger if exists profiles_party_no on public.profiles;
create trigger profiles_party_no
  before insert or update on public.profiles
  for each row execute function public.profiles_party_no();

--  すでにいる方に付ける（見張りが付ける。役割は変えない）
update public.profiles set role = role
 where (role = 'customer' and customer_no is null) or (role = 'consultant' and partner_no is null);

-- ---------------------------------------------------------------
-- ④ 口座振替のお客様番号：これから作る手続きは、顧客番号の数字9桁
-- ---------------------------------------------------------------
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
    --  お客様番号は顧客番号の数字9桁（依頼書の枠が数字のことが多いため C は付けない）
    insert into public.debit_mandates (customer_id, ref_no, status, updated_by)
    values (p_customer,
            coalesce((select substr(p.customer_no, 2) from public.profiles p where p.id = p_customer),
                     substr(public.party_no_issue(p_customer, 'C'), 2)),
            'preparing', auth.uid());
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

-- ---------------------------------------------------------------
-- ⑤ 請求書番号：「年月-顧客番号」（例：202611-C482719531）。すでに付けた番号はそのまま
-- ---------------------------------------------------------------
create or replace function public.invoice_mail_prepare(p_period text, p_customer uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ids   uuid[];
  v_total integer;
  v_row   public.invoice_mails;
  v_cno   text;
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
  v_cno := coalesce((select p.customer_no from public.profiles p where p.id = p_customer),
                    public.party_no_issue(p_customer, 'C'));

  insert into public.invoice_mails (customer_id, period, invoice_no, invoice_ids, total, prepared_by)
  values (p_customer, p_period, replace(p_period, '-', '') || '-' || v_cno, v_ids, v_total, auth.uid())
  on conflict (customer_id, period) do update
    set issued_on   = case when public.invoice_mails.invoice_ids is distinct from excluded.invoice_ids
                           then v_today else public.invoice_mails.issued_on end,
        invoice_ids = excluded.invoice_ids,
        total       = excluded.total,
        prepared_by = excluded.prepared_by,
        prepared_at = now(),
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
    where table_schema = 'public' and table_name = 'party_numbers')                          as "台帳",
  (select count(*) from public.profiles where role = 'customer'   and customer_no is null)   as "番号の無い顧客",
  (select count(*) from public.profiles where role = 'consultant' and partner_no  is null)   as "番号の無いパートナー",
  (select (count(customer_no) - count(distinct customer_no)) + (count(partner_no) - count(distinct partner_no))
     from public.profiles)                                                                    as "重なり",
  (select count(*) from pg_trigger where tgname = 'profiles_party_no' and not tgisinternal)   as "見張り";
--  期待値：台帳=1、番号の無い顧客=0、番号の無いパートナー=0、重なり=0、見張り=1
