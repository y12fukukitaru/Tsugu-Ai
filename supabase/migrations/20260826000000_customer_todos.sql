-- =============================================================
-- 顧客がその日・翌日の「やること」を書き、担当パートナーと分かち合う
-- ---------------------------------------------------------------
--  経営者は毎日たくさんのことを抱えている。そのうち何を今日やるつもりか
--  が担当パートナーに見えていれば、面談で「あれはどうなりましたか」から
--  始められる。逆に見えていないと、毎回ゼロから聞き直すことになる。
--
--  すでにある pdca_items（経営課題）は、数ヶ月かけて取り組むテーマ。
--  こちらは「明日やること」の粒度で、そこは分ける。
--
--  ただし切り離しはしない。pdca_id を持たせ、
--    ・pdca_id あり … 最終目的につながるやること（追える）
--    ・pdca_id なし … 雑務。片づいたら消えてよい
--  として、目的のあるものだけを後から辿れるようにする。
--
--  書けるのは顧客本人だけ。パートナーと運営は読むだけにする。
--  パートナーが顧客の「やること」を書き換えられると、それは指示になり、
--  自分で決めるという性質が失われる。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になる。
-- =============================================================

create table if not exists public.customer_todos (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  --  いつやるつもりか。既定は日本時間の明日
  due_on      date not null default ((now() at time zone 'Asia/Tokyo')::date + 1),
  --  1=高い 2=ふつう 3=低い
  priority    smallint not null default 2 check (priority between 1 and 3),
  --  つながる経営課題。null なら雑務
  pdca_id     uuid references public.pdca_items(id) on delete set null,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

--  「その顧客の、この日の、未完のもの」を引く形がいちばん多い
create index if not exists customer_todos_cust_due_idx
  on public.customer_todos (customer_id, due_on desc, done_at);

alter table public.customer_todos enable row level security;

-- ---- 顧客本人：自分のぶんだけ、読み書きできる ----
drop policy if exists "customer_todos own" on public.customer_todos;
create policy "customer_todos own" on public.customer_todos
  for all to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

-- ---- 担当パートナー・運営：読むだけ ----
--  ヘルパー関数に依存せず、この1本で完結させる。
drop policy if exists "customer_todos staff read" on public.customer_todos;
create policy "customer_todos staff read" on public.customer_todos
  for select to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.id = customer_todos.customer_id
               and p.consultant_id = auth.uid())
    or exists (select 1 from public.partner_assignments a
             where a.customer_id = customer_todos.customer_id
               and a.status = 'approved'
               and (a.main_id = auth.uid() or a.sub_id = auth.uid()))
    or exists (select 1 from public.profiles me
             where me.id = auth.uid() and me.role = 'admin')
  );


-- =============================================================
-- 確認（Run したあとに、この select だけを実行してください）
-- =============================================================
-- select
--   (select count(*) from information_schema.tables
--     where table_schema='public' and table_name='customer_todos')   as 表,
--   (select count(*) from pg_policies
--     where schemaname='public' and tablename='customer_todos')      as 権限の本数;
--   -- 表=1、権限の本数=2 なら成功です。
