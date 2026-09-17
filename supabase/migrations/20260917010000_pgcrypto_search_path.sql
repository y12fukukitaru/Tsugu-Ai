-- =============================================================
-- 暗号の部品（pgcrypto）が見つからない問題を直す
-- ---------------------------------------------------------------
--  Googleカレンダーをつなごうとしたら、こう返りました。
--
--      function pgp_sym_encrypt(text, text) does not exist
--
--  部品が無いのではありません。**置いてある棚が違う**だけです。
--
--  Supabase では pgcrypto は `extensions` という棚に入ります。
--  ところが、暗号化を使う関数はどれも
--
--      set search_path = public
--
--  と書いてあり、**public の棚しか見ません**。だから見つからない。
--
--  ■ 同じ書き方が、口座情報のほうにもありました
--
--    パートナーの口座を暗号化して預かる関数も同じです。
--
--      payout_key ／ payout_account_submit
--      payout_account_reveal ／ payout_account_for_transfer
--
--    こちらは、まだ誰も口座を登録していないので表に出ていません。
--    けれど**登録しようとした瞬間に、同じところで止まります**。
--    総合振込ファイルを作る手前で気づくことになります。
--    ついでではなく、同じ不具合なので一緒に直します。
--
--  ■ 直しかた
--
--    関数の中身は触りません。`search_path` に extensions を足すだけです
--    （alter function ... set search_path）。中身を書き直すと、
--    写し間違いのぶんだけ危なくなります。
--
--    pgp_sym を使っている public の関数を**探して、全部**直します。
--    名指しにすると、今後足したものが漏れます。
--
--  確かめかた：まだ直っていない関数=0、暗号化できるか=true
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になります。
-- =============================================================

-- ---------------------------------------------------------------
-- ① pgcrypto があることを確かめる（無ければ入れる）
-- ---------------------------------------------------------------
--  すでにどこかに入っていれば、これは何もしません。
--  入っていなければ extensions の棚に入れます。
do $do$
begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    if exists (select 1 from pg_namespace where nspname = 'extensions') then
      execute 'create extension pgcrypto with schema extensions';
    else
      execute 'create extension pgcrypto';
    end if;
  end if;
end $do$;

-- ---------------------------------------------------------------
-- ② 暗号化を使っている関数の search_path に、その棚を足す
-- ---------------------------------------------------------------
--  public と extensions の両方を見るようにします。どちらに入って
--  いても動くので、環境の違いで転びません。
do $do$
declare
  r record;
  v_ext text;
begin
  select n.nspname into v_ext
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';
  if v_ext is null then
    raise exception 'pgcrypto が見つかりません。①が失敗しています';
  end if;

  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosrc like '%pgp_sym%'
  loop
    --  中身は触らず、見る棚だけを足す
    execute format('alter function %s set search_path = public, %I', r.sig, v_ext);
  end loop;
end $do$;

-- ---------------------------------------------------------------
-- ③ 本当に暗号化できるかを確かめる関数
-- ---------------------------------------------------------------
--  「関数の数を数える」だけでは、動くかどうかは分かりません。
--  実際に関数の中から暗号化してみて、その結果を返します。
--  今後また同じことが起きたとき、ここを呼べば切り分けられます。
create or replace function public.crypto_ok()
returns boolean
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
begin
  --  鍵を取り出して、実際に一度暗号化してみる
  perform pgp_sym_encrypt('test', public.google_key());
  return true;
exception when others then
  return false;
end $$;

comment on function public.crypto_ok() is
  '暗号化が実際に動くかの確認用。false なら pgcrypto の棚が見えていない';
revoke all on function public.crypto_ok() from public, anon, authenticated;


-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
with ext as (
  select n.nspname as sch
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto'
)
select
  (select sch from ext)                                                    as pgcryptoの棚,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%pgp_sym%')::text        as 暗号化を使う関数,
  --  その棚を見ていない関数が残っていないか
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%pgp_sym%'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
         where c like 'search_path=%' and c like '%' || (select sch from ext) || '%'
      ))::text                                                             as まだ直っていない関数,
  --  ここが本当の答え。実際に暗号化してみた結果
  public.crypto_ok()::text                                                 as 暗号化できるか;
-- 期待：まだ直っていない関数=0、暗号化できるか=true
--       （pgcryptoの棚 は extensions か public。どちらでも構いません）
