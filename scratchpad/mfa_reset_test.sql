-- MFA_RESET.sql（スマホをなくした方のやり直し）の試験。hard_run.sh が流す
\set ON_ERROR_STOP 1
\pset footer off
\pset tuples_only on
insert into auth.mfa_factors(user_id,status) values ('00000000-0000-0000-0000-0000000000b2','verified');
insert into auth.sessions(user_id) values ('00000000-0000-0000-0000-0000000000b2'),('00000000-0000-0000-0000-0000000000b2'),('00000000-0000-0000-0000-0000000000b1');
\o /dev/null
\i scratchpad/_mfa_reset_run.sql
\o
select case when (select count(*) from auth.mfa_factors where user_id='00000000-0000-0000-0000-0000000000b2')=0 then 'OK ' else 'NG ' end || 'やり直し：設定が外れる';
select case when (select count(*) from auth.sessions where user_id='00000000-0000-0000-0000-0000000000b2')=0
             and (select count(*) from auth.sessions where user_id='00000000-0000-0000-0000-0000000000b1')=1 then 'OK ' else 'NG ' end || 'やり直し：その方だけ全端末ログアウト';
select case when exists (select 1 from public.mfa_resets where email='p2@x' and factors_removed=1 and sessions_removed=2 and reason='紛失') then 'OK ' else 'NG ' end || 'やり直し：記録が残る';
select case when (select count(*) from auth.mfa_factors where user_id='00000000-0000-0000-0000-0000000000b1')=1 then 'OK ' else 'NG ' end || 'やり直し：ほかの方の設定はそのまま';
