-- 口座振替の手続き・初期導入費（20261015000000_debit_mandate_setup_fee.sql）の試験
-- 人：A=運営、C1=買い手の顧客、C2=売り手の顧客、P=パートナー、C3=手で初期導入費を立てた顧客
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a','a@x'),('00000000-0000-0000-0000-0000000000c1','c1@x'),
 ('00000000-0000-0000-0000-0000000000c2','c2@x'),('00000000-0000-0000-0000-00000000000b','p@x'),
 ('00000000-0000-0000-0000-0000000000c3','c3@x');
insert into public.profiles(id, role, plan, consultant_id, company_name) values
 ('00000000-0000-0000-0000-00000000000a','admin',null,null,'運営'),
 ('00000000-0000-0000-0000-0000000000c1','customer','buyer','00000000-0000-0000-0000-00000000000b','一社'),
 ('00000000-0000-0000-0000-0000000000c2','customer','seller',null,'二社'),
 ('00000000-0000-0000-0000-00000000000b','consultant',null,null,'パートナー'),
 ('00000000-0000-0000-0000-0000000000c3','customer','buyer',null,'三社');

-- ① 口座振替の手続き
select public.be('00000000-0000-0000-0000-0000000000c1');
select public.chk('顧客は記録できない', public.debit_mandate_set('00000000-0000-0000-0000-0000000000c1','registered')->>'ok', 'false');
select public.be('00000000-0000-0000-0000-00000000000a');
select public.chk('用紙を準備：お客様番号を発行', (public.debit_mandate_set('00000000-0000-0000-0000-0000000000c1','preparing')->>'ref_no') ~ '^1[0-9]{5}$', true);
select public.chk('パートナーには記録しない', public.debit_mandate_set('00000000-0000-0000-0000-00000000000b','preparing')->>'ok', 'false');
select public.chk('理由なしの不備返却は止める', public.debit_mandate_set('00000000-0000-0000-0000-0000000000c1','returned')->>'ok', 'false');
select public.debit_mandate_set('00000000-0000-0000-0000-0000000000c1','sent', '2026-10-01');
select public.debit_mandate_set('00000000-0000-0000-0000-0000000000c1','returned', '2026-10-10', '印鑑相違');
select public.chk('不備返却：理由と日付', (select return_reason||'/'||returned_on from public.debit_mandates where customer_id='00000000-0000-0000-0000-0000000000c1'), '印鑑相違/2026-10-10');
select public.debit_mandate_set('00000000-0000-0000-0000-0000000000c1','sent', '2026-10-12');
select public.debit_mandate_set('00000000-0000-0000-0000-0000000000c1','registered', '2026-11-20');
select public.chk('登録完了：理由は消え、番号は変わらない',
  (select status||'/'||coalesce(return_reason,'-')||'/'||registered_on from public.debit_mandates where customer_id='00000000-0000-0000-0000-0000000000c1'),
  'registered/-/2026-11-20');
select public.chk('番号は1人1つ', (select count(distinct ref_no) from public.debit_mandates), 1::bigint);
select public.debit_mandate_set('00000000-0000-0000-0000-0000000000c2','preparing');
select public.chk('番号は人ごとに違う', (select count(distinct ref_no) from public.debit_mandates), 2::bigint);

-- 見える範囲
set role authenticated;
select public.be('00000000-0000-0000-0000-0000000000c1');
select public.chk('ご本人は自分の行だけ', (select count(*) from public.debit_mandates), 1::bigint);
select public.be('00000000-0000-0000-0000-00000000000b');
select public.chk('担当パートナーは担当先の行だけ', (select count(*) from public.debit_mandates), 1::bigint);
select public.be('00000000-0000-0000-0000-0000000000c3');
select public.chk('ほかの顧客には見えない', (select count(*) from public.debit_mandates), 0::bigint);
select public.be('00000000-0000-0000-0000-00000000000a');
select public.chk('運営は全部', (select count(*) from public.debit_mandates), 2::bigint);
reset role;

-- 請求を手続きに合わせる
insert into public.invoices(customer_id, period, kind, title, amount_ex, tax, amount, due_on, method, status, paid_amount) values
 ('00000000-0000-0000-0000-0000000000c1','2026-12','advisory','顧問料',45000,4500,49500,'2026-12-27','bank','open',0),
 ('00000000-0000-0000-0000-0000000000c2','2026-12','advisory','顧問料',35000,3500,38500,'2026-12-27','transfer','open',0),
 ('00000000-0000-0000-0000-0000000000c3','2026-12','advisory','顧問料',45000,4500,49500,'2026-12-27','bank','partial',1000);
select public.be('00000000-0000-0000-0000-0000000000c1');
select public.chk('顧客は合わせられない', public.invoice_apply_mandates('2026-12')->>'ok', 'false');
select public.be('00000000-0000-0000-0000-00000000000a');
select public.chk('合わせる：振替1・振込1', (select (r->>'to_transfer')||'/'||(r->>'to_bank') from (select public.invoice_apply_mandates('2026-12') r) t), '1/1');
select public.chk('登録完了の方は口座振替', (select method from public.invoices where customer_id='00000000-0000-0000-0000-0000000000c1'), 'transfer');
select public.chk('手続き中の方は銀行振込', (select method from public.invoices where customer_id='00000000-0000-0000-0000-0000000000c2'), 'bank');
select public.chk('入金のある請求は触らない', (select method from public.invoices where customer_id='00000000-0000-0000-0000-0000000000c3'), 'bank');
select public.chk('二度目は何も変えない', (select (r->>'to_transfer')||'/'||(r->>'to_bank') from (select public.invoice_apply_mandates('2026-12') r) t), '0/0');

-- ② 初期導入費
insert into public.app_settings values ('billing_rates', '{"bl-init":"120000"}');
insert into public.contract_offers(id, kind, plan, email, status) values
 ('00000000-0000-0000-0000-0000000000f1','customer','buyer','c1@x','agreed'),
 ('00000000-0000-0000-0000-0000000000f2','customer','seller','c2@x','agreed'),
 ('00000000-0000-0000-0000-0000000000f3','partner',null,'p@x','agreed'),
 ('00000000-0000-0000-0000-0000000000f4','customer','buyer','c3@x','agreed');
update public.contract_offers set claimed_user_id='00000000-0000-0000-0000-0000000000c1' where id='00000000-0000-0000-0000-0000000000f1';
select public.chk('受け取った瞬間に初期導入費（料金表の額・税込）',
  (select amount_ex||'/'||amount||'/'||kind||'/'||method||'/'||title from public.invoices where customer_id='00000000-0000-0000-0000-0000000000c1' and kind='setup'),
  '120000/132000/setup/bank/初期導入費（買い手プラン）');
select public.chk('期日は翌月末', (select due_on = (date_trunc('month', (now() at time zone 'Asia/Tokyo')::date) + interval '2 month' - interval '1 day')::date
  from public.invoices where customer_id='00000000-0000-0000-0000-0000000000c1' and kind='setup'), true);
select public.chk('ご案内の記録（未送信）', (select count(*) from public.setup_fee_notices where customer_id='00000000-0000-0000-0000-0000000000c1' and mailed_at is null and invoice_id is not null), 1::bigint);
--  ログインのたびに同じ値を書き直しても、増えない
update public.contract_offers set claimed_user_id='00000000-0000-0000-0000-0000000000c1' where id='00000000-0000-0000-0000-0000000000f1';
select public.chk('ログインのたびには立てない', (select count(*) from public.invoices where kind='setup' and customer_id='00000000-0000-0000-0000-0000000000c1'), 1::bigint);
update public.contract_offers set claimed_user_id='00000000-0000-0000-0000-0000000000c2' where id='00000000-0000-0000-0000-0000000000f2';
select public.chk('売り手は売り手の額（料金表が空なら50,000）', (select amount_ex from public.invoices where customer_id='00000000-0000-0000-0000-0000000000c2' and kind='setup'), 50000);
update public.contract_offers set claimed_user_id='00000000-0000-0000-0000-00000000000b' where id='00000000-0000-0000-0000-0000000000f3';
select public.chk('パートナーの契約には立てない', (select count(*) from public.invoices where customer_id='00000000-0000-0000-0000-00000000000b'), 0::bigint);
--  運営が手で立てていた方：新しく立てず、それを案内する
insert into public.invoices(customer_id, period, kind, title, amount_ex, tax, amount, due_on, method) values
 ('00000000-0000-0000-0000-0000000000c3','2026-10','setup','初期導入費（手）',100000,10000,110000,'2026-11-30','bank');
update public.contract_offers set claimed_user_id='00000000-0000-0000-0000-0000000000c3' where id='00000000-0000-0000-0000-0000000000f4';
select public.chk('手で立てた初期導入費があれば二本にしない', (select count(*) from public.invoices where customer_id='00000000-0000-0000-0000-0000000000c3' and kind='setup'), 1::bigint);
select public.chk('その請求を案内する', (select n.invoice_id = i.id from public.setup_fee_notices n join public.invoices i on i.customer_id=n.customer_id and i.kind='setup' where n.customer_id='00000000-0000-0000-0000-0000000000c3'), true);
--  自動を外すと何もしない
update public.app_settings set value = value || '{"bl-setup-auto":"0"}' where key='billing_rates';
insert into auth.users values ('00000000-0000-0000-0000-0000000000c4','c4@x');
insert into public.profiles(id, role, plan) values ('00000000-0000-0000-0000-0000000000c4','customer','buyer');
insert into public.contract_offers(id, kind, plan, email, status) values ('00000000-0000-0000-0000-0000000000f5','customer','buyer','c4@x','agreed');
update public.contract_offers set claimed_user_id='00000000-0000-0000-0000-0000000000c4' where id='00000000-0000-0000-0000-0000000000f5';
select public.chk('自動を外すと立てない', (select count(*) from public.invoices where customer_id='00000000-0000-0000-0000-0000000000c4'), 0::bigint);

-- まだ送っていないご案内
set role authenticated;
select public.be('00000000-0000-0000-0000-0000000000c1');
select public.chk('ご本人の未送信は1', public.setup_notice_pending(), 1);
select public.chk('ご本人には自分の記録だけ', (select count(*) from public.setup_fee_notices), 1::bigint);
select public.be('00000000-0000-0000-0000-00000000000b');
select public.chk('パートナーには見えない', (select count(*) from public.setup_fee_notices), 0::bigint);
reset role;

select (select count(*) from public.__t where got is distinct from want) as "不合格", (select count(*) from public.__t) as "全部";
select n, name, got, want from public.__t where got is distinct from want order by n;
