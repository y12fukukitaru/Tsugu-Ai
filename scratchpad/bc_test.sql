\pset footer off
insert into public.profiles(id,role,consultant_id) values
 ('00000000-0000-0000-0000-00000000c101','customer','00000000-0000-0000-0000-00000000b101'),
 ('00000000-0000-0000-0000-00000000c202','customer','00000000-0000-0000-0000-00000000b202'),
 ('00000000-0000-0000-0000-00000000b101','consultant',null),
 ('00000000-0000-0000-0000-00000000b202','consultant',null),
 ('00000000-0000-0000-0000-00000000a101','admin',null)
on conflict (id) do nothing;
-- 案件：c202 が出している公開中の案件、c101 自身の案件、終了した案件
insert into public.market_listings(id,owner_id,side,kind,title,status) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c202','raise','mna','後継者不在の製造業を譲渡','open'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000c101','provide','mna','自社の掲載','open'),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000c202','raise','mna','終わった案件','closed');

create or replace function pg_temp.as_u(p uuid, q text) returns text
language plpgsql as $$
declare r text;
begin
  delete from auth.whoami; insert into auth.whoami values (p);
  set local role authenticated;
  begin
    execute q into r;
  exception when others then r := 'ERR:' || sqlerrm;
  end;
  reset role;
  return coalesce(r,'(null)');
end $$;
create or replace function pg_temp.chk(nm text, got text, want text) returns text
language sql as $$ select case when got = want then '  ok   '||nm else '  ✗ NG '||nm||'  出た:'||got||' 欲しい:'||want end $$;

-- ===== 買いたい条件 =====
select pg_temp.chk('経営者は自分の条件を書ける',
  pg_temp.as_u('00000000-0000-0000-0000-00000000c101',
   $q$ insert into public.buy_criteria(customer_id,industries,budget_man) values ('00000000-0000-0000-0000-00000000c101','製造業',5000) returning industries $q$), '製造業')
union all select pg_temp.chk('担当パートナーは顧問先の条件を読める',
  pg_temp.as_u('00000000-0000-0000-0000-00000000b101', $q$ select industries from public.buy_criteria where customer_id='00000000-0000-0000-0000-00000000c101' $q$), '製造業')
union all select pg_temp.chk('担当パートナーは代行で書き換えられる',
  pg_temp.as_u('00000000-0000-0000-0000-00000000b101', $q$ update public.buy_criteria set region='関東' where customer_id='00000000-0000-0000-0000-00000000c101' returning region $q$), '関東')
union all select pg_temp.chk('別のパートナーには見えない',
  pg_temp.as_u('00000000-0000-0000-0000-00000000b202', $q$ select coalesce(industries,'(見えない)') from public.buy_criteria where customer_id='00000000-0000-0000-0000-00000000c101' $q$), '(null)')
union all select pg_temp.chk('別の経営者には見えない',
  pg_temp.as_u('00000000-0000-0000-0000-00000000c202', $q$ select coalesce(industries,'(見えない)') from public.buy_criteria where customer_id='00000000-0000-0000-0000-00000000c101' $q$), '(null)')
union all select pg_temp.chk('別の経営者は他人の条件を書けない',
  pg_temp.as_u('00000000-0000-0000-0000-00000000c202',
   $q$ insert into public.buy_criteria(customer_id,industries) values ('00000000-0000-0000-0000-00000000c101','乗っ取り') returning industries $q$), 'ERR:new row violates row-level security policy for table "buy_criteria"')
union all select pg_temp.chk('運営は読める',
  pg_temp.as_u('00000000-0000-0000-0000-00000000a101', $q$ select region from public.buy_criteria where customer_id='00000000-0000-0000-0000-00000000c101' $q$), '関東');

-- ===== 関心 =====
select pg_temp.chk('経営者は公開中の他社案件に関心を出せる',
  pg_temp.as_u('00000000-0000-0000-0000-00000000c101',
   $q$ insert into public.market_interests(listing_id,from_id,message) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c101','詳しく聞きたい') returning message $q$), '詳しく聞きたい')
union all select pg_temp.chk('同じ案件に二度は出せない',
  pg_temp.as_u('00000000-0000-0000-0000-00000000c101',
   $q$ insert into public.market_interests(listing_id,from_id) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c101') returning 'x' $q$), 'ERR:duplicate key value violates unique constraint "market_interests_once"')
union all select pg_temp.chk('自分の案件には出せない',
  pg_temp.as_u('00000000-0000-0000-0000-00000000c101',
   $q$ insert into public.market_interests(listing_id,from_id) values ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000c101') returning 'x' $q$), 'ERR:new row violates row-level security policy for table "market_interests"')
union all select pg_temp.chk('終了した案件には出せない',
  pg_temp.as_u('00000000-0000-0000-0000-00000000c101',
   $q$ insert into public.market_interests(listing_id,from_id) values ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000c101') returning 'x' $q$), 'ERR:new row violates row-level security policy for table "market_interests"')
union all select pg_temp.chk('他人になりすまして出せない',
  pg_temp.as_u('00000000-0000-0000-0000-00000000c202',
   $q$ insert into public.market_interests(listing_id,from_id) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c101') returning 'x' $q$), 'ERR:new row violates row-level security policy for table "market_interests"')
union all select pg_temp.chk('自分の関心は読める',
  pg_temp.as_u('00000000-0000-0000-0000-00000000c101', $q$ select message from public.market_interests where from_id='00000000-0000-0000-0000-00000000c101' $q$), '詳しく聞きたい')
union all select pg_temp.chk('担当パートナーは顧問先の関心を読める',
  pg_temp.as_u('00000000-0000-0000-0000-00000000b101', $q$ select message from public.market_interests where from_id='00000000-0000-0000-0000-00000000c101' $q$), '詳しく聞きたい')
union all select pg_temp.chk('無関係のパートナーには見えない',
  pg_temp.as_u('00000000-0000-0000-0000-00000000b202', $q$ select message from public.market_interests where from_id='00000000-0000-0000-0000-00000000c101' $q$), '(null)');
