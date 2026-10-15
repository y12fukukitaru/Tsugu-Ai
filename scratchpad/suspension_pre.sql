-- 停止の試験の土台（debit_stub と 3本の SQL のあと、停止の SQL の前に流す）
-- 本番では流さない
do $guard$ begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin','supabase_auth_admin','authenticator')) then
    raise exception '⛔ 試験用です。本番では実行しません。';
  end if;
end $guard$;
delete from public.invoices; delete from public.profiles; delete from auth.users;
create table if not exists public.company_members (customer_id uuid, member_id uuid, status text);
alter table public.company_members enable row level security;
drop policy if exists cm_read on public.company_members;
create policy cm_read on public.company_members for select to authenticated using (member_id = auth.uid() or customer_id = auth.uid());
grant select on public.company_members to authenticated;
drop table if exists public.financial_entries;
create table public.financial_entries (customer_id uuid, amount int);
alter table public.financial_entries enable row level security;
create policy fe_rw on public.financial_entries for all to authenticated
  using (customer_id = auth.uid() or exists (select 1 from public.profiles p where p.id = financial_entries.customer_id and p.consultant_id = auth.uid()))
  with check (customer_id = auth.uid());
grant select, insert on public.financial_entries to authenticated;
-- 毎朝のブリーフ（本番の pg_cron の写し）
drop schema if exists cron cascade;
create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job values (n, s, c); select 1::bigint $$;
insert into cron.job values ('agent-heartbeat-daily', '0 21 * * *',
 $c$ select net.http_post(url := 'https://ref.supabase.co/functions/v1/agent-heartbeat', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','secret-xyz'), body    := '{}'::jsonb); $c$);
-- 人
insert into auth.users values
 ('20000000-0000-0000-0000-00000000000a','a@x'),('20000000-0000-0000-0000-0000000000c1','c1@x'),
 ('20000000-0000-0000-0000-0000000000c2','c2@x'),('20000000-0000-0000-0000-0000000000d1','m1@x'),
 ('20000000-0000-0000-0000-0000000000b1','p1@x');
insert into public.profiles(id, role, plan, consultant_id, company_name, created_at) values
 ('20000000-0000-0000-0000-00000000000a','admin',null,null,'運営','2026-01-01'),
 ('20000000-0000-0000-0000-0000000000c1','customer','buyer','20000000-0000-0000-0000-0000000000b1','一社','2026-01-01'),
 ('20000000-0000-0000-0000-0000000000c2','customer','buyer',null,'二社','2026-01-01'),
 ('20000000-0000-0000-0000-0000000000d1','customer','buyer',null,'メンバー','2026-01-01'),
 ('20000000-0000-0000-0000-0000000000b1','consultant',null,null,'P1','2026-01-01');
update public.profiles set full_name = company_name;
insert into public.company_members values ('20000000-0000-0000-0000-0000000000c1','20000000-0000-0000-0000-0000000000d1','active');
insert into public.financial_entries values ('20000000-0000-0000-0000-0000000000c1', 10), ('20000000-0000-0000-0000-0000000000c2', 20);
--  C1：今月の1日より前が期日の顧問料が3か月分、入っていない
insert into public.invoices(customer_id, period, kind, title, amount_ex, tax, amount, due_on, method, status, paid_amount)
select '20000000-0000-0000-0000-0000000000c1', to_char(d, 'YYYY-MM'), 'advisory', to_char(d, 'YYYY-MM')||' 顧問料', 45000, 4500, 49500,
       (d + interval '26 day')::date, 'transfer', 'open', 0
  from (select (date_trunc('month', (now() at time zone 'Asia/Tokyo')::date) - make_interval(months => k))::date d
          from generate_series(1,3) k) x;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
