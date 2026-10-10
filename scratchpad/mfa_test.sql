-- 二段階認証（20261010010000_mfa_required.sql）の試験。hard_stub.sql と security_hardening の上で動かす
\set ON_ERROR_STOP 1
\pset footer off
\pset tuples_only on
create or replace function pg_temp.be(p uuid, e text, a text) returns void language sql as
  $$ delete from public.__me; insert into public.__me values (p, e, a); $$;
create temp table r (name text, ok boolean);
grant all on r to authenticated;
insert into storage.objects(bucket_id,name,owner) values ('chat-attach','00000000-0000-0000-0000-0000000000c1/a.pdf','00000000-0000-0000-0000-0000000000c1');

-- 設定していない経営者（c1）：これまでどおり読める
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000c1','c1@x','aal1');
set local role authenticated;
insert into r select '未設定：パスワードだけで読める', count(*) > 0 from public.profiles where id='00000000-0000-0000-0000-0000000000c1';
insert into r select '未設定：添付も読める', count(*) = 1 from storage.objects;
reset role;
commit;

-- パートナー（b1）が設定した
insert into auth.mfa_factors(user_id,status) values ('00000000-0000-0000-0000-0000000000b1','verified');
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000b1','p1@x','aal1');
set local role authenticated;
insert into r select '設定済み・コード前：1行も読めない', count(*) = 0 from public.profiles;
update public.profiles set company_name='x' where consultant_id='00000000-0000-0000-0000-0000000000b1';
reset role;
insert into r select '設定済み・コード前：書き換えもできない', count(*) = 0 from public.profiles where company_name='x';
commit;
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000b1','p1@x','aal2');
set local role authenticated;
insert into r select '設定済み・コード後：読める', count(*) > 0 from public.profiles;
reset role;
commit;

-- 未確認（設定の途中でやめた）要素は数えない
insert into auth.mfa_factors(user_id,status) values ('00000000-0000-0000-0000-0000000000c2','unverified');
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000c2','c2@x','aal1');
set local role authenticated;
insert into r select '設定の途中：これまでどおり', count(*) > 0 from public.profiles;
reset role;
commit;

-- 添付の置き場：設定した経営者がコード前なら読めない
insert into auth.mfa_factors(user_id,status) values ('00000000-0000-0000-0000-0000000000c1','verified');
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000c1','c1@x','aal1');
set local role authenticated;
insert into r select '添付：コード前は読めない', count(*) = 0 from storage.objects;
reset role;
commit;
begin;
select pg_temp.be('00000000-0000-0000-0000-0000000000c1','c1@x','aal2');
set local role authenticated;
insert into r select '添付：コード後は読める', count(*) = 1 from storage.objects;
reset role;
commit;

insert into r select 'すべての表に守り', not exists (
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
     and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname and p.policyname='mfa required'));
insert into r select '守りは「止める側」', bool_and(permissive='RESTRICTIVE') from pg_policies where policyname='mfa required';
insert into r select 'ログイン前は呼べない', not has_function_privilege('anon','public.tsugu_aal_ok()','execute');

select case when ok then 'OK ' else 'NG ' end || name from r order by ok, name;
select count(*) filter (where not ok) || ' 件 不合格（' || count(*) || ' 件中）' from r;
