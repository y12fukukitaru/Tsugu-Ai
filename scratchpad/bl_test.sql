\pset footer off
insert into public.profiles(id,role) values
 ('00000000-0000-0000-0000-00000000d101','customer'),
 ('00000000-0000-0000-0000-00000000d202','customer'),
 ('00000000-0000-0000-0000-00000000e909','consultant'),
 ('00000000-0000-0000-0000-00000000aaa1','admin')
on conflict (id) do nothing;
insert into public.billing_links(audience,label,url,customer_id,active) values
 ('customer','A社の顧問料','https://buy.stripe.com/a','00000000-0000-0000-0000-00000000d101',true),
 ('customer','B社の顧問料','https://buy.stripe.com/b','00000000-0000-0000-0000-00000000d202',true),
 ('customer','みんな向けの案内','https://buy.stripe.com/z',null,true),
 ('customer','止めたリンク','https://buy.stripe.com/x','00000000-0000-0000-0000-00000000d101',false);
insert into public.announcements(audience,title,body) values
 ('all','みんなへ','x'),('customer','顧客へ','y'),('consultant','パートナーへ','z');
insert into public.contract_templates(kind,title,body,active) values
 ('customer','顧問契約','本文',true);

create or replace function pg_temp.as_user(p uuid, q text) returns bigint
language plpgsql as $$
declare k bigint;
begin
  delete from auth.whoami; insert into auth.whoami values (p);
  set local role authenticated;
  execute q into k;
  reset role;
  return k;
end $$;
create or replace function pg_temp.chk(nm text, got anyelement, want anyelement) returns text
language sql as $$ select case when got::text = want::text
  then '  ok   '||nm else '  ✗ NG '||nm||'  出た:'||got::text||' 欲しい:'||want::text end $$;

select pg_temp.chk('A社は自分のと、みんな向けだけ見える',
  pg_temp.as_user('00000000-0000-0000-0000-00000000d101','select count(*) from public.billing_links'), 2::bigint)
union all select pg_temp.chk('B社にA社のリンクは見えない',
  pg_temp.as_user('00000000-0000-0000-0000-00000000d202','select count(*) from public.billing_links'), 2::bigint)
union all select pg_temp.chk('止めたリンクは本人にも出ない',
  pg_temp.as_user('00000000-0000-0000-0000-00000000d101','select count(*) from public.billing_links where not active'), 0::bigint)
union all select pg_temp.chk('パートナーに他社のリンクは見えない',
  pg_temp.as_user('00000000-0000-0000-0000-00000000e909','select count(*) from public.billing_links'), 1::bigint)
union all select pg_temp.chk('運営はぜんぶ見える',
  pg_temp.as_user('00000000-0000-0000-0000-00000000aaa1','select count(*) from public.billing_links'), 4::bigint)
union all select pg_temp.chk('顧客は みんな向け＋顧客向け のお知らせ',
  pg_temp.as_user('00000000-0000-0000-0000-00000000d101','select count(*) from public.announcements'), 2::bigint)
union all select pg_temp.chk('パートナーは みんな向け＋パートナー向け',
  pg_temp.as_user('00000000-0000-0000-0000-00000000e909','select count(*) from public.announcements'), 2::bigint)
union all select pg_temp.chk('顧客に契約のひな形は見えない',
  pg_temp.as_user('00000000-0000-0000-0000-00000000d101','select count(*) from public.contract_templates'), 0::bigint)
union all select pg_temp.chk('パートナーはひな形を読める（契約を送るため）',
  pg_temp.as_user('00000000-0000-0000-0000-00000000e909','select count(*) from public.contract_templates'), 1::bigint);
