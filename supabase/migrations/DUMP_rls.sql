-- =============================================================
-- 脆弱性診断用：いま本番に入っている権限設定を、そのまま書き出す
--   これは「調べるだけ」の SQL です。何も変更しません。
--   Supabase Dashboard → SQL Editor に貼り付けて Run し、
--   結果をコピーしてお渡しください。
--
--   ①〜④ を1つずつ実行してください（SQL Editor は最後の select だけを
--   表示するため、使うもの以外は -- でコメントアウトしています）。
--   いちばん見たいのは ① です。
-- =============================================================


-- ---------- ① いちばん重要：profiles を誰が書き換えられるか ----------
--  ここが「本人なら自分の行を全部書き換えてよい」だけになっていると、
--  ブラウザの開発者ツールから自分の role を 'admin' に書き換えられてしまう。
--  （画面上は運営メニューを隠しているが、隠しているだけでは防げない）
--  期待する形：UPDATE の with_check に role を変えさせない条件が入っている、
--  もしくは role の変更を運営だけに許す別のポリシーがある。
select p.policyname as 名前,
       p.cmd        as 操作,
       array_to_string(p.roles,',') as 対象,
       p.qual       as 読める条件,
       p.with_check as 書ける条件
  from pg_policies p
 where p.schemaname='public' and p.tablename='profiles'
 order by p.cmd, p.policyname;


-- ---------- ② RLS が有効かどうか（テーブル一覧） ----------
-- select c.relname as テーブル,
--        case when c.relrowsecurity then 'ON' else '⚠ OFF' end as rls,
--        (select count(*) from pg_policies p
--          where p.schemaname='public' and p.tablename=c.relname) as ポリシー数
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname='public' and c.relkind='r'
--  order by c.relrowsecurity, c.relname;


-- ---------- ③ 全ポリシーの中身 ----------
-- select p.schemaname as スキーマ, p.tablename as テーブル, p.policyname as 名前,
--        p.cmd as 操作, array_to_string(p.roles,',') as 対象,
--        p.qual as 読める条件, p.with_check as 書ける条件
--   from pg_policies p
--  where p.schemaname in ('public','storage')
--  order by p.schemaname, p.tablename, p.cmd, p.policyname;


-- ---------- ④ SECURITY DEFINER の関数（権限を跨げる関数） ----------
-- select p.proname as 関数,
--        case when p.prosecdef then 'DEFINER（要確認）' else 'INVOKER' end as 実行権限,
--        pg_get_function_identity_arguments(p.oid) as 引数,
--        array_to_string(p.proconfig,', ') as 設定
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public'
--  order by p.prosecdef desc, p.proname;
