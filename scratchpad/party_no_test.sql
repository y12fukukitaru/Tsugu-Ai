-- 顧客番号・パートナー番号（20261015040000_party_numbers.sql）の試験。本番では流さない
truncate public.__t;
select public.chk('台帳=1・番号の無い顧客=0・番号の無いパートナー=0・重なり=0・見張り=1',
  (select "台帳"||'/'||"番号の無い顧客"||'/'||"番号の無いパートナー"||'/'||"重なり"||'/'||"見張り" from __pn_check), '1/0/0/0/1');

-- すでにいた方に付いた（流す前に入れておいた C1・P1）
select public.chk('すでにいた顧客に C 番号', (select customer_no ~ '^C[1-9][0-9]{8}$' from public.profiles where id='40000000-0000-0000-0000-0000000000c1'), true);
select public.chk('すでにいたパートナーに P 番号', (select partner_no ~ '^P[1-9][0-9]{8}$' from public.profiles where id='40000000-0000-0000-0000-0000000000b1'), true);
select public.chk('運営には付けない', (select customer_no is null and partner_no is null from public.profiles where id='40000000-0000-0000-0000-00000000000a'), true);
select public.chk('検査数字が合う', (select bool_and(right(no,1)::int = public.party_no_check(substr(no,2,8))) from public.party_numbers), true);
select public.chk('検査数字（Luhn の例：7992739871 → 3）', public.party_no_check('7992739871'), 3);

-- 新しく作ると自動で付く・画面から渡した番号は使わない
insert into auth.users values ('40000000-0000-0000-0000-0000000000c9','c9@x');
insert into public.profiles(id, role, company_name, customer_no, partner_no) values ('40000000-0000-0000-0000-0000000000c9','customer','九社','C111111111','P111111111');
select public.chk('新規：自動で付く・渡した番号は使わない',
  (select customer_no <> 'C111111111' and customer_no ~ '^C' and partner_no is null from public.profiles where id='40000000-0000-0000-0000-0000000000c9'), true);
create temp table __c9 as select customer_no from public.profiles where id='40000000-0000-0000-0000-0000000000c9';
update public.profiles set customer_no = 'C222222222', company_name='九社2' where id='40000000-0000-0000-0000-0000000000c9';
select public.chk('書き換えられない', (select p.customer_no = c.customer_no from public.profiles p, __c9 c where p.id='40000000-0000-0000-0000-0000000000c9'), true);
update public.profiles set customer_no = null where id='40000000-0000-0000-0000-0000000000c9';
select public.chk('消せない', (select p.customer_no = c.customer_no from public.profiles p, __c9 c where p.id='40000000-0000-0000-0000-0000000000c9'), true);

-- パートナーになったら P も付く（C はそのまま）
update public.profiles set role='consultant' where id='40000000-0000-0000-0000-0000000000c9';
select public.chk('パートナーになったら P が付き、C は残る',
  (select p.partner_no ~ '^P' and p.customer_no = c.customer_no from public.profiles p, __c9 c where p.id='40000000-0000-0000-0000-0000000000c9'), true);

-- 削除しても番号は使い回さない（台帳に残る）・作り直しても同じ方なら同じ番号
delete from public.profiles where id='40000000-0000-0000-0000-0000000000c9';
select public.chk('プロフィールを消しても台帳に残る', (select count(*) from public.party_numbers p, __c9 c where p.no = c.customer_no), 1::bigint);
insert into public.profiles(id, role, company_name) values ('40000000-0000-0000-0000-0000000000c9','customer','九社');
select public.chk('同じ方を作り直すと同じ番号', (select p.customer_no = c.customer_no from public.profiles p, __c9 c where p.id='40000000-0000-0000-0000-0000000000c9'), true);
delete from auth.users where id='40000000-0000-0000-0000-0000000000c9';
select public.chk('アカウントを消しても番号は台帳に残る（持ち主だけ空に）', (select user_id is null from public.party_numbers p, __c9 c where p.no = c.customer_no), true);

-- 100万件ぶん作っても重ならない・ばらける（通し番号でない）
insert into public.party_numbers(no, kind, user_id)
select 'C'||b||public.party_no_check(b), 'C', null
  from (select distinct (10000000 + (('x'||substr(replace(gen_random_uuid()::text,'-',''),1,12))::bit(48)::bigint % 90000000))::text b
          from generate_series(1, 1000000)) t
on conflict do nothing;
select public.chk('100万件ほど入る', (select count(*) >= 990000 from public.party_numbers where kind='C'), true);
do $$ declare i int; n text; begin
  for i in 1..200 loop
    insert into auth.users values (gen_random_uuid(), null) returning id into strict n;
    perform public.party_no_issue(n::uuid, 'C');
  end loop;
end $$;
select public.chk('100万件のあとでも新しい番号が作れる（200件）', (select count(*) from public.party_numbers where kind='C' and user_id is not null), 201::bigint);
select public.chk('番号はばらける（先頭の桁が1〜9に散る）', (select count(distinct substr(no,2,1)) from public.party_numbers where kind='C'), 9::bigint);

-- 口座振替のお客様番号・請求書番号
select public.be('40000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.chk('口座振替：お客様番号は顧客番号の数字9桁',
  (select (public.debit_mandate_set('40000000-0000-0000-0000-0000000000c1','preparing'))->>'ref_no' = (select substr(customer_no,2) from public.profiles where id='40000000-0000-0000-0000-0000000000c1')), true);
select public.chk('請求書番号は 年月-顧客番号',
  (select (public.invoice_mail_prepare('2026-11','40000000-0000-0000-0000-0000000000c1'))->>'invoice_no' = '202611-'||(select customer_no from public.profiles where id='40000000-0000-0000-0000-0000000000c1')), true);
select public.chk('ご本人は台帳を読めない', (select has_table_privilege('authenticated','public.party_numbers','select')), false);
select public.chk('番号を作る関数は画面から呼べない', (select has_function_privilege('authenticated','public.party_no_issue(uuid,text)','execute')), false);
reset role;

select (select count(*) from public.__t where got is distinct from want) as "不合格", (select count(*) from public.__t) as "全部";
select n, name, got, want from public.__t where got is distinct from want order by n;
