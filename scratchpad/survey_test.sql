-- 四半期アンケート SQL の試験（手元の PostgreSQL 用。Supabase では流さない）
--  先に survey_stub.sql で土台を作り、本番の migration を流してから、これを流す
\set ON_ERROR_STOP on
create or replace function public.t_assert(name text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception '× % : got=% want=%', name, got, want; end if;
  raise notice '○ %', name;
end $$;

-- 受付期間：手動オープンが勝つ
insert into public.app_settings(key,value) values ('survey_open', jsonb_build_object('period','2026-Q3','until',((now() at time zone 'Asia/Tokyo')::date + 1)::text))
  on conflict (key) do update set value = excluded.value;
select public.t_assert('手動オープン：open', (public.survey_window()->>'open'), 'true');
select public.t_assert('手動オープン：period', (public.survey_window()->>'period'), '2026-Q3');
select public.t_assert('手動オープン：manual', (public.survey_window()->>'manual'), 'true');

-- 答える（経営者）
select public.t_assert('経営者が答える', public.survey_submit_for('00000000-0000-0000-0000-0000000000c1', '2026-Q3', '{"q1":4,"q2":5,"q3":3,"q4":4,"q5":5}', 'とても助かっています'), 'ok');
select public.t_assert('答えは匿名（user_id の列が無い）', (select count(*)::text from information_schema.columns where table_name='survey_responses' and column_name='user_id'), '0');
select public.t_assert('答えの表に1件', (select count(*)::text from public.survey_responses where period='2026-Q3' and audience='customer'), '1');
select public.t_assert('印の表に1件', (select count(*)::text from public.survey_done where period='2026-Q3'), '1');
select public.t_assert('二度目は断る', left(public.survey_submit_for('00000000-0000-0000-0000-0000000000c1', '2026-Q3', '{"q1":1,"q2":1,"q3":1,"q4":1,"q5":1}', null), 6), 'error:');
select public.t_assert('二度目は入らない', (select count(*)::text from public.survey_responses), '1');
select public.t_assert('パートナー：ひとこと無し', public.survey_submit_for('00000000-0000-0000-0000-0000000000b1', '2026-Q3', '{"q1":"5","q2":4,"q3":4,"q4":2,"q5":3}', '   '), 'ok');
select public.t_assert('ひとこと空は null', (select (comment is null)::text from public.survey_responses where audience='consultant'), 'true');
select public.t_assert('運営は対象外', left(public.survey_submit_for('00000000-0000-0000-0000-0000000000a1', '2026-Q3', '{"q1":5,"q2":5,"q3":5,"q4":5,"q5":5}', null), 6), 'error:');
select public.t_assert('6 は受け付けない', left(public.survey_submit_for('00000000-0000-0000-0000-0000000000c2', '2026-Q3', '{"q1":6,"q2":5,"q3":5,"q4":5,"q5":5}', null), 6), 'error:');
select public.t_assert('4問では受け付けない', left(public.survey_submit_for('00000000-0000-0000-0000-0000000000c2', '2026-Q3', '{"q1":5,"q2":5,"q3":5,"q4":5}', null), 6), 'error:');
select public.t_assert('違う期は受け付けない', left(public.survey_submit_for('00000000-0000-0000-0000-0000000000c2', '2025-Q1', '{"q1":5,"q2":5,"q3":5,"q4":5,"q5":5}', null), 6), 'error:');
select public.t_assert('長いひとことは1000字で切る', public.survey_submit_for('00000000-0000-0000-0000-0000000000c2', '2026-Q3', '{"q1":5,"q2":5,"q3":5,"q4":5,"q5":5}', repeat('あ', 1200)), 'ok');
select public.t_assert('切れている', (select max(length(comment))::text from public.survey_responses), '1000');

-- 手動オープンを閉じると、期間は自動の窓に戻る（今日が四半期の1〜21日かで open が変わるので、形だけ確かめる）
update public.app_settings set value = '{"period":"","until":""}'::jsonb where key='survey_open';
select public.t_assert('閉じたら manual=false', (public.survey_window()->>'manual'), 'false');
select public.t_assert('期は YYYY-Qn の形', ((public.survey_window()->>'period') ~ '^\d{4}-Q[1-4]$')::text, 'true');

-- 初期導入費の条文：新しい版が公開され、古い版は残る
select public.t_assert('顧問契約の版が2つ', (select count(*)::text from public.contract_templates where kind='customer'), '2');
select public.t_assert('公開中は新しい版', (select version::text from public.contract_templates where kind='customer' and active), '2');
select public.t_assert('第2条の2 が入った', (select (position('第2条の2（初期導入費）' in body) > 0)::text from public.contract_templates where kind='customer' and active), 'true');
select public.t_assert('第3条の前に入った', (select (position('第2条の2' in body) < position('第3条（成果の非保証）' in body))::text from public.contract_templates where kind='customer' and active), 'true');
select public.t_assert('パートナー契約は触らない', (select count(*)::text from public.contract_templates where kind='partner'), '1');

-- RLS：経営者は答えの表を読めない・自分の印だけ読める
create or replace function public.t_as(uid uuid, q text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute q into r;
  execute 'reset role';
  return r;
end $$;
select public.t_assert('経営者は答えを読めない', public.t_as('00000000-0000-0000-0000-0000000000c1', 'select count(*)::text from public.survey_responses'), '0');
select public.t_assert('経営者は自分の印だけ', public.t_as('00000000-0000-0000-0000-0000000000c1', 'select count(*)::text from public.survey_done'), '1');
select public.t_assert('運営は答えを読める', public.t_as('00000000-0000-0000-0000-0000000000a1', 'select count(*)::text from public.survey_responses'), '3');
select public.t_assert('運営は印を数えられる', public.t_as('00000000-0000-0000-0000-0000000000a1', 'select count(*)::text from public.survey_done'), '3');
select public.t_assert('経営者は survey_submit で自分として答える（既に答えたので断られる）', left(public.t_as('00000000-0000-0000-0000-0000000000c1', $q$select public.survey_submit('2026-Q3','{"q1":5,"q2":5,"q3":5,"q4":5,"q5":5}',null)$q$), 6), 'error:');
select 'ALL OK' as result;
