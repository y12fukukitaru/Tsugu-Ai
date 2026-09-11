-- 契約の締結の知らせ・運営の招待の試験（手元の PostgreSQL 専用）
\set ON_ERROR_STOP on
\set QUIET on
create temp table t(name text, ok boolean);

-- 人：運営2、パートナー1、顧客1（登録済み）
insert into auth.users values
 ('a0000000-0000-0000-0000-000000000001','y.admin@fuku-kita.jp'),
 ('a0000000-0000-0000-0000-000000000002','admin2@fuku-kita.jp'),
 ('b0000000-0000-0000-0000-000000000001','partner@x.jp'),
 ('c0000000-0000-0000-0000-000000000001','cust1@x.jp'),
 ('c0000000-0000-0000-0000-000000000002','cust2@x.jp');
insert into public.profiles (id, role, email, full_name) values
 ('a0000000-0000-0000-0000-000000000001','admin','y.admin@fuku-kita.jp','運営'),
 ('a0000000-0000-0000-0000-000000000002','admin','admin2@fuku-kita.jp','運営2'),
 ('b0000000-0000-0000-0000-000000000001','consultant','partner@x.jp','佐藤'),
 ('c0000000-0000-0000-0000-000000000001','customer','cust1@x.jp','A社'),
 ('c0000000-0000-0000-0000-000000000002','customer','cust2@x.jp','B社');

-- ---------------------------------------------------------------
-- ① 運営が招待 → 本人が登録した瞬間に運営が担当になる
-- ---------------------------------------------------------------
select public.be('a0000000-0000-0000-0000-000000000001');
insert into public.customer_invites (email, consultant_id, company_name)
  values ('Cust2@X.jp', 'a0000000-0000-0000-0000-000000000001', 'B社（招待）');
select public.be('c0000000-0000-0000-0000-000000000002');
insert into t select '運営の招待は claimed になる', (select public.claim_my_invite()) = 'claimed';
insert into t select '担当は運営', (select consultant_id from public.profiles where id='c0000000-0000-0000-0000-000000000002') = 'a0000000-0000-0000-0000-000000000001';
insert into t select '招待は claimed', (select status from public.customer_invites where lower(email)='cust2@x.jp') = 'claimed';
insert into t select '二度目は already', (select public.claim_my_invite()) = 'already';
--  パートナーの招待も従来どおり
select public.be('b0000000-0000-0000-0000-000000000001');
insert into auth.users values ('c0000000-0000-0000-0000-000000000003','cust3@x.jp');
insert into public.profiles (id, role, email) values ('c0000000-0000-0000-0000-000000000003','customer','cust3@x.jp');
insert into public.customer_invites (email, consultant_id) values ('cust3@x.jp', 'b0000000-0000-0000-0000-000000000001');
select public.be('c0000000-0000-0000-0000-000000000003');
insert into t select 'パートナーの招待も claimed', (select public.claim_my_invite()) = 'claimed';
insert into t select '担当はパートナー', (select consultant_id from public.profiles where id='c0000000-0000-0000-0000-000000000003') = 'b0000000-0000-0000-0000-000000000001';
--  招いた人が顧客（役割が違う）なら付けない
insert into auth.users values ('c0000000-0000-0000-0000-000000000004','cust4@x.jp');
insert into public.profiles (id, role, email) values ('c0000000-0000-0000-0000-000000000004','customer','cust4@x.jp');
insert into public.customer_invites (email, consultant_id) values ('cust4@x.jp', 'c0000000-0000-0000-0000-000000000001');
select public.be('c0000000-0000-0000-0000-000000000004');
insert into t select '招いた人が顧客なら断る', (select public.claim_my_invite()) like 'error:%';

-- ---------------------------------------------------------------
-- ② 運営もパートナー表示から顧問契約を送れる（書き込みの権限）
--    RLS は表の持ち主には効かないので、DO の中で役割を authenticated に
--    切り替えて試す（set local は文ごとの自動コミットでは効かない）
-- ---------------------------------------------------------------
create or replace function public.try_offer(p_who uuid, p_token text, p_email text) returns boolean
language plpgsql as $$
declare okk boolean;
begin
  perform public.be(p_who);
  perform set_config('role','authenticated',true);
  begin
    insert into public.contract_offers (kind, token, email, body, monthly_fee, offered_by, consultant_id)
      values ('customer', p_token, p_email, '{{お名前}} {{メールアドレス}}', 45000, p_who, p_who);
    okk := true;
  exception when others then
    okk := false;
  end;
  execute 'reset role';
  return okk;
end $$;
insert into t select '運営が顧問契約を書き込める', public.try_offer('a0000000-0000-0000-0000-000000000001', 'tok-admin-0000000000000000000000000001', 'new@x.jp');
insert into t select '顧客は書き込めない', not public.try_offer('c0000000-0000-0000-0000-000000000001', 'tok-cust-00000000000000000000000000001', 'z@x.jp');
insert into t select 'パートナーも書き込める', public.try_offer('b0000000-0000-0000-0000-000000000001', 'tok-partner-000000000000000000000000001', 'cust1@x.jp');
insert into t select '書き込めたのは2件', (select count(*) from public.contract_offers) = 2;

-- ---------------------------------------------------------------
-- ③ 締結したら、送った人・担当・運営に知らせる
-- ---------------------------------------------------------------
select public.be(null);
insert into t select '同意できる', (public.contract_agree('tok-partner-000000000000000000000000001', '山田 太郎', 'A社', 'ua')->>'ok') = 'true';
insert into t select '書面は agreed', (select status from public.contract_offers where token='tok-partner-000000000000000000000000001') = 'agreed';
insert into t select '知らせは パートナー＋運営2＝3通', (select count(*) from public.agent_insights where kind='contract_agreed') = 3;
insert into t select '宛先は重複しない', (select count(distinct user_id) from public.agent_insights where kind='contract_agreed') = 3;
insert into t select 'パートナーに届く', exists (select 1 from public.agent_insights where user_id='b0000000-0000-0000-0000-000000000001' and kind='contract_agreed');
insert into t select '運営2人に届く', (select count(*) from public.agent_insights where kind='contract_agreed' and user_id in ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002')) = 2;
insert into t select '件名にメールアドレス', (select title from public.agent_insights where kind='contract_agreed' limit 1) = '顧問契約が締結されました：cust1@x.jp';
insert into t select '本文に名前・法人名・締結日時・顧問料', (select body from public.agent_insights where kind='contract_agreed' limit 1) like 'A社　山田 太郎 様が 20__/__/__ __:__ に同意しました。顧問料 45,000円（税別）。%';
insert into t select '登録済みの顧客なら customer_id が付く', (select customer_id from public.agent_insights where kind='contract_agreed' limit 1) = 'c0000000-0000-0000-0000-000000000001';
insert into t select '本文に「担当は自動で付きます」', (select body from public.agent_insights where kind='contract_agreed' limit 1) like '%担当は自動で付きます%';
insert into t select '至急（priority 1）・未読', (select count(*) from public.agent_insights where kind='contract_agreed' and priority=1 and status='unread') = 3;
--  二度目は already で、知らせは増えない
insert into t select '二度目は already', (public.contract_agree('tok-partner-000000000000000000000000001', '山田 太郎', 'A社', 'ua')->>'already') = 'true';
insert into t select '知らせは増えない', (select count(*) from public.agent_insights where kind='contract_agreed') = 3;
--  運営が送った契約：送った人＝運営なので、運営2＋（担当＝運営）＝2通
insert into t select '運営が送った契約も同意できる', (public.contract_agree('tok-admin-0000000000000000000000000001', '鈴木', 'C社', null)->>'ok') = 'true';
insert into t select '運営が送った契約の知らせは運営2人だけ（重複なし）', (select count(*) from public.agent_insights where reason='contract_offers.id='||(select id::text from public.contract_offers where token='tok-admin-0000000000000000000000000001')) = 2;
insert into t select '未登録の相手なら customer_id は空', (select count(*) from public.agent_insights where reason='contract_offers.id='||(select id::text from public.contract_offers where token='tok-admin-0000000000000000000000000001') and customer_id is null) = 2;
--  パートナー契約
insert into public.contract_offers (kind, token, email, body, offered_by)
  values ('partner', 'tok-p-000000000000000000000000000000001', 'newpartner@x.jp', 'x', 'a0000000-0000-0000-0000-000000000001');
insert into t select 'パートナー契約も同意できる', (public.contract_agree('tok-p-000000000000000000000000000000001', '高橋', null, null)->>'ok') = 'true';
insert into t select 'パートナー契約の件名', exists (select 1 from public.agent_insights where title='パートナー契約が締結されました：newpartner@x.jp');
insert into t select 'パートナー契約の本文は「認定パートナーになります」', exists (select 1 from public.agent_insights where title like 'パートナー契約%' and body like '%認定パートナーになります%');
--  期限切れ・取り消しは同意できない（従来どおり）
insert into public.contract_offers (kind, token, email, body, offered_by, expires_at)
  values ('partner', 'tok-old-0000000000000000000000000000001', 'old@x.jp', 'x', 'a0000000-0000-0000-0000-000000000001', now() - interval '1 day');
insert into t select '期限切れは断る', (public.contract_agree('tok-old-0000000000000000000000000000001', '田中', null, null)->>'ok') = 'false';
insert into t select '知らせの関数は本人から呼べない（権限）', not has_function_privilege('authenticated', 'public.contract_notify_agreed(uuid)', 'execute');

\set QUIET off
select name, ok from t where not ok;
select count(*) filter (where ok) as 合格, count(*) filter (where not ok) as 不合格, count(*) as 全体 from t;
