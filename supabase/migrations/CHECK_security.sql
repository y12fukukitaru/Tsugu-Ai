-- =============================================================
-- 守りの点検（読むだけ。何も変えません）
-- ---------------------------------------------------------------
--  マイグレーションに書いてある表は、こちらで確かめられます。
--  けれど Supabase の画面で先に作った表（profiles、chat_messages、
--  ai_shares、meetings_scheduled など）は、こちらからは見えません。
--  そこを見るための点検です。
--
--  いちばん大事なこと：
--  このプラットフォームは静的なページなので、**公開鍵は誰でも読めます。**
--  ページのソースに載っているからです。それが正しい設計です。
--  ですから、守っているのは鍵ではなく **RLS（行の見張り）** だけです。
--  RLS の付いていない表が public に一つでもあれば、
--  **その表は登録した人全員に丸見えで、書き換えもできます。**
--
--  結果は一枚の表で返します。**「気になる」の行が0件なら合格です。**
--  0件でなければ、その表をそのまま貼って教えてください。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================
with

-- ① RLS の付いていない表。ここが本丸
no_rls as (
  select '① 見張りの無い表' as "点検", c.relname::text as "対象",
         '登録した人全員に見えます。すぐに直してください' as "何が起きるか"
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
),

-- ② RLS はあるが決まりが1つも無い。漏れないが画面が壊れる
no_policy as (
  select '② 決まりの無い表', c.relname::text,
         '誰にも見えません。この表を使う画面が動いていないはずです'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relkind='r' and c.relrowsecurity
     and not exists (select 1 from pg_policies p
                      where p.schemaname='public' and p.tablename=c.relname)
),

-- ③ 未ログイン（anon）に開いている表
anon_grant as (
  select '③ 未ログインに開いた表',
         table_name::text||'（'||privilege_type||'）',
         '鍵さえあれば、ログインせずに触れます'
    from information_schema.role_table_grants
   where table_schema='public' and grantee='anon'
),

-- ④ 条件がゆるい決まり。「ログインしていれば誰でも」は、
--    誰でも登録できるこのサービスでは全開と同じ
loose as (
  select '④ 条件のゆるい決まり',
         schemaname||'.'||tablename||' / '||policyname||'（'||cmd||'）',
         'いま：'||left(coalesce(qual, with_check, '(なし)'), 120)
    from pg_policies
   where schemaname in ('public','storage')
     and coalesce(qual, with_check) is not null
     and coalesce(qual, with_check) not like '%auth.uid()%'
     and coalesce(qual, with_check) not like '%auth.jwt()%'
     and coalesce(qual, with_check) not like '%_may(%'
     and coalesce(qual, with_check) not like '%_can_see(%'
     and coalesce(qual, with_check) not like '%is_admin%'
),

-- ⑤ 公開バケット。公開だと、URLを知る誰でもログイン無しで落とせる
pub_bucket as (
  select '⑤ 公開のバケット', id::text,
         'URLを知っていれば、ログイン無しで中身を落とせます'
    from storage.buckets where public
),

-- ⑥ 添付の決まりが、バケット名しか見ていない
weak_storage as (
  select '⑥ 添付の見張りが甘い', policyname||'（'||cmd||'）',
         'いま：'||left(coalesce(qual, with_check,'(なし)'), 120)
    from pg_policies
   where schemaname='storage' and tablename='objects'
     and coalesce(qual, with_check) not like '%chat_att_may%'
),

-- ⑦ 見張りを飛び越える関数で、呼ぶ人を絞っていないもの。
--    contract_open と contract_agree は、URLを知っている人が
--    ログイン無しで読む・同意するための入口なので、これでよい
open_fn as (
  select '⑦ 素通しの関数', p.proname::text||'()',
         '誰が呼んでもよい状態です。意図したものか確かめてください'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.prosecdef
     and p.proname not in ('contract_open','contract_agree')
     and pg_get_functiondef(p.oid) not like '%auth.uid()%'
     and pg_get_functiondef(p.oid) not like '%auth.jwt()%'
     and pg_get_functiondef(p.oid) not like '%_is_admin%'
     and pg_get_functiondef(p.oid) not like '%_can_see%'
     and has_function_privilege('authenticated', p.oid, 'execute')
),

-- ⑧ 契約が status 以外の列も書き換えられる状態か
contract_cols as (
  select '⑧ 契約の書き換え', column_name::text,
         'status 以外を書き換えられます。種別を partner に化けさせられます'
    from information_schema.column_privileges
   where table_schema='public' and table_name='contract_offers'
     and grantee='authenticated' and privilege_type='UPDATE'
     and column_name <> 'status'
),

all_rows as (
  select * from no_rls      union all select * from no_policy
  union all select * from anon_grant  union all select * from loose
  union all select * from pub_bucket  union all select * from weak_storage
  union all select * from open_fn     union all select * from contract_cols
)

select "点検", "対象", "何が起きるか" from all_rows
union all
select '── 合計 ──',
       case when (select count(*) from all_rows) = 0
            then '気になる点はありません'
            else (select count(*) from all_rows)::text || ' 件あります' end,
       ''
 order by 1;
-- =============================================================
