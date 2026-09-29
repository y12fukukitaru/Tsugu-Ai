-- =============================================================
-- 資格の確認：預かるものを登録番号だけにする（2026-09-29）
-- ---------------------------------------------------------------
--  20260926000000_partner_licenses.sql では、登録番号か資格証の写し（画像・PDF）を
--  出してもらっていた。資格証には住所・生年月日・顔写真まで載っていることが多く、
--  確認のために預かるには重すぎる。これからは次のようにする。
--
--  ① 新しい写しは受け付けない（バケットへの本人のアップロードをやめる）
--     以前お預かりした写しは、運営が確認を済ませたら削除する（運営に削除の権限を足す）
--  ② 確認の方法を残す列 verified_via を足す
--       registry    … 公開の名簿で照合した（税理士・弁護士・司法書士・行政書士・社労士など）
--       shown       … 面談・オンラインで資格証をその場で見せてもらった（写しは預からない）
--       affiliation … 所属先（代理店・事務所）に確かめた
--  ③ 「番号か写しのどちらかは要る」は確認待ちの行だけに効かせる
--     （確認が済んだあとに写しを消しても、行が制約に引っかからないように）
--  ④ 本人は写しの参照（file_path）を新しく付けられない。消すのは運営だけ
--
--  画面の側：本人は登録番号だけを入れる。確認が済んだ番号は運営の画面でも末尾4桁の表示。
--            パートナーのご契約が終わったら（運営が「対応済み」にしたとき）、行と写しを消す。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。Edge Function の変更はありません。
--           先に 20260926000000_partner_licenses.sql が流れている必要があります。
--
-- 確かめかた：確認の方法の列=1、写しのアップロード=0、運営の削除=1
-- =============================================================

-- ② 確認の方法
alter table public.partner_licenses add column if not exists verified_via text;
alter table public.partner_licenses drop constraint if exists partner_licenses_via_check;
alter table public.partner_licenses add constraint partner_licenses_via_check
  check (verified_via is null or verified_via in ('registry','shown','affiliation'));

-- ③ 番号か写しは、確認待ちのあいだだけ要る
alter table public.partner_licenses drop constraint if exists partner_licenses_evidence_check;
alter table public.partner_licenses add constraint partner_licenses_evidence_check
  check (status <> 'pending' or coalesce(btrim(reg_no),'') <> '' or coalesce(file_path,'') <> '');

-- ④ 本人が出した・直したときは確認待ちに戻す（これまでどおり）。
--    加えて、本人は写しの参照を新しく付けられず、確認の方法も書けない
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
  new.verified_via := null;
  new.submitted_at := now();
  if tg_op = 'UPDATE' then
    new.note      := old.note;
    new.file_path := old.file_path;
    new.file_name := old.file_name;
  else
    new.note      := null;
    new.file_path := null;
    new.file_name := null;
  end if;
  return new;
end;
$$;

drop trigger if exists partner_licenses_guard on public.partner_licenses;
create trigger partner_licenses_guard
  before insert or update on public.partner_licenses
  for each row execute function public.partner_licenses_guard();

-- ① 写しの置き場：本人のアップロードをやめ、運営が消せるようにする
drop policy if exists "license docs own upload" on storage.objects;

drop policy if exists "license docs admin delete" on storage.objects;
create policy "license docs admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'license-docs' and public.ep_is_admin());

comment on column public.partner_licenses.verified_via is
  '確認の方法：registry=公開の名簿で照合／shown=資格証をその場で見せてもらった（写しは預からない）／affiliation=所属先に確かめた';

-- ---------------------------------------------------------------
-- 確かめかた
-- ---------------------------------------------------------------
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='partner_licenses' and column_name='verified_via') as "確認の方法の列=1",
--   (select count(*) from pg_policies where tablename='objects' and policyname='license docs own upload') as "写しのアップロード=0",
--   (select count(*) from pg_policies where tablename='objects' and policyname='license docs admin delete') as "運営の削除=1";
