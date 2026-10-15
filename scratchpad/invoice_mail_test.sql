-- 請求書メール（20261015030000_invoice_mail.sql）の試験。本番では流さない
-- 人：A=運営、C1=顧客（銀行振込）、C2=顧客（口座振替）、P1=C1の担当
truncate public.__t;
delete from public.invoice_mails;
delete from public.setup_fee_notices; delete from public.invoices; delete from public.profiles; delete from auth.users;
insert into auth.users values
 ('30000000-0000-0000-0000-00000000000a','a@x'),('30000000-0000-0000-0000-0000000000c1','c1@x'),
 ('30000000-0000-0000-0000-0000000000c2','c2@x'),('30000000-0000-0000-0000-0000000000b1','p1@x');
insert into public.profiles(id, role, plan, consultant_id, company_name) values
 ('30000000-0000-0000-0000-00000000000a','admin',null,null,'運営'),
 ('30000000-0000-0000-0000-0000000000c1','customer','buyer','30000000-0000-0000-0000-0000000000b1','一社'),
 ('30000000-0000-0000-0000-0000000000c2','customer','buyer',null,'二社'),
 ('30000000-0000-0000-0000-0000000000b1','consultant',null,null,'P1');
insert into public.invoices(id, customer_id, period, kind, title, amount_ex, tax, amount, due_on, status, paid_amount, method) values
 ('31000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-0000000000c1','2026-11','advisory','2026-11 顧問料（買い手プラン）',45000,4500,49500,'2026-11-27','open',0,'bank'),
 ('31000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-0000000000c1','2026-11','other','資料作成',10000,1000,11000,'2026-11-27','partial',1000,null),
 ('31000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-0000000000c1','2026-11','other','取り消した',10000,1000,11000,'2026-11-27','void',0,'bank'),
 ('31000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-0000000000c1','2026-10','advisory','2026-10 顧問料（買い手プラン）',45000,4500,49500,'2026-10-27','open',0,'bank'),
 ('31000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-0000000000c2','2026-11','advisory','2026-11 顧問料（買い手プラン）',45000,4500,49500,'2026-11-27','open',0,'transfer'),
 ('31000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-0000000000c2','2026-11','setup','初期導入費',100000,10000,110000,'2026-11-30','open',0,'bank');
insert into public.setup_fee_notices(offer_id, customer_id, invoice_id) values
 ('32000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-0000000000c2','31000000-0000-0000-0000-000000000006');

select public.chk('表=1・関数=1・守り=1', (select "表"||'/'||"関数"||'/'||"守り" from __im_check), '1/1/1');

set role authenticated;
select public.be('30000000-0000-0000-0000-0000000000b1');
select public.chk('パートナーは用意できない', public.invoice_mail_prepare('2026-11','30000000-0000-0000-0000-0000000000c1')->>'ok', 'false');
select public.be('30000000-0000-0000-0000-0000000000c1');
select public.chk('ご本人も用意できない', public.invoice_mail_prepare('2026-11','30000000-0000-0000-0000-0000000000c1')->>'ok', 'false');
select public.chk('表に直接は書けない', (select has_table_privilege('authenticated','public.invoice_mails','insert')), false);

select public.be('30000000-0000-0000-0000-00000000000a');
select public.chk('年月の形を確かめる', public.invoice_mail_prepare('2026/11','30000000-0000-0000-0000-0000000000c1')->>'ok', 'false');
select public.chk('C1：その月の銀行振込・未入金だけ（取消・別の月は載せない）・残りの合計',
  (select (r->>'ok')||'/'||(r->>'count')||'/'||(r->>'total') from (select public.invoice_mail_prepare('2026-11','30000000-0000-0000-0000-0000000000c1') r) t), 'true/2/59500');
select public.chk('請求書番号は 年月-通し番号', (select invoice_no ~ '^202611-[0-9]{4}$' from public.invoice_mails where customer_id='30000000-0000-0000-0000-0000000000c1'), true);
select public.chk('C2：口座振替と初回のお振込みの分は載せない（送るものが無い）',
  public.invoice_mail_prepare('2026-11','30000000-0000-0000-0000-0000000000c2')->>'ok', 'false');
reset role;

-- もう一度用意しても番号は変わらない。載せる請求が変われば発行日をその日に
update public.invoice_mails set issued_on = '2026-11-01' where customer_id='30000000-0000-0000-0000-0000000000c1';
create temp table __no as select invoice_no from public.invoice_mails where customer_id='30000000-0000-0000-0000-0000000000c1';
set role authenticated;
select public.be('30000000-0000-0000-0000-00000000000a');
select public.invoice_mail_prepare('2026-11','30000000-0000-0000-0000-0000000000c1');
reset role;
select public.chk('同じ中身：番号も発行日もそのまま',
  (select (m.invoice_no = n.invoice_no)::text||'/'||m.issued_on from public.invoice_mails m, __no n where m.customer_id='30000000-0000-0000-0000-0000000000c1'), 'true/2026-11-01');
update public.invoices set status='paid', paid_amount=amount where id='31000000-0000-0000-0000-000000000002';
set role authenticated;
select public.be('30000000-0000-0000-0000-00000000000a');
select public.chk('入金があれば載せ直す（1件・49500）',
  (select (r->>'count')||'/'||(r->>'total') from (select public.invoice_mail_prepare('2026-11','30000000-0000-0000-0000-0000000000c1') r) t), '1/49500');
reset role;
select public.chk('中身が変われば発行日はその日・番号はそのまま',
  (select (m.invoice_no = n.invoice_no)::text||'/'||(m.issued_on = (now() at time zone 'Asia/Tokyo')::date)::text from public.invoice_mails m, __no n where m.customer_id='30000000-0000-0000-0000-0000000000c1'), 'true/true');

-- 送っている途中で止まったものは、5分たてば用意し直しで解ける
update public.invoice_mails set sending_at = now() - interval '10 minutes' where customer_id='30000000-0000-0000-0000-0000000000c1';
set role authenticated;
select public.be('30000000-0000-0000-0000-00000000000a');
select public.invoice_mail_prepare('2026-11','30000000-0000-0000-0000-0000000000c1');
reset role;
select public.chk('止まった送信は解く', (select sending_at is null from public.invoice_mails where customer_id='30000000-0000-0000-0000-0000000000c1'), true);
update public.invoice_mails set sending_at = now() where customer_id='30000000-0000-0000-0000-0000000000c1';
set role authenticated;
select public.be('30000000-0000-0000-0000-00000000000a');
select public.invoice_mail_prepare('2026-11','30000000-0000-0000-0000-0000000000c1');
reset role;
select public.chk('送っている最中のものはそのまま', (select sending_at is not null from public.invoice_mails where customer_id='30000000-0000-0000-0000-0000000000c1'), true);

-- 読める人
set role authenticated;
select public.be('30000000-0000-0000-0000-0000000000c1');
select public.chk('ご本人は自分の請求書メールを読める', (select count(*) from public.invoice_mails), 1::bigint);
select public.be('30000000-0000-0000-0000-0000000000c2');
select public.chk('ほかの方のは読めない', (select count(*) from public.invoice_mails), 0::bigint);
select public.be('30000000-0000-0000-0000-0000000000b1');
select public.chk('担当パートナーは読める', (select count(*) from public.invoice_mails), 1::bigint);
select public.be('30000000-0000-0000-0000-00000000000a');
select public.chk('運営は読める', (select count(*) from public.invoice_mails), 1::bigint);
reset role;

select (select count(*) from public.__t where got is distinct from want) as "不合格", (select count(*) from public.__t) as "全部";
select n, name, got, want from public.__t where got is distinct from want order by n;
