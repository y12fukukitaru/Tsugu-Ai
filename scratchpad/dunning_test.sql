-- お振込みのお願い・3か月の滞納で請求を止める（20261015010000_dunning.sql）の試験
-- 人：A=運営、C1=滞納の顧客（担当P1）、C2=担当なし、P1=担当パートナー、P2=ほかのパートナー、S=サブ担当
truncate public.__t;
delete from public.invoices; delete from public.profiles; delete from auth.users;
insert into auth.users values
 ('10000000-0000-0000-0000-00000000000a','a@x'),('10000000-0000-0000-0000-0000000000c1','c1@x'),
 ('10000000-0000-0000-0000-0000000000c2','c2@x'),('10000000-0000-0000-0000-0000000000b1','p1@x'),
 ('10000000-0000-0000-0000-0000000000b2','p2@x'),('10000000-0000-0000-0000-0000000000b3','s@x');
insert into public.profiles(id, role, plan, consultant_id, company_name, created_at) values
 ('10000000-0000-0000-0000-00000000000a','admin',null,null,'運営','2026-01-01'),
 ('10000000-0000-0000-0000-0000000000c1','customer','buyer','10000000-0000-0000-0000-0000000000b1','一社','2026-01-01'),
 ('10000000-0000-0000-0000-0000000000c2','customer','buyer',null,'二社','2026-01-01'),
 ('10000000-0000-0000-0000-0000000000b1','consultant',null,null,'P1','2026-01-01'),
 ('10000000-0000-0000-0000-0000000000b2','consultant',null,null,'P2','2026-01-01'),
 ('10000000-0000-0000-0000-0000000000b3','consultant',null,null,'S','2026-01-01');
insert into public.partner_assignments values ('10000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-0000000000b3','approved');
--  c1：7月・8月が未入金（口座振替）、9月は一部入金、6月は入金済み、期日前の10月分
insert into public.invoices(customer_id, period, kind, title, amount_ex, tax, amount, due_on, method, status, paid_amount) values
 ('10000000-0000-0000-0000-0000000000c1','2026-06','advisory','2026-06 顧問料',45000,4500,49500,'2026-06-27','transfer','paid',49500),
 ('10000000-0000-0000-0000-0000000000c1','2026-07','advisory','2026-07 顧問料',45000,4500,49500,'2026-07-27','transfer','open',0),
 ('10000000-0000-0000-0000-0000000000c1','2026-08','advisory','2026-08 顧問料',45000,4500,49500,'2026-08-27','transfer','open',0),
 ('10000000-0000-0000-0000-0000000000c1','2026-09','advisory','2026-09 顧問料',45000,4500,49500,'2026-09-27','transfer','partial',9500),
 ('10000000-0000-0000-0000-0000000000c1','2099-10','advisory','2099-10 顧問料',45000,4500,49500,'2099-10-27','transfer','open',0);

-- 送れる人
select public.be('10000000-0000-0000-0000-0000000000b2');
select public.chk('ほかのパートナーは見られない', public.dunning_preview('10000000-0000-0000-0000-0000000000c1')->>'ok', 'false');
select public.be('10000000-0000-0000-0000-0000000000c1');
select public.chk('ご本人は送れない', public.dunning_prepare('10000000-0000-0000-0000-0000000000c1', ((now() at time zone 'Asia/Tokyo')::date + 14))->>'ok', 'false');
select public.be('10000000-0000-0000-0000-0000000000b3');
select public.chk('サブ担当は見られる', public.dunning_preview('10000000-0000-0000-0000-0000000000c1')->>'ok', 'true');
select public.be('10000000-0000-0000-0000-0000000000b1');
select public.chk('担当パートナー：まとめるのは期日を過ぎた未入金だけ（7・8・9月）',
  (select string_agg(x->>'period', ',' order by x->>'period') from jsonb_array_elements(public.dunning_preview('10000000-0000-0000-0000-0000000000c1')->'items') x), '2026-07,2026-08,2026-09');
select public.chk('お願い額は残り（49,500×2＋40,000）', (public.dunning_preview('10000000-0000-0000-0000-0000000000c1')->>'total')::int, 139000);
select public.chk('3か月分なので請求を止めている', (public.dunning_preview('10000000-0000-0000-0000-0000000000c1')->>'held')::boolean, true);
select public.chk('期日は明日から60日以内', public.dunning_prepare('10000000-0000-0000-0000-0000000000c1', (now() at time zone 'Asia/Tokyo')::date)->>'ok', 'false');
select public.chk('用意できる（3件・139,000円）',
  (select (r->>'count')||'/'||(r->>'amount') from (select public.dunning_prepare('10000000-0000-0000-0000-0000000000c1', ((now() at time zone 'Asia/Tokyo')::date + 14)) r) t), '3/139000');
select public.chk('まとめた請求は振込に切り替わる（引き落としの二重を防ぐ）',
  (select string_agg(method, ',' order by period) from public.invoices where customer_id='10000000-0000-0000-0000-0000000000c1' and period in ('2026-07','2026-08','2026-09')), 'bank,bank,bank');
select public.chk('期日前・入金済みの請求は触らない',
  (select string_agg(method, ',' order by period) from public.invoices where customer_id='10000000-0000-0000-0000-0000000000c1' and period in ('2026-06','2099-10')), 'transfer,transfer');
select public.chk('記録：パートナーが送った・3件',
  (select sent_role||'/'||array_length(invoice_ids,1) from public.dunning_notices where customer_id='10000000-0000-0000-0000-0000000000c1'), 'partner/3');
select public.chk('送っている途中に続けては用意できない', public.dunning_prepare('10000000-0000-0000-0000-0000000000c1', ((now() at time zone 'Asia/Tokyo')::date + 14))->>'ok', 'false');
--  送れなかったら、もう一度送れる
update public.dunning_notices set mail_error='送れませんでした' where customer_id='10000000-0000-0000-0000-0000000000c1';
select public.chk('送れなかったら、もう一度用意できる', public.dunning_prepare('10000000-0000-0000-0000-0000000000c1', ((now() at time zone 'Asia/Tokyo')::date + 14))->>'ok', 'true');
update public.dunning_notices set mailed_at=now(), mail_error=null where customer_id='10000000-0000-0000-0000-0000000000c1' and mail_error is null;
select public.be('10000000-0000-0000-0000-00000000000a');
select public.chk('送れたら、同じ日は運営からも送れない', public.dunning_prepare('10000000-0000-0000-0000-0000000000c1', ((now() at time zone 'Asia/Tokyo')::date + 14))->>'ok', 'false');
select public.chk('期日を過ぎた未入金が無い方には送れない', public.dunning_prepare('10000000-0000-0000-0000-0000000000c2', ((now() at time zone 'Asia/Tokyo')::date + 14))->>'error', '期日を過ぎた未入金はありません');

-- 見える範囲（記録）
set role authenticated;
select public.be('10000000-0000-0000-0000-0000000000b2');
select public.chk('ほかのパートナーには記録が見えない', (select count(*) from public.dunning_notices), 0::bigint);
select public.be('10000000-0000-0000-0000-0000000000b1');
select public.chk('担当パートナーには見える', (select count(*) > 0 from public.dunning_notices), true);
reset role;

-- 3か月の滞納で請求を止める
select public.be('10000000-0000-0000-0000-00000000000a');
select public.chk('10月の請求：c1（3か月滞納）には立てず、c2 には立てる',
  (select (r->>'made')||'/'||(r->>'held') from (select public.invoice_generate('2026-10', 27, 'bank') r) t), '1/1');
select public.chk('c1 の10月分は無い', (select count(*) from public.invoices where customer_id='10000000-0000-0000-0000-0000000000c1' and period='2026-10'), 0::bigint);
--  9月分をお振込みいただくと、未収は2か月分 → 次の月から再開
update public.invoices set status='paid', paid_amount=amount where customer_id='10000000-0000-0000-0000-0000000000c1' and period='2026-09';
select public.chk('2か月分に減れば、次の月から再開', (select (r->>'made')||'/'||(r->>'held') from (select public.invoice_generate('2026-11', 27, 'bank') r) t), '2/0');
select public.chk('止めていた10月はさかのぼって立てない', (select count(*) from public.invoices where customer_id='10000000-0000-0000-0000-0000000000c1' and period='2026-10'), 0::bigint);

select (select count(*) from public.__t where got is distinct from want) as "不合格", (select count(*) from public.__t) as "全部";
select n, name, got, want from public.__t where got is distinct from want order by n;
