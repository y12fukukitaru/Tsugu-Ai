-- =============================================================
-- 法人パートナーの区分を EP-I / EP-II の2つに整理する
-- ---------------------------------------------------------------
--  料金の完成表にあわせて、区分を次のように改める。
--
--    旧 B  （顧客基盤型）          → EP1（EP-I  顧客基盤型）
--    旧 A1 （所属型・継が運営）    → EP2（EP-II 所属営業型）
--    旧 A2 （所属型・本部が運営）  → EP2（同上）
--
--  A-1／A-2 の区別は廃止する。本部の取り分は、A-2だけ厚くするのではなく
--  EP-II 一律10%になったため、料金の上で二つを分ける理由が無くなった。
--
--  あわせて override_bonus_pt（A-2で本部が上乗せしていた5〜7pt）を使わなく
--  する。列は消さずに残す。過去にいくつで運用していたかが分からなくなると、
--  移行前の精算を確かめられなくなるため。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になる。
-- =============================================================

--  古い制約を外してから中身を移し、新しい制約を付ける。
--  順番を逆にすると、移す途中で制約に引っかかる。
alter table public.ep_orgs drop constraint if exists ep_orgs_kind_check;

update public.ep_orgs set kind = 'EP1' where kind = 'B';
update public.ep_orgs set kind = 'EP2' where kind in ('A1','A2');

alter table public.ep_orgs alter column kind set default 'EP1';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ep_orgs'::regclass
       and conname  = 'ep_orgs_kind_check'
  ) then
    alter table public.ep_orgs
      add constraint ep_orgs_kind_check check (kind in ('EP1','EP2'));
  end if;
end $$;

comment on column public.ep_orgs.kind is
  'EP1＝顧客基盤型（法人が80%）／EP2＝所属営業型（個人がLv料率・本部が一律10%）';
comment on column public.ep_orgs.override_bonus_pt is
  '旧A-2で本部が上乗せしていた率。EP-IIは本部一律10%になったため、いまは使わない（記録用に残置）';


-- =============================================================
-- 確認（Run したあとに、この select だけを実行してください）
-- =============================================================
-- select
--   (select count(*) from pg_constraint
--     where conrelid='public.ep_orgs'::regclass and conname='ep_orgs_kind_check') as 制約,
--   (select count(*) from public.ep_orgs where kind not in ('EP1','EP2'))         as 古い区分の残り,
--   (select count(*) from public.ep_orgs where kind='EP1')                        as EP1の数,
--   (select count(*) from public.ep_orgs where kind='EP2')                        as EP2の数;
--   -- 制約=1、古い区分の残り=0 なら成功です。
--   -- （まだ法人を作っていなければ EP1の数・EP2の数 はどちらも 0 です）
