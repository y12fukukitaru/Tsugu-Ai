-- =============================================================
-- 支払明細の閲覧権限
--  パートナー：自分の担当顧客（メイン＝profiles.consultant_id、
--              サブ＝partner_assignments承認済み）の入金記録を閲覧可
--  顧客　　　：自社の入金記録（＋閲覧メンバー）を閲覧可
--  ※ revenue_entries は運営が記録する入金台帳。書き込み権限は変更しない。
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================

alter table public.revenue_entries enable row level security;

drop policy if exists "customer reads own revenue entries" on public.revenue_entries;
create policy "customer reads own revenue entries" on public.revenue_entries
  for select to authenticated
  using (
    customer_id = auth.uid()
    or exists (
      select 1 from public.company_members m
      where m.customer_id = revenue_entries.customer_id
        and m.member_id = auth.uid()
        and m.status = 'active'
    )
  );

drop policy if exists "partner reads own customers revenue entries" on public.revenue_entries;
create policy "partner reads own customers revenue entries" on public.revenue_entries
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = revenue_entries.customer_id
        and p.consultant_id = auth.uid()
    )
    or exists (
      select 1 from public.partner_assignments a
      where a.customer_id = revenue_entries.customer_id
        and a.status = 'approved'
        and (a.main_id = auth.uid() or a.sub_id = auth.uid())
    )
  );
