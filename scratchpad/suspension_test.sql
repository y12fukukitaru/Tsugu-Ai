-- 利用の一時停止（20261015020000_suspension.sql）の試験。debit_stub → 3本の SQL のあとに流す
-- 人：A=運営、C1=3か月滞納、C2=ふつう、M1=C1の閲覧メンバー、P1=C1の担当
truncate public.__t;
select public.be('20000000-0000-0000-0000-00000000000a');
select public.chk('表=1・関数=6・守りの無い表=0・毎朝の呼び出し=1',
  (select "表"||'/'||"関数"||'/'||"守りの無い表"||'/'||"毎朝の呼び出し" from __sus_check), '1/6/0/1');
select public.chk('毎朝の呼び出し：billing-mail・suspend_notify・合言葉はブリーフから',
  (select position('/functions/v1/billing-mail' in command) > 0 and position('"action":"suspend_notify"' in command) > 0
          and position('secret-xyz' in command) > 0 and schedule = '0 0 * * *' from cron.job where jobname = 'suspend-notify'), true);

select public.chk('3か月滞納の C1 は止めている', public.tsugu_suspended('20000000-0000-0000-0000-0000000000c1'), true);
select public.chk('C2 は止めていない', public.tsugu_suspended('20000000-0000-0000-0000-0000000000c2'), false);
select public.chk('運営・パートナーは止まらない', public.tsugu_suspended('20000000-0000-0000-0000-0000000000b1'), false);

set role authenticated;
select public.be('20000000-0000-0000-0000-0000000000c1');
select public.chk('止めている方：ほかの表は読めない', (select count(*) from public.financial_entries), 0::bigint);
select public.chk('止めている方：請求は読める', (select count(*) from public.invoices), 3::bigint);
select public.chk('止めている方：自分のプロフィールは読める', (select count(*) from public.profiles where id = auth.uid()), 1::bigint);
do $$ begin
  begin
    insert into public.financial_entries(customer_id, amount) values ('20000000-0000-0000-0000-0000000000c1', 1);
    perform public.chk('止めている方：ほかの表に書けない', 'wrote'::text, 'blocked'::text);
  exception when others then
    perform public.chk('止めている方：ほかの表に書けない', 'blocked'::text, 'blocked'::text);
  end;
end $$;
select public.chk('止めている方：画面の中身（内訳・合計・担当）',
  (select (r->>'suspended')||'/'||jsonb_array_length(r->'items')||'/'||(r->>'total')||'/'||(r->>'partner_name')
     from (select public.service_status('20000000-0000-0000-0000-0000000000c1') r) t), 'true/3/148500/P1');
select public.be('20000000-0000-0000-0000-0000000000c2');
select public.chk('ふつうの方は読める', (select count(*) from public.financial_entries), 1::bigint);
select public.chk('ほかの顧客の様子は見られない', public.service_status('20000000-0000-0000-0000-0000000000c1')->>'ok', 'false');
select public.be('20000000-0000-0000-0000-0000000000d1');
select public.chk('閲覧メンバー：会社の様子は見られる（画面で止める）', public.service_status('20000000-0000-0000-0000-0000000000c1')->>'suspended', 'true');
select public.be('20000000-0000-0000-0000-0000000000b1');
select public.chk('担当パートナー：表は読める（止まらない）', (select count(*) >= 0 from public.financial_entries), true);
select public.chk('担当パートナー：止めているかを見られる', public.service_status('20000000-0000-0000-0000-0000000000c1')->>'suspended', 'true');
select public.chk('パートナーは解けない', public.suspension_lift('20000000-0000-0000-0000-0000000000c1', 'x')->>'ok', 'false');
reset role;

-- 運営が解く（その月だけ）
select public.be('20000000-0000-0000-0000-00000000000a');
select public.chk('理由なしでは解けない', public.suspension_lift('20000000-0000-0000-0000-0000000000c1', '')->>'ok', 'false');
select public.chk('運営が解く', public.suspension_lift('20000000-0000-0000-0000-0000000000c1', '振込の連絡あり')->>'ok', 'true');
select public.chk('解くと、その月は使える', public.tsugu_suspended('20000000-0000-0000-0000-0000000000c1'), false);
delete from public.service_suspensions;
select public.chk('解いた記録が無ければ、また止まる', public.tsugu_suspended('20000000-0000-0000-0000-0000000000c1'), true);

-- 入金で自動で再開
update public.invoices set status='paid', paid_amount=amount
 where id = (select id from public.invoices where customer_id='20000000-0000-0000-0000-0000000000c1' order by due_on limit 1);
select public.chk('1か月分入れば（2か月分に減れば）自動で再開', public.tsugu_suspended('20000000-0000-0000-0000-0000000000c1'), false);
set role authenticated;
select public.be('20000000-0000-0000-0000-0000000000c1');
select public.chk('再開したら、ほかの表も読める', (select count(*) from public.financial_entries), 1::bigint);
reset role;

select (select count(*) from public.__t where got is distinct from want) as "不合格", (select count(*) from public.__t) as "全部";
select n, name, got, want from public.__t where got is distinct from want order by n;
