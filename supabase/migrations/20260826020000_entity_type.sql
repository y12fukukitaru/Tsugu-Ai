-- =============================================================
-- 個人か法人か（源泉徴収の要否を決めるため）
-- ---------------------------------------------------------------
--  パートナーへの報酬から源泉徴収を差し引くようにした。ただし
--  源泉徴収は「法人が個人へ支払うとき」の制度で、法人への支払いには
--  生じない。全員一律に引くと、法人のパートナーからは払い過ぎた税金を
--  取り戻す手間を負わせることになる。
--
--  そこで、その方が個人か法人かを持たせる。
--    profiles.entity_type … 認定パートナー本人（A型の所属個人を含む）
--    ep_orgs.entity_type  … B型の士業パートナー（個人事業の場合がある）
--
--  null は「未設定」。未設定のあいだは源泉徴収を引かず、画面に
--  「未設定」と出す。分からないまま引くと返金の手間が生じるため、
--  引かない側に倒す。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になる。
-- =============================================================

alter table public.profiles
  add column if not exists entity_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname  = 'profiles_entity_type_check'
  ) then
    alter table public.profiles
      add constraint profiles_entity_type_check
      check (entity_type is null or entity_type in ('individual','corporate'));
  end if;
end $$;

alter table public.ep_orgs
  add column if not exists entity_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ep_orgs'::regclass
       and conname  = 'ep_orgs_entity_type_check'
  ) then
    alter table public.ep_orgs
      add constraint ep_orgs_entity_type_check
      check (entity_type is null or entity_type in ('individual','corporate'));
  end if;
end $$;

--  「個人のパートナーだけ源泉徴収」を引くときに毎回使う
create index if not exists profiles_entity_type_idx
  on public.profiles (entity_type) where entity_type is not null;


-- =============================================================
-- 確認（Run したあとに、この select だけを実行してください）
-- =============================================================
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='profiles'
--       and column_name='entity_type')                            as 個人法人_パートナー,
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='ep_orgs'
--       and column_name='entity_type')                            as 個人法人_EP,
--   (select count(*) from pg_constraint
--     where conname in ('profiles_entity_type_check','ep_orgs_entity_type_check')) as 制約;
--   -- すべて 1、制約=2 なら成功です。
