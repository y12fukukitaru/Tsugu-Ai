-- =============================================================
-- 二段階認証を、データベースの側でも守らせる（2026-10-10 情報の守り）
-- ---------------------------------------------------------------
--  画面は、二段階認証を設定した方に「6桁のコード」を求めます。
--  ただし画面で止めるだけでは、パスワードを盗んだ人が画面を通さずに
--  データベースへ直接問い合わせると、中身を読めてしまいます。
--
--  そこで、すべての表に「止める側の決まり（restrictive policy）」を1つずつ足します。
--    ・二段階認証を設定した方 … コードを入れたログイン（aal2）でなければ、1行も読めない・書けない
--    ・まだ設定していない方   … これまでどおり（経営者は任意のため）
--  運営とパートナーは、画面で設定が必須なので、設定したその日から必ずこの守りの中に入ります。
--
--  ■ 新しい表を足したとき
--    この SQL をもう一度流してください（何度流しても同じ結果になります）。
--    いちばん下の確かめで「守りの無い表」が 0 なら、全部の表に入っています。
--
--  ■ スマホをなくした方がいるとき（運営の代表だけが行う）
--    ご本人であることを確かめたうえで、SQL Editor で次を実行すると、
--    その方の二段階認証が外れ、次のログインで設定し直せます。
--      delete from auth.mfa_factors
--       where user_id = (select id from auth.users where email = 'その方のメール');
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--   先に Authentication → Multi-Factor で「TOTP」が有効か確かめてください（既定で有効）
-- =============================================================

--  いまのログインが、この方に求められる強さを満たしているか
--    二段階認証を設定済み（確認済みの要素がある）→ aal2 のログインのときだけ true
--    設定していない                               → true（これまでどおり）
--  auth.mfa_factors を読むので definer。
--  ポリシーからは「(select 関数())」ではなく、関数をそのまま呼ぶ。
--  (select ...) の形にすると、自分の表を読み返す既存のポリシー（運営の判定など）と
--  組み合わさって「無限の読み返し」のエラーになるため（手元で再現して確かめた）。
--  コードを入れたログイン（aal2）なら、表を見ずにすぐ true を返す
create or replace function public.tsugu_aal_ok()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f
                      where f.user_id = auth.uid() and f.status = 'verified');
$$;
revoke all on function public.tsugu_aal_ok() from public, anon;
grant execute on function public.tsugu_aal_ok() to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.tsugu_aal_ok() to service_role';
  end if;
end $do$;

--  行単位の権限（RLS）を入れている public の表、すべてに足す
do $do$
declare t text;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
  loop
    execute format('drop policy if exists "mfa required" on public.%I', t);
    execute format('create policy "mfa required" on public.%I as restrictive for all to authenticated '
                   'using (public.tsugu_aal_ok()) with check (public.tsugu_aal_ok())', t);
  end loop;
end $do$;

--  添付ファイルの置き場（storage）にも
do $do$ begin
  begin
    execute 'drop policy if exists "mfa required" on storage.objects';
    execute 'create policy "mfa required" on storage.objects as restrictive for all to authenticated '
            'using (public.tsugu_aal_ok()) with check (public.tsugu_aal_ok())';
  exception when insufficient_privilege or undefined_table then
    raise notice 'storage.objects に足せませんでした（権限）。Dashboard の Storage → Policies から同じ内容を足してください';
  end;
end $do$;


-- 確かめる -----------------------------------------------------
--  守りの無い表 = 0、置き場 = 1 なら完了
select
  (select count(*)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
      and not exists (select 1 from pg_policies p
                       where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'mfa required')) as "守りの無い表",
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'mfa required') as "置き場",
  (select count(*) from pg_policies where schemaname = 'public' and policyname = 'mfa required')                         as "守りを入れた表の数";
