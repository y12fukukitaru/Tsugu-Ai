\set ON_ERROR_STOP on
\pset footer off
-- ===== 登場人物 =====
insert into public.profiles(id,role,consultant_id) values
 ('00000000-0000-0000-0000-00000000c101','customer','00000000-0000-0000-0000-00000000b101'),
 ('00000000-0000-0000-0000-00000000c202','customer',null),
 ('00000000-0000-0000-0000-00000000b101','consultant',null),
 ('00000000-0000-0000-0000-00000000b202','consultant',null),
 ('00000000-0000-0000-0000-00000000b303','consultant',null),
 ('00000000-0000-0000-0000-00000000b404','consultant',null),
 ('00000000-0000-0000-0000-00000000ffff','consultant',null),
 ('00000000-0000-0000-0000-00000000a101','admin',null);
-- 2名体制：p2 は c1 の副担当（承認済み）
insert into public.partner_assignments values
 ('00000000-0000-0000-0000-00000000c101','00000000-0000-0000-0000-00000000b101','00000000-0000-0000-0000-00000000b202','approved'),
 ('00000000-0000-0000-0000-00000000c202','00000000-0000-0000-0000-00000000b101','00000000-0000-0000-0000-00000000ffff','pending');
-- EP-I：p3 が管理者、c1 は顧問先
insert into public.ep_orgs values ('00000000-0000-0000-0000-00000000e101','EP1','本部');
insert into public.ep_members values ('00000000-0000-0000-0000-00000000e101','00000000-0000-0000-0000-00000000b303','active','manager');
insert into public.ep_clients values ('00000000-0000-0000-0000-00000000e101','00000000-0000-0000-0000-00000000c101','active');
-- 個別の閲覧権：p4 は c1 を見てよい／ff は取り消し済み
insert into public.ep_grants values
 ('00000000-0000-0000-0000-00000000e101','00000000-0000-0000-0000-00000000b404','00000000-0000-0000-0000-00000000c101',null),
 ('00000000-0000-0000-0000-00000000e101','00000000-0000-0000-0000-00000000ffff','00000000-0000-0000-0000-00000000c101',now());
-- 添付：c1 の決算書、c2 の決算書、形の違うもの
insert into storage.objects(bucket_id,name) values
 ('chat-attach','00000000-0000-0000-0000-00000000c101/1_a.pdf'),
 ('chat-attach','00000000-0000-0000-0000-00000000c101/2_b.pdf'),
 ('chat-attach','00000000-0000-0000-0000-00000000c202/3_c.pdf'),
 ('chat-attach','legacy.pdf');

create or replace function pg_temp.seen(p uuid) returns bigint
language plpgsql as $$
declare k bigint;
begin
  delete from auth.whoami; insert into auth.whoami values (p);
  set local role authenticated;
  select count(*) into k from storage.objects where bucket_id='chat-attach';
  reset role;
  return k;
end $$;

create or replace function pg_temp.chk(nm text, got anyelement, want anyelement) returns text
language sql as $$ select case when got::text = want::text
  then '  ok   '||nm else '  ✗ NG '||nm||'  出た:'||got::text||' 欲しい:'||want::text end $$;

select pg_temp.chk('見ず知らずの登録者には1件も見えない', pg_temp.seen('00000000-0000-0000-0000-00000000ffff'), 0::bigint)
union all select pg_temp.chk('本人は自分のぶんだけ見える',   pg_temp.seen('00000000-0000-0000-0000-00000000c101'), 2::bigint)
union all select pg_temp.chk('別の会社のものは見えない',     pg_temp.seen('00000000-0000-0000-0000-00000000c202'), 1::bigint)
union all select pg_temp.chk('担当の会社だけ見える（未承認の分は見えない）',       pg_temp.seen('00000000-0000-0000-0000-00000000b101'), 2::bigint)
union all select pg_temp.chk('承認済みの副担当も見える',     pg_temp.seen('00000000-0000-0000-0000-00000000b202'), 2::bigint)
union all select pg_temp.chk('EPの管理者も見える',           pg_temp.seen('00000000-0000-0000-0000-00000000b303'), 2::bigint)
union all select pg_temp.chk('個別の閲覧権でも見える',       pg_temp.seen('00000000-0000-0000-0000-00000000b404'), 2::bigint)
union all select pg_temp.chk('運営はぜんぶ見える（形の違うものは除く）', pg_temp.seen('00000000-0000-0000-0000-00000000a101'), 3::bigint);

-- ===== 書き込み =====
delete from auth.whoami; insert into auth.whoami values ('00000000-0000-0000-0000-00000000ffff');
set role authenticated;
select '  ' || case when (select count(*) from (
    select 1 from storage.objects limit 0) z) is null then '' else '' end;
do $$ begin
  begin
    insert into storage.objects(bucket_id,name)
      values ('chat-attach','00000000-0000-0000-0000-00000000c101/x.pdf');
    raise notice '  ✗ NG 他人のフォルダに置けてしまった';
  exception when insufficient_privilege or others then
    raise notice '  ok   他人のフォルダには置けない';
  end;
end $$;
reset role;

delete from auth.whoami; insert into auth.whoami values ('00000000-0000-0000-0000-00000000c101');
set role authenticated;
do $$ begin
  begin
    insert into storage.objects(bucket_id,name)
      values ('chat-attach','00000000-0000-0000-0000-00000000c101/own.pdf');
    raise notice '  ok   自分のフォルダには置ける';
  exception when others then
    raise notice '  ✗ NG 自分のフォルダに置けない: %', sqlerrm;
  end;
end $$;
reset role;

-- ===== 契約：kind の書き換えを止められたか =====
insert into public.contract_offers(kind,token,email,body,offered_by,status)
 values ('customer', repeat('t',43), 'x@example.com','本文','00000000-0000-0000-0000-00000000b101','sent');
create policy "contract_offers own sent" on public.contract_offers
  for select to authenticated using (offered_by = auth.uid());
create policy "contract_offers own cancel" on public.contract_offers
  for update to authenticated
  using (offered_by = auth.uid() and status = 'sent')
  with check (offered_by = auth.uid() and status in ('sent','cancelled'));

delete from auth.whoami; insert into auth.whoami values ('00000000-0000-0000-0000-00000000b101');
set role authenticated;
do $$ begin
  begin
    update public.contract_offers set kind='partner' where status='sent';
    raise notice '  ✗ NG パートナー契約に化けさせられた';
  exception when insufficient_privilege then
    raise notice '  ok   kind は書き換えられない';
  end;
  begin
    update public.contract_offers set body='すり替え' where status='sent';
    raise notice '  ✗ NG 契約本文を差し替えられた';
  exception when insufficient_privilege then
    raise notice '  ok   本文は書き換えられない';
  end;
  begin
    update public.contract_offers set status='cancelled' where status='sent';
    raise notice '  ok   取り消しはこれまでどおりできる';
  exception when others then
    raise notice '  ✗ NG 取り消しができなくなった: %', sqlerrm;
  end;
end $$;
reset role;
