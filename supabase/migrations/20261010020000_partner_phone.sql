-- =============================================================
-- パートナーの電話番号（2026-10-10）
--   設定 → 「電話番号」に、パートナーご本人が登録する。
--   一枚紙（社長にお渡しする紙）の右下「担当・連絡先」に自動で入る。
--   ・書けるのはご本人と運営だけ（profiles の行の守りのまま。新しい守りは要らない）
--   ・読める人は profiles の行の読み取りの決まりのまま（変えない）
--   ・使える文字は 数字・＋・ハイフン・かっこ・空白、20文字まで
--   何度流しても同じ結果になります。
-- =============================================================

alter table public.profiles add column if not exists phone text;

alter table public.profiles drop constraint if exists profiles_phone_chk;
alter table public.profiles add constraint profiles_phone_chk
  check (phone is null or (char_length(phone) <= 20 and phone ~ '^[0-9+() -]+$')) not valid;
--  not valid … すでに入っている行は確かめない（これから書く行だけ確かめる）。流すときに止まらないように

-- 確かめ（2つとも 1 なら完了）
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone') as "電話の列",
  (select count(*) from pg_constraint where conname = 'profiles_phone_chk')              as "使える文字の決まり";
