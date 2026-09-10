-- =============================================================
-- 守りの点検 v2（読むだけ。何も変えません）
-- ---------------------------------------------------------------
--  v1 は 552行 出てしまい、大事な行が埋もれました。原因は二つです。
--
--   ・anon への権限を全部数えていた。Supabase は既定で public の全表に
--     anon と authenticated の権限を配ります。それが普通の姿で、
--     守っているのは権限ではなく RLS です。**RLS が付いていれば
--     anon に権限があっても入れません。**だから「権限がある」だけでは
--     危なくない。危ないのは「RLS が無くて、権限がある」表です。
--
--   ・見張りの関数を知らなかった。is_company_member・is_sub_partner・
--     ep_is_member・has_admin_perm などを「本人確認なし」と誤って
--     数えていました。
--
--  v2 は、本当に危ないものだけを出します。**「合計」が0件なら合格です。**
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================
with

--  ① RLS が付いていない表。ここが本丸。
--     公開鍵はページのソースに載っているので、RLS が無い＝全員に見える
no_rls as (
  select '① 見張りが無い' as "点検", c.relname::text as "対象",
         '登録した人全員に丸見えです。すぐ直してください' as "何が起きるか"
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
),

--  ② RLS はあるが決まりが1つも無い。漏れないが、画面が動かない
no_policy as (
  select '② 決まりが無い', c.relname::text,
         '誰にも見えません。この表を使う画面が動いていないはずです'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relkind='r' and c.relrowsecurity
     and not exists (select 1 from pg_policies p
                      where p.schemaname='public' and p.tablename=c.relname)
),

--  ③ 誰でも通る決まり。条件がそのまま true のものだけ
allow_all as (
  select '③ 誰でも通る決まり',
         schemaname||'.'||tablename||' / '||policyname||'（'||cmd||'）',
         'いま：'||coalesce(qual, with_check)
    from pg_policies
   where schemaname in ('public','storage')
     and btrim(coalesce(qual, with_check), '() ') = 'true'
),

--  ④ 本人を一切見ていない決まり。関数呼び出しも auth も無いもの
no_check as (
  select '④ 本人を見ていない決まり',
         schemaname||'.'||tablename||' / '||policyname||'（'||cmd||'）',
         'いま：'||left(coalesce(qual, with_check), 90)
    from pg_policies
   where schemaname in ('public','storage')
     and coalesce(qual, with_check) is not null
     and btrim(coalesce(qual, with_check), '() ') <> 'true'
     and coalesce(qual, with_check) not like '%auth.%'
     and coalesce(qual, with_check) not like '%(%'
),

--  ⑤ 公開バケット。URLを知る誰でも、ログイン無しで落とせる
pub_bucket as (
  select '⑤ 公開のバケット', id::text,
         'URLを知っていれば、ログイン無しで中身を落とせます'
    from storage.buckets where public
),

--  ⑥ 添付の見張り。chat_att_may が入っていない決まりが残っていないか
weak_att as (
  select '⑥ 添付の見張りが甘い', policyname||'（'||cmd||'）',
         'いま：'||left(coalesce(qual, with_check,'(なし)'), 90)
    from pg_policies
   where schemaname='storage' and tablename='objects'
     and coalesce(qual, with_check) like '%chat-attach%'
     and coalesce(qual, with_check) not like '%chat_att_may%'
),

--  ⑦ 見張りを飛び越える関数のうち、中で誰も確かめていないもの。
--     トリガ関数（handle_new_user など）は直接呼ぶものではないので除く。
--     contract_open と contract_agree は、URLを知る人がログイン無しで
--     読む・同意するための入口なので、これでよい
open_fn as (
  select '⑦ 素通しの関数', p.proname::text||'()',
         '誰が呼んでもよい状態です。意図したものか確かめてください'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.prosecdef
     --  prokind='f' は「ふつうの関数」。集約や窓関数を混ぜると
     --  pg_get_functiondef が落ちて、点検そのものが動かなくなる
     and p.prokind = 'f'
     and p.prorettype <> 'trigger'::regtype
     and p.proname not in ('contract_open','contract_agree')
     and pg_get_functiondef(p.oid) not like '%auth.%'
     and has_function_privilege('authenticated', p.oid, 'execute')
     --  中で別の関数に見張りを任せている場合がある。
     --  invoice_* は invoice_is_admin() を、ep_affiliation は
     --  ep_is_admin() を呼んでいて、その先で auth.uid() を見ている。
     --  一段たどってから判断しないと、守っている関数まで並んでしまう
     and not exists (
       select 1 from pg_proc g join pg_namespace gn on gn.oid = g.pronamespace
        where gn.nspname='public' and g.oid <> p.oid and g.prokind = 'f'
          and pg_get_functiondef(p.oid) like '%'||g.proname||'(%'
          and pg_get_functiondef(g.oid) like '%auth.%'
     )
),

--  ⑧ 契約が status 以外も書き換えられる状態か
contract_cols as (
  select '⑧ 契約の書き換え', column_name::text,
         'status 以外を書き換えられます。種別を partner に化けさせられます'
    from information_schema.column_privileges
   where table_schema='public' and table_name='contract_offers'
     and grantee='authenticated' and privilege_type='UPDATE'
     and column_name <> 'status'
),

all_rows as (
  select * from no_rls    union all select * from no_policy
  union all select * from allow_all  union all select * from no_check
  union all select * from pub_bucket union all select * from weak_att
  union all select * from open_fn    union all select * from contract_cols
),

--  大事な表だけ、名指しで状態を出す。財務の話が載るのはこの4つ
key_tables as (
  select 'ⓘ 大事な表' as "点検", t.n as "対象",
         case when to_regclass('public.'||t.n) is null then '表がありません'
              when not (select relrowsecurity from pg_class
                         where oid = to_regclass('public.'||t.n))
                   then '⚠ 見張りが無い'
              else '見張りあり／決まり '||
                   (select count(*) from pg_policies
                     where schemaname='public' and tablename=t.n)::text||'件'
         end as "何が起きるか"
    from (values ('profiles'),('chat_messages'),('valuation_snapshots'),
                 ('ai_shares')) as t(n)
)

select "点検", "対象", "何が起きるか" from all_rows
union all select * from key_tables
union all
select '── 合計 ──',
       case when (select count(*) from all_rows) = 0
            then '✅ 気になる点はありません'
            else '⚠ '||(select count(*) from all_rows)::text||' 件あります' end,
       ''
 order by 1;
-- =============================================================
