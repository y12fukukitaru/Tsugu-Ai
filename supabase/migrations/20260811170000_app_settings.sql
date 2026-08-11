-- =============================================================
-- 運営設定の保存（app_settings）
--  課金・契約管理の料率／顧問料の割引設定を保存し、
--  運営メンバー全員のコンソールで同じ値が使われるようにする。
--  （これまでは画面上の試算のみで、再読み込みすると初期値に戻っていた）
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "admin manages app settings" on public.app_settings;
create policy "admin manages app settings" on public.app_settings
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
