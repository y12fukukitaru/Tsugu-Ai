-- =============================================================
-- 単発の請求と、区分ごとの消込の試験
-- =============================================================
set client_min_messages = warning;

create table if not exists public.__t (n text, ok boolean, got text, want text);
truncate public.__t;
create or replace function public.chk(n text, got text, want text) returns void
  language sql as $$ insert into public.__t values (n, got is not distinct from want, got, want) $$;

-- ---- 登場人物 ----
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1','admin@x.jp'),
  ('00000000-0000-0000-0000-0000000000c1','a@x.jp'),
  ('00000000-0000-0000-0000-0000000000c2','b@x.jp'),
  ('00000000-0000-0000-0000-0000000000c3','c@x.jp'),
  ('00000000-0000-0000-0000-0000000000c4','d@x.jp'),
  ('00000000-0000-0000-0000-0000000000c5','e@x.jp'),
  ('00000000-0000-0000-0000-0000000000c9','z@x.jp');
insert into public.profiles (id, role, email, company_name, created_at) values
  ('00000000-0000-0000-0000-0000000000a1','admin','admin@x.jp','運営','2026-01-01'),
  ('00000000-0000-0000-0000-0000000000c1','customer','a@x.jp','A社','2026-01-01'),
  ('00000000-0000-0000-0000-0000000000c2','customer','b@x.jp','B社','2026-01-01'),
  ('00000000-0000-0000-0000-0000000000c3','customer','c@x.jp','C社','2026-01-01'),
  ('00000000-0000-0000-0000-0000000000c4','customer','d@x.jp','D社','2026-01-01'),
  ('00000000-0000-0000-0000-0000000000c5','customer','e@x.jp','E社','2026-01-01'),
  ('00000000-0000-0000-0000-0000000000c9','customer','z@x.jp','Z社（解約）','2026-01-01');
insert into public.account_deletions values ('00000000-0000-0000-0000-0000000000c9');
insert into public.app_settings values
  ('billing_rates', '{"bl-adv":"45000","bl-direct":"30000","bl-bank":"〇〇銀行 本店 普通 1234567 ツグアイ（カ"}'::jsonb);

select public.be('00000000-0000-0000-0000-0000000000a1');

-- =============================================================
-- ① 月次の請求（お支払い方法つき）
-- =============================================================
--  顧客は6人だが、解約済みの Z社 は請求しないので5件
select public.chk('月次を立てる：件数',
  (select (public.invoice_generate('2026-09', 27, 'bank')->>'made')), '5');
select public.chk('月次を立てる：方法が入る',
  (select distinct method from public.invoices where kind='advisory'), 'bank');
select public.chk('解約済みは含まない',
  (select count(*)::text from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c9'), '0');
select public.chk('二度押しても増えない',
  (select (public.invoice_generate('2026-09', 27, 'bank')->>'skipped')), '5');
select public.chk('方法が正しくないと止まる',
  (select (public.invoice_generate('2026-10', 27, 'げんきん')->>'error')),
  'お支払い方法が正しくありません');

-- =============================================================
-- ② 単発の請求
-- =============================================================
select public.chk('FA手数料を立てられる',
  (public.invoice_add('00000000-0000-0000-0000-0000000000c1','fa',
    '2026-09 M&A成功報酬（甲社譲渡）', 3000000, '2026-09-30','2026-09','bank')->>'ok'), 'true');
select public.chk('FA手数料：税込',
  (select amount::text from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c1' and kind='fa'), '3300000');
select public.chk('同じ内容は二度立たない',
  (public.invoice_add('00000000-0000-0000-0000-0000000000c1','fa',
    '2026-09 M&A成功報酬（甲社譲渡）', 3000000, '2026-09-30','2026-09','bank')->>'error'),
  '同じ内容の請求がすでにあります（2026-09／2026-09 M&A成功報酬（甲社譲渡））');
--  ここが以前の索引だと入らなかった。同じ月に二本目のFAが立つこと
select public.chk('同じ月に別件のFAが立つ',
  (public.invoice_add('00000000-0000-0000-0000-0000000000c1','fa',
    '2026-09 M&A中間金（乙社）', 500000, '2026-09-30','2026-09','bank')->>'ok'), 'true');
select public.chk('顧問料は単発で立てられない',
  (public.invoice_add('00000000-0000-0000-0000-0000000000c2','advisory',
    '手で立てた顧問料', 45000, '2026-09-27','2026-09','bank')->>'error'),
  '単発で立てられるのは FA手数料・初期導入費・その他です。顧問料は「この月の請求を立てる」からどうぞ');
select public.chk('件名は必須',
  (public.invoice_add('00000000-0000-0000-0000-0000000000c2','fa',
    '   ', 100000, '2026-09-30','2026-09','bank')->>'error'),
  '件名をご記入ください（請求書にそのまま出ます）');
select public.chk('金額は必須',
  (public.invoice_add('00000000-0000-0000-0000-0000000000c2','fa',
    'FA', 0, '2026-09-30','2026-09','bank')->>'error'),
  '金額（税別）をご入力ください');
select public.chk('解約済みには立てられない',
  (public.invoice_add('00000000-0000-0000-0000-0000000000c9','fa',
    'FA', 100000, '2026-09-30','2026-09','bank')->>'error'),
  '解約済みの方には請求を立てられません');
select public.chk('年月を省くと期日の月になる',
  (public.invoice_add('00000000-0000-0000-0000-0000000000c5','fa',
    'FA（年月省略）', 100000, '2026-09-30', null, 'bank')->>'period'), '2026-09');
select public.chk('見知らぬ相手には立てられない',
  (public.invoice_add('00000000-0000-0000-0000-0000000000ff','fa',
    'FA', 100000, '2026-09-30','2026-09','bank')->>'error'), '請求先が見つかりません');

-- =============================================================
-- ③ 消込：ここが本題
-- =============================================================
--  A社：顧問料 49,500 ＋ FA 3,300,000 ＋ FA 550,000。入金は ma で 3,300,000 だけ
insert into public.revenue_entries (occurred_on, category, amount, customer_id) values
  ('2026-09-30','ma', 3300000, '00000000-0000-0000-0000-0000000000c1');
--  B社：顧問料ちょうど
insert into public.revenue_entries (occurred_on, category, amount, customer_id) values
  ('2026-09-27','advisory', 49500, '00000000-0000-0000-0000-0000000000c2');
--  C社：一部だけ
insert into public.revenue_entries (occurred_on, category, amount, customer_id) values
  ('2026-09-27','advisory', 20000, '00000000-0000-0000-0000-0000000000c3');
--  D社：入金なし
--  E社：区分をつけ忘れた入金。請求が顧問料とFAの二本あるので、
--       どちらのお金か決められない。推測で消さないことを確かめる
insert into public.revenue_entries (occurred_on, category, amount, customer_id) values
  ('2026-09-30','other', 110000, '00000000-0000-0000-0000-0000000000c5');

select public.invoice_reconcile('2026-09');

select public.chk('A社：FA手数料は入金済み',
  (select status from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c1' and amount=3300000), 'paid');
--  ★ここが壊れていた。FAの入金で顧問料まで消えてはいけない
select public.chk('A社：顧問料は未入金のまま',
  (select status from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c1' and kind='advisory'), 'open');
select public.chk('A社：二本目のFAも未入金のまま',
  (select status from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c1' and amount=550000), 'open');
select public.chk('B社：顧問料は入金済み',
  (select status from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c2'), 'paid');
select public.chk('C社：一部入金',
  (select status from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c3'), 'partial');
select public.chk('C社：一部入金の額',
  (select paid_amount::text from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c3'), '20000');
select public.chk('D社：入金なしは未入金のまま',
  (select status from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c4'), 'open');
--  ★請求が二本あるとき、区分なしの入金は推測で充てない。
--    どちらも未収のまま残し、運営が見て決める
select public.chk('E社：区分なしの入金はFAに充てない',
  (select status from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c5' and kind='fa'), 'open');
select public.chk('E社：顧問料も残る',
  (select status from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c5' and kind='advisory'), 'open');
--  請求が一本しか無ければ、区分なしの入金でも充てる（取り違えようがない）
insert into public.revenue_entries (occurred_on, category, amount, customer_id) values
  ('2026-09-27','other', 49500, '00000000-0000-0000-0000-0000000000c4');
select public.invoice_reconcile('2026-09');
select public.chk('D社：請求が一本なら区分なしでも充てる',
  (select status from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c4'), 'paid');
select public.chk('突合は何度やっても同じ',
  (select (public.invoice_reconcile('2026-09')->>'ok')), 'true');
select public.chk('二度目でも顧問料は消えない',
  (select status from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c1' and kind='advisory'), 'open');

-- =============================================================
-- ④ 手入力の入金と、お支払い方法
-- =============================================================
--  D社の顧問料を、方法を指定せずに入金済みにする
select public.invoice_mark_paid(
  (select id from public.invoices where customer_id='00000000-0000-0000-0000-0000000000c4'));
select public.chk('入金済みにしても方法が化けない',
  (select method from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c4'), 'bank');
select public.chk('方法を口座振替に切り替えられる',
  (public.invoice_set_method(
    (select id from public.invoices where customer_id='00000000-0000-0000-0000-0000000000c2'),
    'transfer')->>'ok'), 'true');
select public.chk('切り替わっている',
  (select method from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c2'), 'transfer');
select public.chk('でたらめな方法は入らない',
  (public.invoice_set_method(
    (select id from public.invoices where customer_id='00000000-0000-0000-0000-0000000000c2'),
    'げんきん')->>'error'), 'お支払い方法が正しくありません');

--  手で入れた入金額を、突合が下げないこと
select public.invoice_mark_paid(
  (select id from public.invoices where customer_id='00000000-0000-0000-0000-0000000000c3'), 40000);
select public.invoice_reconcile('2026-09');
select public.chk('突合は手入力の入金額を下げない',
  (select paid_amount::text from public.invoices
    where customer_id='00000000-0000-0000-0000-0000000000c3'), '40000');

-- =============================================================
-- ⑤ 振込先のご案内
-- =============================================================
select public.chk('振込先が読める',
  (public.invoice_pay_info()->>'bank'), '〇〇銀行 本店 普通 1234567 ツグアイ（カ');
select public.be('00000000-0000-0000-0000-0000000000c1');
select public.chk('顧客も振込先は読める',
  (public.invoice_pay_info()->>'bank'), '〇〇銀行 本店 普通 1234567 ツグアイ（カ');
select public.chk('顧客は請求を立てられない',
  (public.invoice_add('00000000-0000-0000-0000-0000000000c1','fa','ずる',1,'2026-09-30')->>'error'),
  '運営のみが操作できます');
select public.chk('顧客は突合できない',
  (public.invoice_reconcile('2026-09')->>'error'), '運営のみが操作できます');
select public.chk('顧客は方法を変えられない',
  (public.invoice_set_method(
    (select id from public.invoices where customer_id='00000000-0000-0000-0000-0000000000c2'),
    'card')->>'error'), '運営のみが操作できます');
select public.be('00000000-0000-0000-0000-0000000000a1');

-- =============================================================
-- ⑥ 索引と制約
-- =============================================================
select public.chk('自動ぶんだけの二重止め',
  (select count(*)::text from pg_indexes
    where schemaname='public' and indexname='invoices_uniq' and indexdef ilike '%where%'), '1');
select public.chk('FAの区分が入っている',
  (select count(*)::text from pg_constraint
    where conrelid='public.invoices'::regclass and conname='invoices_kind_check'
      and pg_get_constraintdef(oid) like '%''fa''%'), '1');
select public.chk('関数の数',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'invoice%'), '10');
select public.chk('古い2引数の生成は残っていない',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='invoice_generate'), '1');

-- =============================================================
-- 結果
-- =============================================================
select count(*) || ' 件中 ' || count(*) filter (where ok) || ' 件 合格、'
       || count(*) filter (where not ok) || ' 件 不合格' as "結果"
  from public.__t;
select n as "落ちた試験", got as "実際", want as "あるべき"
  from public.__t where not ok;
