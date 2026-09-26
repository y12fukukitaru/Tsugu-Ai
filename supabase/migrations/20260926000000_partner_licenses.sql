-- =============================================================
-- パートナーの保有資格を、運営が確かめてから「実行できる領域」にする
-- ---------------------------------------------------------------
--  2026-09-23 から、資格をお持ちのパートナーは、その資格の範囲で
--  ご自身の本業として実行してよいことにした（保険・不動産・税務・
--  法務・労務・M&A・資金調達。IT・自動化は資格要件なし）。
--  ところが資格は「本業と連携」のボタンを押すだけの自己申告だった。
--  本人が実行してよい前提にする以上、運営が確かめてから効かせる。
--
--  ① 表 partner_licenses（パートナー1人 × 領域 1行）
--       登録番号（reg_no）と資格証の写し（file_path）を本人が出す。
--       出した・直したときは必ず「確認待ち（pending）」に戻る。
--       「確認済み（approved）」「差し戻し（rejected）」にできるのは運営だけ。
--       本人が status を書き換えても、トリガーで pending に戻す。
--  ② 資格証の写しを置く非公開バケット license-docs
--       パスは「本人のID/領域_時刻.拡張子」。本人は自分のフォルダだけ、
--       運営は全部を読める。公開URLは出さず、署名付きURLで開く。
--  ③ いま partner_business.licenses に入っている申告は、確認待ちとして
--       取り込む（IT・自動化は資格要件が無いので取り込まない）。
--
--  画面の側では、確認済みの領域だけを「あなたが実行する領域」と
--  専門家ネットワークの「実行体制」に数える。
--
--  確かめかた：表=1、バケット=1、ポリシー（表）=5、ポリシー（バケット）=3
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。Edge Function の変更はありません。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 表
-- ---------------------------------------------------------------
create table if not exists public.partner_licenses (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  field        text        not null,
  reg_no       text,
  file_path    text,
  file_name    text,
  status       text        not null default 'pending',
  note         text,                          -- 運営からのひとこと（差し戻しの理由など）
  submitted_at timestamptz not null default now(),
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  primary key (user_id, field)
);
alter table public.partner_licenses drop constraint if exists partner_licenses_status_check;
alter table public.partner_licenses add constraint partner_licenses_status_check
  check (status in ('pending','approved','rejected'));
alter table public.partner_licenses drop constraint if exists partner_licenses_field_check;
alter table public.partner_licenses add constraint partner_licenses_field_check
  check (field in ('insurance','realestate','tax','legal','labor','ma','finance'));
--  登録番号か資格証の写しの、どちらかは要る
alter table public.partner_licenses drop constraint if exists partner_licenses_evidence_check;
alter table public.partner_licenses add constraint partner_licenses_evidence_check
  check (coalesce(btrim(reg_no),'') <> '' or coalesce(file_path,'') <> '');

create index if not exists partner_licenses_status_idx on public.partner_licenses (status);

--  本人が出した・直したときは、確認待ちに戻す。運営の確認の欄は本人には触らせない
create or replace function public.partner_licenses_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.ep_is_admin() then
    if new.status in ('approved','rejected')
       and (tg_op = 'INSERT' or new.status is distinct from old.status) then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
    return new;
  end if;
  new.status       := 'pending';
  new.reviewed_by  := null;
  new.reviewed_at  := null;
  new.submitted_at := now();
  if tg_op = 'UPDATE' then new.note := old.note; else new.note := null; end if;
  return new;
end;
$$;

drop trigger if exists partner_licenses_guard on public.partner_licenses;
create trigger partner_licenses_guard
  before insert or update on public.partner_licenses
  for each row execute function public.partner_licenses_guard();

alter table public.partner_licenses enable row level security;

drop policy if exists "partner_licenses own read"   on public.partner_licenses;
drop policy if exists "partner_licenses own insert" on public.partner_licenses;
drop policy if exists "partner_licenses own update" on public.partner_licenses;
drop policy if exists "partner_licenses own delete" on public.partner_licenses;
drop policy if exists "partner_licenses admin all"  on public.partner_licenses;

create policy "partner_licenses own read" on public.partner_licenses
  for select to authenticated
  using (user_id = auth.uid());
create policy "partner_licenses own insert" on public.partner_licenses
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
create policy "partner_licenses own update" on public.partner_licenses
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and status = 'pending');
create policy "partner_licenses own delete" on public.partner_licenses
  for delete to authenticated
  using (user_id = auth.uid());
create policy "partner_licenses admin all" on public.partner_licenses
  for all to authenticated
  using (public.ep_is_admin())
  with check (public.ep_is_admin());

-- ---------------------------------------------------------------
-- ② 資格証の写しの置き場（非公開）
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('license-docs', 'license-docs', false)
on conflict (id) do update set public = false;

drop policy if exists "license docs own upload" on storage.objects;
create policy "license docs own upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'license-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "license docs read" on storage.objects;
create policy "license docs read" on storage.objects
  for select to authenticated
  using (bucket_id = 'license-docs'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.ep_is_admin()));

drop policy if exists "license docs own delete" on storage.objects;
create policy "license docs own delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'license-docs' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------
-- ③ いまの自己申告を、確認待ちとして取り込む
--    登録番号も写しもまだ無いので、制約を満たす仮の番号「（未提出）」を入れる。
--    画面では「番号か写しを出してください」と出る。
-- ---------------------------------------------------------------
do $do$
begin
  if to_regclass('public.partner_business') is null then return; end if;
  insert into public.partner_licenses (user_id, field, reg_no, status)
  select b.user_id, f.field, '（未提出）', 'pending'
    from public.partner_business b
    cross join lateral unnest(string_to_array(coalesce(b.licenses,''), ',')) as f(field)
   where f.field in ('insurance','realestate','tax','legal','labor','ma','finance')
  on conflict (user_id, field) do nothing;
end $do$;

-- ---------------------------------------------------------------
-- 確かめかた
-- ---------------------------------------------------------------
-- select
--   (select count(*) from pg_tables where schemaname='public' and tablename='partner_licenses') as "表=1",
--   (select count(*) from storage.buckets where id='license-docs' and public=false)            as "バケット=1",
--   (select count(*) from pg_policies where tablename='partner_licenses')                        as "ポリシー（表）=5",
--   (select count(*) from pg_policies where tablename='objects' and policyname like 'license docs%') as "ポリシー（バケット）=3";
