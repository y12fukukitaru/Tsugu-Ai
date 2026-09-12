-- 顧問プラン・出口の設計 SQL の試験（手元の PostgreSQL 用。Supabase では流さない）
\set ON_ERROR_STOP on
create or replace function public.t_assert(name text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception '× % : got=% want=%', name, got, want; end if;
  raise notice '○ %', name;
end $$;
\set c1 '''00000000-0000-0000-0000-0000000000c1'''
\set c2 '''00000000-0000-0000-0000-0000000000c2'''
\set c3 '''00000000-0000-0000-0000-0000000000c3'''
\set p1 '''00000000-0000-0000-0000-0000000000b1'''
\set a1 '''00000000-0000-0000-0000-0000000000a1'''

-- 既定は買い手・月額 45,000／売り手 30,000（料金表が空でも）
select public.t_assert('既存の顧客は買い手', (select plan from public.profiles where id=:c1), 'buyer');
select public.t_assert('買い手の月額', public.plan_fee('buyer')::text, '45000');
select public.t_assert('売り手の月額', public.plan_fee('seller')::text, '30000');
insert into public.app_settings(key,value) values ('billing_rates','{"bl-adv":"45000","bl-seller":"33000"}') on conflict (key) do update set value=excluded.value;
select public.t_assert('料金表が勝つ', public.plan_fee('seller')::text, '33000');
select public.be(:p1::uuid);
select public.t_assert('パートナーも月額を引ける', (public.my_billing_rates()->>'seller'), '33000');

-- 切替の依頼：パートナーだけ・担当の顧客だけ・二重不可
select public.be(:c1::uuid);
select public.t_assert('経営者は依頼できない', left(public.plan_request(:c1::uuid,'seller','売りたい'),6), 'error:');
select public.be(:p1::uuid);
select public.t_assert('担当でない顧客は依頼できない', left(public.plan_request(:c2::uuid,'seller',null),6), 'error:');
select public.t_assert('同じプランへは依頼できない', left(public.plan_request(:c1::uuid,'buyer',null),6), 'error:');
select public.t_assert('担当パートナーが依頼', public.plan_request(:c1::uuid,'seller','後継者不在で3年以内に譲渡を検討'), 'ok');
select public.t_assert('運営に知らせが届く', (select count(*)::text from public.agent_insights where kind='plan_request' and user_id=:a1::uuid), '1');
select public.t_assert('二重の依頼は断る', left(public.plan_request(:c1::uuid,'seller',null),6), 'error:');
select public.t_assert('パートナーは依頼を読める', (select count(*)::text from public.plan_requests where customer_id=:c1::uuid), '1');

-- 切替：運営だけ。翌月1日から
select public.t_assert('パートナーは切り替えられない', left(public.plan_set(:c1::uuid,'seller',null),6), 'error:');
select public.be(:a1::uuid);
select public.t_assert('運営が切り替える', public.plan_set(:c1::uuid,'seller',null), 'ok');
select public.t_assert('プランは売り手', (select plan from public.profiles where id=:c1::uuid), 'seller');
select public.t_assert('前のプランは買い手', (select plan_prev from public.profiles where id=:c1::uuid), 'buyer');
select public.t_assert('効くのは翌月1日', (select plan_from::text from public.profiles where id=:c1::uuid), (date_trunc('month', (now() at time zone 'Asia/Tokyo')::date) + interval '1 month')::date::text);
select public.t_assert('依頼は done', (select status from public.plan_requests where customer_id=:c1::uuid), 'done');
select public.t_assert('経営者とパートナーに知らせ', (select count(*)::text from public.agent_insights where kind='plan_changed'), '2');
select public.t_assert('今月はまだ買い手', public.plan_effective(:c1::uuid, (now() at time zone 'Asia/Tokyo')::date), 'buyer');
select public.t_assert('来月から売り手', public.plan_effective(:c1::uuid, (date_trunc('month', (now() at time zone 'Asia/Tokyo')::date) + interval '1 month')::date), 'seller');

-- 請求：その月に効いているプランの月額。運営直接担当は一律
\set thism `date -d "$(date +%Y-%m-01)" +%Y-%m`
\set nextm `date -d "$(date +%Y-%m-01) +1 month" +%Y-%m`
select public.t_assert('今月の請求を立てる', (public.invoice_generate(:'thism', 27)->>'made'), '3');
select public.t_assert('A社の今月は買い手 45,000', (select amount_ex::text from public.invoices where customer_id=:c1::uuid and period=:'thism'), '45000');
select public.t_assert('A社の今月の件名', (select title from public.invoices where customer_id=:c1::uuid and period=:'thism'), :'thism' || ' 顧問料（買い手プラン）');
select public.t_assert('B社（運営直接）は 30,000', (select amount_ex::text from public.invoices where customer_id=:c2::uuid and period=:'thism'), '30000');
select public.t_assert('来月の請求を立てる', (public.invoice_generate(:'nextm', 27)->>'made'), '3');
select public.t_assert('A社の来月は売り手 33,000（料金表）', (select amount_ex::text from public.invoices where customer_id=:c1::uuid and period=:'nextm'), '33000');
select public.t_assert('A社の来月の件名', (select title from public.invoices where customer_id=:c1::uuid and period=:'nextm'), :'nextm' || ' 顧問料（売り手プラン）');

-- 見送り
select public.be(:p1::uuid);
select public.t_assert('もう一度依頼（買い手へ戻す）', public.plan_request(:c1::uuid,'buyer','やはり続けたい'), 'ok');
select public.be(:a1::uuid);
select public.t_assert('運営が見送る', public.plan_reject((select id from public.plan_requests where customer_id=:c1::uuid and status='pending'), '半年は様子見'), 'ok');
select public.t_assert('見送りの知らせがパートナーへ', (select count(*)::text from public.agent_insights where kind='plan_rejected' and user_id=:p1::uuid), '1');
select public.t_assert('プランは売り手のまま', (select plan from public.profiles where id=:c1::uuid), 'seller');

-- 契約書：{{プラン}} の差し込みと、登録時のプランの引き継ぎ
select public.t_assert('ひな形の新しい版が公開', (select version::text from public.contract_templates where kind='customer' and active), '2');
select public.t_assert('第2条がプランの規定に', (select (position('契約時のプラン（{{プラン}}）' in body) > 0 and position('翌月の請求から新しい月額' in body) > 0)::text from public.contract_templates where kind='customer' and active), 'true');
select public.t_assert('第2条の2 は残る', (select (position('第2条の2（初期導入費）' in body) > 0)::text from public.contract_templates where kind='customer' and active), 'true');
select public.t_assert('M&A の優遇と利益相反', (select (position('最低報酬額を設けず' in body) > 0 and position('最大50%' in body) > 0 and position('利益相反' in body) > 0)::text from public.contract_templates where kind='customer' and active), 'true');
select public.t_assert('契約者欄にプラン', (select (position('プラン：{{プラン}}' in body) > 0)::text from public.contract_templates where kind='customer' and active), 'true');
insert into public.contract_offers (kind, token, email, monthly_fee, consultant_id, offered_by, plan, body)
  select 'customer', repeat('t',40), 'new@x.jp', 30000, :p1::uuid, :p1::uuid, 'seller', body from public.contract_templates where kind='customer' and active;
select public.be(null);
select public.t_assert('同意できる', (public.contract_agree(repeat('t',40), '新 太郎', '株式会社新')->>'ok'), 'true');
select public.t_assert('書面にプラン名', (select (position('売り手プラン（譲渡準備）' in agreed_body) > 0 and position('{{プラン}}' in agreed_body) = 0)::text from public.contract_offers where token=repeat('t',40)), 'true');
select public.be(:c3::uuid);
select public.t_assert('登録で契約を引き当てる', public.contract_claim(), 'claimed:customer');
select public.t_assert('プランと担当を引き継ぐ', (select plan || '/' || coalesce(consultant_id::text,'') from public.profiles where id=:c3::uuid), 'seller/' || :p1);
select public.t_assert('最初から効く', (select (plan_from is null)::text from public.profiles where id=:c3::uuid), 'true');

-- 出口の設計：本人・担当・運営が書ける。他人は読めない
select public.be(:c1::uuid);
create or replace function public.t_as(uid uuid, q text) returns text language plpgsql as $$
declare r text;
begin
  perform public.be(uid);
  perform set_config('role', 'authenticated', true);
  execute q into r;
  execute 'reset role';
  return r;
end $$;
select public.t_assert('経営者が出口を書く', public.t_as(:c1::uuid, $q$insert into public.exit_plans (customer_id, exit_type, target_year, targets) values ('00000000-0000-0000-0000-0000000000c1','sell',2029,'{"price":12000}') returning exit_type$q$), 'sell');
select public.t_assert('担当パートナーは読める', public.t_as(:p1::uuid, $q$select count(*)::text from public.exit_plans$q$), '1');
select public.t_assert('関係ない顧客は読めない', public.t_as(:c2::uuid, $q$select count(*)::text from public.exit_plans$q$), '0');
select public.t_assert('運営は読める', public.t_as(:a1::uuid, $q$select count(*)::text from public.exit_plans$q$), '1');
select public.t_assert('出口の種類は5つだけ', (select count(*)::text from (select 1 where exists (select 1 from information_schema.check_constraints where constraint_name like '%exit_plans_exit_type%')) x), '1');
select 'ALL OK' as result;
