-- =============================================================
-- 買った後に備える（買い手の経営者向け）
-- ---------------------------------------------------------------
--  会社を買ったあとに待ち受けること（事務・お金・人・対外・業界・統合）を、
--  その会社の状況（業種・買いたい条件・右腕の有無・手元資金・借入）に
--  合わせて並べ、いま準備できることと学ぶことを置く場所。
--  ここに持つのは「想定する形（株式譲渡／事業譲渡）」「責任者の想定」
--  「対象の業種」と、項目ごとの状態（未着手／学んだ／準備した）とメモ。
--
--  確かめかた：表=1
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。Edge Function の変更はありません。
-- =============================================================
create table if not exists public.buyer_prep (
  customer_id     uuid primary key references public.profiles(id) on delete cascade,
  scheme          text check (scheme in ('stock','asset')),      -- 株式譲渡／事業譲渡
  leader          text check (leader in ('self','deputy','seller','hire')),  -- 責任者の想定
  target_industry text,                                          -- 対象の業種（INDUSTRY_PC の鍵）
  items           jsonb not null default '{}'::jsonb,            -- {"admin_license":{"st":"ready","note":"…"},…}
  notes           text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);
comment on table public.buyer_prep is
  '買った後に備える。想定する形・責任者・対象業種と、項目ごとの状態（todo/learned/ready）とメモ';
alter table public.buyer_prep enable row level security;
drop policy if exists "buyer_prep may" on public.buyer_prep;
create policy "buyer_prep may" on public.buyer_prep
  for all to authenticated
  using (public.customer_may(customer_id))
  with check (public.customer_may(customer_id));

select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='buyer_prep') as "表";
--  期待値：表=1
-- =============================================================
