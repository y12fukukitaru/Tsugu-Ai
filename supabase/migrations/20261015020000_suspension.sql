-- =============================================================
-- 3か月分の滞納で、翌月1日からご利用を一時停止する（2026-10-15）
-- ---------------------------------------------------------------
--  決めたこと
--    ・止める時：期日を過ぎて入っていない顧問料が3か月分たまった、その翌月の1日から
--      （例：7月・8月・9月分が入っていない → 10月1日から）。月の請求を止める判定
--      （billing_held）と同じものを、その月の1日で見る
--    ・止めたあいだ：ログインはできるが、出るのは「ご利用を一時停止しています」と
--      未入金の内訳・お振込先・問い合わせ先だけ（画面）。データベースの側でも、
--      ご本人はお支払いに関わる表のほかは読めない・書けない（すべての表に「止める側の決まり」）
--    ・再開：入金を記録して、たまった顧問料が3か月分を下回れば、その場で再開（自動）。
--      運営は「停止を解く」で、その月だけ先に再開させることもできる
--    ・知らせ：止めた日に、ご本人と担当パートナーへメール（Edge Function billing-mail、
--      毎朝 9:00 に呼ぶ。送ったら記録）。2か月分たまった時点の「お振込みのお願い」にも
--      「もう1か月分たまると、翌月1日から一時停止」と書く（billing-mail 側）
--    ・データは消さない。止めるだけ
--
--  ■ 契約書：お支払いが遅れたときに利用を止める定めを、顧問契約書に足してから使ってください
--    （docs/suspension-clause.md の案。弁護士の確認を受けてから公開）
--
--  ■ 新しい表を足したとき
--    この SQL をもう一度流してください（何度流しても同じ）。最後の確かめで
--    「守りの無い表」が 0 なら、全部の表に入っています。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           先に 20261015010000_dunning.sql を流しておいてください。
--           毎朝の呼び出しは、毎朝のブリーフ（agent-heartbeat-daily）の URL と合言葉を写して作ります。
--           あわせて Edge Function「billing-mail」を新しい中身で入れ直してください。
--
-- 確かめかた（最後の select）: 表=1、関数=6、守りの無い表=0、毎朝の呼び出し=1
-- =============================================================

-- ---------------------------------------------------------------
-- ① 止めた月の記録（知らせを送ったか・運営が解いたか）
-- ---------------------------------------------------------------
create table if not exists public.service_suspensions (
  customer_id          uuid not null references auth.users(id) on delete cascade,
  month                text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  started_at           timestamptz not null default now(),
  notified_at          timestamptz,          -- ご本人へ知らせた
  partner_notified_at  timestamptz,          -- 担当パートナーへ知らせた
  notify_error         text,
  lifted_at            timestamptz,          -- 運営が「停止を解く」を押した（その月だけ）
  lifted_by            uuid,
  lift_reason          text,
  primary key (customer_id, month)
);
comment on table public.service_suspensions is
  '利用の一時停止の記録（月ごと）。止めるかどうかは未収から決まり、ここは知らせと解除だけを残す';

-- ---------------------------------------------------------------
-- ② 止めているか
-- ---------------------------------------------------------------
--  その方は、いま止めているか（たまった顧問料が3か月分以上で、運営が今月解いていない）
create or replace function public.tsugu_suspended(p_customer uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'customer'
       and public.billing_held(p.id, date_trunc('month', (now() at time zone 'Asia/Tokyo')::date)::date)
       and not exists (select 1 from public.service_suspensions s
                        where s.customer_id = p.id
                          and s.month = to_char((now() at time zone 'Asia/Tokyo')::date, 'YYYY-MM')
                          and s.lifted_at is not null)
      from public.profiles p where p.id = p_customer), false);
$$;
revoke all on function public.tsugu_suspended(uuid) from public, anon;
grant execute on function public.tsugu_suspended(uuid) to authenticated;

--  いまログインしている方が使えるか（止めている顧客ご本人だけが false）。
--  運営・パートナーは、表を1回読むだけですぐ true を返す
create or replace function public.tsugu_active()
returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles p
                      where p.id = auth.uid() and p.role = 'customer'
                        and public.tsugu_suspended(p.id));
$$;
revoke all on function public.tsugu_active() from public, anon;
grant execute on function public.tsugu_active() to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.tsugu_active() to service_role';
    execute 'grant execute on function public.tsugu_suspended(uuid) to service_role';
  end if;
end $do$;

--  止めたあいだの画面に出すもの。見られるのは、ご本人・閲覧メンバー・担当パートナー・運営
create or replace function public.service_status(p_customer uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_items jsonb;
  v_total integer;
  v_pname text;
  v_pmail text;
begin
  if not (auth.uid() = p_customer
          or public.dunning_can(p_customer)
          or exists (select 1 from public.company_members m
                      where m.customer_id = p_customer and m.member_id = auth.uid() and m.status = 'active')) then
    return jsonb_build_object('ok', false, 'error', '見られません');
  end if;
  if not public.tsugu_suspended(p_customer) then
    return jsonb_build_object('ok', true, 'suspended', false);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'period', i.period, 'kind', i.kind, 'title', i.title,
           'amount_ex', i.amount_ex, 'tax', i.tax, 'amount', i.amount,
           'paid_amount', coalesce(i.paid_amount,0), 'due_on', i.due_on) order by i.due_on), '[]'::jsonb),
         coalesce(sum(i.amount - coalesce(i.paid_amount,0)),0)::integer
    into v_items, v_total
    from public.invoices i
   where i.customer_id = p_customer and i.status in ('open','partial')
     and i.due_on < v_today and i.amount - coalesce(i.paid_amount,0) > 0;
  select coalesce(pt.full_name, pt.company_name, ''), coalesce(pt.email, '')
    into v_pname, v_pmail
    from public.profiles c left join public.profiles pt on pt.id = c.consultant_id
   where c.id = p_customer;
  return jsonb_build_object('ok', true, 'suspended', true,
    'since', to_char(date_trunc('month', v_today), 'YYYY-MM-DD'),
    'items', v_items, 'total', v_total,
    'partner_name', v_pname, 'partner_email', v_pmail);
end $$;
revoke all on function public.service_status(uuid) from public, anon;
grant execute on function public.service_status(uuid) to authenticated;

--  運営：その月だけ停止を解く（お振込みの連絡を受けた・分割の約束をした など）
create or replace function public.suspension_lift(p_customer uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_month text := to_char((now() at time zone 'Asia/Tokyo')::date, 'YYYY-MM');
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;
  if btrim(coalesce(p_reason,'')) = '' then
    return jsonb_build_object('ok', false, 'error', '解く理由をご記入ください（例：〇日に振込のご連絡あり）');
  end if;
  insert into public.service_suspensions (customer_id, month, lifted_at, lifted_by, lift_reason)
  values (p_customer, v_month, now(), auth.uid(), btrim(p_reason))
  on conflict (customer_id, month) do update
    set lifted_at = now(), lifted_by = auth.uid(), lift_reason = btrim(p_reason);
  return jsonb_build_object('ok', true, 'month', v_month);
end $$;
revoke all on function public.suspension_lift(uuid, text) from public, anon;
grant execute on function public.suspension_lift(uuid, text) to authenticated;

alter table public.service_suspensions enable row level security;
drop policy if exists service_suspensions_read on public.service_suspensions;
create policy service_suspensions_read on public.service_suspensions
  for select to authenticated using (public.dunning_can(customer_id));
revoke all on public.service_suspensions from anon, authenticated;
grant select on public.service_suspensions to authenticated;

-- ---------------------------------------------------------------
-- ③ データベースの側でも止める（止めている顧客ご本人だけ）
-- ---------------------------------------------------------------
--  お支払いに関わる表（お支払い画面・止めた画面に要るもの）は外す。
--  ほかの表は、すべてに「止める側の決まり」を1つずつ足す（二段階認証の守りと同じ形）
do $do$
declare t text;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
       and c.relname not in ('profiles','invoices','app_settings','debit_mandates','dunning_notices',
                             'setup_fee_notices','service_suspensions','company_members')
  loop
    execute format('drop policy if exists "service active" on public.%I', t);
    execute format('create policy "service active" on public.%I as restrictive for all to authenticated '
                   'using (public.tsugu_active()) with check (public.tsugu_active())', t);
  end loop;
end $do$;

-- ---------------------------------------------------------------
-- ④ 毎朝 9:00（JST）に、止めた方へのお知らせを送る
-- ---------------------------------------------------------------
--  URL と合言葉は、毎朝のブリーフ（agent-heartbeat-daily）の呼び出しから写す
do $do$
declare
  c text;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron がありません。毎朝の呼び出しは作りませんでした';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'suspend-notify') then
    raise notice 'suspend-notify はすでに登録済みです（そのままにします）';
    return;
  end if;
  select command into c from cron.job where jobname = 'agent-heartbeat-daily';
  if c is null or position('/functions/v1/agent-heartbeat' in c) = 0
     or position('<CRON_SECRET>' in c) > 0 or position('<PROJECT-REF>' in c) > 0 then
    raise exception '毎朝のブリーフ（agent-heartbeat-daily）の呼び出しが見つからないか、URL・合言葉が入っていません';
  end if;
  c := replace(c, '/functions/v1/agent-heartbeat', '/functions/v1/billing-mail');
  c := replace(c, '''{}''::jsonb', '''{"action":"suspend_notify"}''::jsonb');
  if position('suspend_notify' in c) = 0 then
    raise exception '毎朝のブリーフの呼び出しの形が想定と違います（body を書き換えられませんでした）';
  end if;
  --  0:00 UTC = 9:00 JST
  perform cron.schedule('suspend-notify', '0 0 * * *', c);
end
$do$;

-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name = 'service_suspensions')                              as "表",
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('tsugu_suspended','tsugu_active','service_status','suspension_lift','billing_held','dunning_can')) as "関数",
  (select count(*)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
      and c.relname not in ('profiles','invoices','app_settings','debit_mandates','dunning_notices',
                            'setup_fee_notices','service_suspensions','company_members')
      and not exists (select 1 from pg_policies p
                       where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'service active')) as "守りの無い表",
  --  pg_cron が無い環境でも、この select 自体は止まらないように（cron.job を直接は書かない）
  (case when to_regclass('cron.job') is null then 0
        else (xpath('/row/n/text()', query_to_xml(
               'select count(*) as n from cron.job where jobname = ''suspend-notify''', false, true, '')))[1]::text::int
   end)                                                                                             as "毎朝の呼び出し";
--  期待値：表=1、関数=6、守りの無い表=0、毎朝の呼び出し=1
