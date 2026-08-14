-- =============================================================
-- プロフィール画像
--   メニューの足元に出る本人のしるし。3通りの値を取る。
--     ''（NULL）      … 頭文字を表示（初期状態）
--     'navi'          … 継ナビくん
--     'data:image/…'  … 本人が選んだ写真
--
--   写真は端末側で 128px 四方に切り抜き・JPEG 化してから送るため、
--   1枚あたり数KBに収まる。ストレージのバケットは増やさない。
--
--   RLS は profiles の既存ポリシー（本人のみ自分の行を更新できる）を
--   そのまま使うので、ここでの追加は不要。
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================

alter table public.profiles add column if not exists avatar text;

-- 万一大きな値が入らないよう、上限をかけておく（128px JPEG なら十分収まる）
alter table public.profiles drop constraint if exists profiles_avatar_len;
alter table public.profiles add constraint profiles_avatar_len
  check (avatar is null or length(avatar) <= 200000);
