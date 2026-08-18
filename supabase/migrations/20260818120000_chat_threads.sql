-- =============================================================
-- 会話の一区切りを覚えておく（chat_threads）
--
--  やり取りは、こちらが送って終わるとは限らない。顧客の「ありがとう
--  ございます」で自然に終わることのほうが多い。ところが仕組みの上では
--  「最後が顧客発＝まだ返信していない」に見えるため、いつまでも
--  「返信待ち」として残り続けていた。
--
--  パートナーが「この件はここで一区切り」と押したら、その時刻を覚える。
--  毎朝の「今日の一手」は、そこから先に新しいメッセージが来ていなければ
--  蒸し返さない。新しく届けば、また拾う。
--
--  1顧客につき1行。押し直せば時刻が更新される。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になる。
-- =============================================================

create table if not exists public.chat_threads (
  customer_id uuid primary key references auth.users(id) on delete cascade,
  closed_at   timestamptz,
  closed_by   uuid,
  updated_at  timestamptz not null default now()
);

alter table public.chat_threads enable row level security;

-- 読み書きできるのは、その顧客の担当パートナー（主・副）と運営だけ。
--  ヘルパー関数に依存せず、この1本で完結させる。
drop policy if exists "chat_threads staff" on public.chat_threads;
create policy "chat_threads staff" on public.chat_threads
  for all to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.id = chat_threads.customer_id
               and p.consultant_id = auth.uid())
    or exists (select 1 from public.partner_assignments a
             where a.customer_id = chat_threads.customer_id
               and a.status = 'approved'
               and (a.main_id = auth.uid() or a.sub_id = auth.uid()))
    or exists (select 1 from public.profiles me
             where me.id = auth.uid() and me.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p
             where p.id = chat_threads.customer_id
               and p.consultant_id = auth.uid())
    or exists (select 1 from public.partner_assignments a
             where a.customer_id = chat_threads.customer_id
               and a.status = 'approved'
               and (a.main_id = auth.uid() or a.sub_id = auth.uid()))
    or exists (select 1 from public.profiles me
             where me.id = auth.uid() and me.role = 'admin')
  );


-- =============================================================
-- 確認（Run したあとに、この select だけを実行してください）
--   表と権限ができているかを見ます。
-- =============================================================
-- select
--   (select count(*) from information_schema.tables
--     where table_schema='public' and table_name='chat_threads')      as 表,
--   (select count(*) from pg_policies
--     where schemaname='public' and tablename='chat_threads')          as 権限の本数;
--   -- 表=1、権限の本数=1 なら成功です。
