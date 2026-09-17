-- =============================================================
-- 出口の設計：出口の種類を増やす
--   資本提携（一部を譲る）／上場する（TOKYO PRO Market）／上場する（グロース市場など）
--   exit_plans.exit_type の check 制約を作り直すだけ。行は消えない
-- =============================================================

do $$
declare c text;
begin
  --  制約の名前は自動で付いているので、exit_type を見ている check を探して外す
  for c in
    select conname from pg_constraint
     where conrelid = 'public.exit_plans'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%exit_type%'
  loop
    execute format('alter table public.exit_plans drop constraint %I', c);
  end loop;
end $$;

alter table public.exit_plans
  add constraint exit_plans_exit_type_check
  check (exit_type in ('sell','family','employee','close','buyer','alliance','tpm','ipo'));

comment on column public.exit_plans.exit_type is
  '出口の種類。sell=第三者へ譲る / family=親族へ継ぐ / employee=従業員へ継ぐ / alliance=資本提携（一部を譲る） / tpm=上場（TOKYO PRO Market） / ipo=上場（グロース市場など） / close=畳む / buyer=続けて買い手になる';

-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from pg_constraint
    where conrelid = 'public.exit_plans'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%tpm%')                                    as "新しい制約",
  (select count(*) from pg_constraint
    where conrelid = 'public.exit_plans'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%exit_type%')                              as "exit_type の制約",
  (select count(*) from public.exit_plans
    where exit_type is not null
      and exit_type not in ('sell','family','employee','close','buyer','alliance','tpm','ipo')) as "はみ出た行";
--  期待値：新しい制約=1、exit_type の制約=1、はみ出た行=0
-- =============================================================
