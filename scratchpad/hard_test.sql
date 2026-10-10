-- 情報の守り（20261010000000_security_hardening.sql）の試験。hard_stub.sql の上で動かす
\set ON_ERROR_STOP 1
\pset footer off
\pset tuples_only on
create or replace function pg_temp.be(p uuid, e text) returns void language sql as
  $$ delete from public.__me; insert into public.__me values (p, e); $$;
create temp table r (name text, ok boolean);
grant all on r to authenticated, anon;

-- ① 顧客が自分の役割・プラン・担当・メールを書き換えようとする
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000c1','c1@x');
set local role authenticated;
update public.profiles set role='admin', plan='buyer', consultant_id='00000000-0000-0000-0000-0000000000b2', email='evil@x', company_name='新社名' where id='00000000-0000-0000-0000-0000000000c1';
insert into r select '顧客：役割は変わらない', role='customer' from public.profiles where id='00000000-0000-0000-0000-0000000000c1';
insert into r select '顧客：プランは変わらない', plan='seller' from public.profiles where id='00000000-0000-0000-0000-0000000000c1';
insert into r select '顧客：担当は変わらない', consultant_id='00000000-0000-0000-0000-0000000000b1' from public.profiles where id='00000000-0000-0000-0000-0000000000c1';
insert into r select '顧客：メールはログインのメールのまま', email='c1@x' from public.profiles where id='00000000-0000-0000-0000-0000000000c1';
insert into r select '顧客：会社名は変えられる', company_name='新社名' from public.profiles where id='00000000-0000-0000-0000-0000000000c1';
reset role;
commit;

-- ② 新規登録でパートナー／運営として作ろうとする
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000d1','d1@x');
set local role authenticated;
insert into public.profiles(id,role,email,consultant_id,fde_rank) values ('00000000-0000-0000-0000-0000000000d1','consultant','other@x','00000000-0000-0000-0000-0000000000b1','premium');
insert into r select '新規：いつも顧客', role='customer' and consultant_id is null and fde_rank is null and email='d1@x' from public.profiles where id='00000000-0000-0000-0000-0000000000d1';
reset role;
commit;

-- ③ 運営が用意した関数（招待の受け取りなど）からは担当が付く
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000d1','d1@x');
set local role authenticated;
select public.claim_test('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1');
insert into r select '関数からは担当が付く', consultant_id='00000000-0000-0000-0000-0000000000b1' from public.profiles where id='00000000-0000-0000-0000-0000000000d1';
reset role;
commit;

-- ④ 運営（代表でない）はランクを変えられるが、担当・役割は変えられない
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000a2','staff@x');
set local role authenticated;
update public.profiles set fde_rank='senior', consultant_id=null, role='admin' where id='00000000-0000-0000-0000-0000000000b1';
insert into r select '運営：ランクは変えられる', fde_rank='senior' from public.profiles where id='00000000-0000-0000-0000-0000000000b1';
insert into r select '運営：役割は代表だけ', role='consultant' from public.profiles where id='00000000-0000-0000-0000-0000000000b1';
reset role;
commit;
-- 代表は役割も変えられる
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000a1','owner@x');
set local role authenticated;
update public.profiles set role='consultant' where id='00000000-0000-0000-0000-0000000000d1';
insert into r select '代表：役割を変えられる', role='consultant' from public.profiles where id='00000000-0000-0000-0000-0000000000d1';
update public.profiles set role='customer' where id='00000000-0000-0000-0000-0000000000d1';
reset role;
commit;

-- ⑤ パートナーが担当顧客の役割・プランを変えようとする
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000b2','p2@x');
set local role authenticated;
update public.profiles set role='admin', plan='buyer', email='x@x' where id='00000000-0000-0000-0000-0000000000c2';
insert into r select 'パートナー：顧客の役割・プラン・メールは変わらない', role='customer' and plan='seller' and email='c2@x' from public.profiles where id='00000000-0000-0000-0000-0000000000c2';
reset role;
commit;

-- ⑥ 法人。b1 の法人（EP1）に、b1 が管理者。c1（b1の顧客）は入れられ、c2（b2の顧客）は入れられない
insert into public.ep_orgs(id,name,kind) values ('e0000000-0000-0000-0000-000000000001','法人A','EP1');
insert into public.ep_members(id,ep_id,user_id,seat_role,status) values ('f0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','manager','active');
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000b1','p1@x');
set local role authenticated;
insert into r select '法人：自分の担当顧客は入れられる', (public.ep_add_client('e0000000-0000-0000-0000-000000000001','c1@x')->>'ok')::boolean;
insert into r select '法人：よその顧客は入れられない', not (public.ep_add_client('e0000000-0000-0000-0000-000000000001','c2@x')->>'ok')::boolean;
insert into r select '法人：顧客を持つパートナーは席に入れられない', not (public.ep_add_member('e0000000-0000-0000-0000-000000000001','p2@x','staff')->>'ok')::boolean;
reset role;
commit;
-- 直接書き込み
do $$ begin
  perform pg_temp.be('00000000-0000-0000-0000-0000000000b1','p1@x');
  set local role authenticated;
  begin
    insert into public.ep_clients(ep_id,customer_id) values ('e0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c2');
    insert into r values ('法人：顧問先を直接は足せない', false);
  exception when insufficient_privilege or others then insert into r values ('法人：顧問先を直接は足せない', true); end;
  begin
    insert into public.ep_members(ep_id,user_id,seat_role) values ('e0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b2','manager');
    insert into r values ('法人：席を直接は足せない', false);
  exception when others then insert into r values ('法人：席を直接は足せない', true); end;
  begin
    insert into public.ep_grants(ep_id,member_id,customer_id) values ('e0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c2');
    insert into r values ('法人：顧問先でない会社の割当は作れない', false);
  exception when others then insert into r values ('法人：顧問先でない会社の割当は作れない', true); end;
  reset role;
end $$;
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000b1','p1@x');
set local role authenticated;
update public.ep_clients set customer_id='00000000-0000-0000-0000-0000000000c2', status='ended' where customer_id='00000000-0000-0000-0000-0000000000c1';
insert into r select '法人：顧問先の付け替えはできない（状態は変えられる）', customer_id='00000000-0000-0000-0000-0000000000c1' and status='ended' from public.ep_clients where ep_id='e0000000-0000-0000-0000-000000000001';
update public.ep_clients set status='active';
update public.ep_members set seat_role='manager', user_id='00000000-0000-0000-0000-0000000000b2' where id='f0000000-0000-0000-0000-000000000001';
insert into r select '法人：席の人は付け替えられない', user_id='00000000-0000-0000-0000-0000000000b1' from public.ep_members where id='f0000000-0000-0000-0000-000000000001';
insert into public.ep_grants(ep_id,member_id,customer_id) values ('e0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1');
insert into r values ('法人：稼働中の顧問先と席なら割当を作れる', true);
reset role;
commit;

-- ⑦ 添付を見てよいか：割当は「席→本人」で結ぶ
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000b1','p1@x');
set local role authenticated;
insert into r select '添付：割当で見られる', public.chat_att_may('00000000-0000-0000-0000-0000000000c1');
insert into r select '添付：割当の無い会社は見られない', not public.chat_att_may('00000000-0000-0000-0000-0000000000c2');
reset role;
commit;
begin;
--  席のIDと本人のIDを同じにしても、割当の判定は通らない（取り違えの穴）
select pg_temp.be('00000000-0000-0000-0000-0000000000b3','p3@x');
set local role authenticated;
insert into r select '添付：よその会社は見られない', not public.chat_att_may('00000000-0000-0000-0000-0000000000c1');
reset role;
commit;

-- ⑧ 閲覧メンバーの枠：メールが一致する本人だけが受け取れる
insert into public.company_members(id,customer_id,member_email,status) values
 ('a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','tax@x','active'),
 ('a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000c2','other@x','active');
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000d2','tax@x');
set local role authenticated;
update public.company_members set member_id='00000000-0000-0000-0000-0000000000d2' where member_id is null;   -- メールの条件を外して全部取ろうとする
insert into r select '枠：自分あてだけ受け取れる', member_id='00000000-0000-0000-0000-0000000000d2' from public.company_members where id='a0000000-0000-0000-0000-000000000001';
insert into r select '枠：よそあては受け取れない', member_id is null from public.company_members where id='a0000000-0000-0000-0000-000000000002';
update public.company_members set member_email='tax@x', customer_id='00000000-0000-0000-0000-0000000000c1' where id='a0000000-0000-0000-0000-000000000002';
insert into r select '枠：宛先と会社は書き換えられない', member_email='other@x' and customer_id='00000000-0000-0000-0000-0000000000c2' from public.company_members where id='a0000000-0000-0000-0000-000000000002';
reset role;
commit;
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000c1','c1@x');
set local role authenticated;
insert into public.company_members(id,customer_id,member_email,member_id,status) values ('a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000c1','new@x','00000000-0000-0000-0000-0000000000b2','active');
insert into r select '枠：作るときは空き枠', member_id is null from public.company_members where id='a0000000-0000-0000-0000-000000000003';
reset role;
commit;

-- ⑨ 2名体制の申請
do $$ begin
  perform pg_temp.be('00000000-0000-0000-0000-0000000000b2','p2@x');
  set local role authenticated;
  begin
    insert into public.partner_assignments(customer_id,main_id,sub_email,status) values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b2','p3@x','approved');
    insert into r values ('2名体制：担当でない会社には申請できない', false);
  exception when others then insert into r values ('2名体制：担当でない会社には申請できない', true); end;
  reset role;
end $$;
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000b2','p2@x');
set local role authenticated;
insert into public.partner_assignments(id,customer_id,main_id,sub_email,status,sub_id) values ('b0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000b2','p3@x','approved','00000000-0000-0000-0000-0000000000b3');
insert into r select '2名体制：申請は「申請中」・副担当は空き', status='pending' and sub_id is null from public.partner_assignments where id='b0000000-0000-0000-0000-000000000001';
update public.partner_assignments set status='approved' where id='b0000000-0000-0000-0000-000000000001';
insert into r select '2名体制：承認は運営だけ', status='pending' from public.partner_assignments where id='b0000000-0000-0000-0000-000000000001';
reset role;
commit;
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000a2','staff@x');
set local role authenticated;
update public.partner_assignments set status='approved' where id='b0000000-0000-0000-0000-000000000001';
insert into r select '2名体制：運営は承認できる', status='approved' from public.partner_assignments where id='b0000000-0000-0000-0000-000000000001';
reset role;
commit;

-- ⑩ 担当が替わったら、前の担当の2名体制は終わる
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000a1','owner@x');
set local role authenticated;
update public.profiles set consultant_id='00000000-0000-0000-0000-0000000000b3' where id='00000000-0000-0000-0000-0000000000c2';
insert into r select '担当替え：前の担当の2名体制は終わる', status='ended' from public.partner_assignments where id='b0000000-0000-0000-0000-000000000001';
reset role;
commit;

-- ⑪ ログイン前は、持ち主の権限で動く関数を呼べない
insert into r select 'ログイン前：claim_client を呼べない', not has_function_privilege('anon','public.claim_client(text)','execute');
insert into r select 'ログイン後：claim_client を呼べる', has_function_privilege('authenticated','public.claim_client(text)','execute');
insert into r select '添付の置き場：10MB・HTMLは置けない', file_size_limit=10485760 and not ('text/html' = any(allowed_mime_types)) and not ('image/svg+xml' = any(allowed_mime_types)) from storage.buckets where id='chat-attach';
insert into r select '通知：既定は中身を出さない', (select column_default from information_schema.columns where table_name='notify_prefs' and column_name='preview_on')='false';

select case when ok then 'OK ' else 'NG ' end || name from r order by ok, name;
select count(*) filter (where not ok) || ' 件 不合格（' || count(*) || ' 件中）' from r;
