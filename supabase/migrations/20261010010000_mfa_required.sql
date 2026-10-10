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
--  ■ 機種変更（前のスマホが手元にある）
--    ご本人が 設定 → 🔐 二段階認証 →「📱 スマホを替える」で移せます（運営の手は要りません）。
--
--  ■ スマホをなくした・壊れた方がいるとき（運営の代表だけが行う）
--    ご本人であることを確かめたうえで、MFA_RESET.sql（同じフォルダ）を使います。
--    二段階認証を外し、すべての端末からログアウトさせ、mfa_resets に記録を残します。
--    やり直しの記録は、この SQL が作る mfa_resets 表に残ります（運営だけが読める）。
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

--  スマホをなくした方の設定をやり直した記録（誰の・いつ・なぜ・どう本人を確かめたか）。
--  書くのは MFA_RESET.sql（SQL Editor）だけ。運営は読めるが、画面からは書き換えも消去もできない
create table if not exists public.mfa_resets (
  id           bigint generated always as identity primary key,
  user_id      uuid,
  email        text not null,
  reason       text not null,           -- 紛失／故障／盗難 など
  verified_how text not null,           -- 本人の確かめかた（ビデオ通話で身分証、登録の電話へ折り返し など）
  factors_removed int not null default 0,
  sessions_removed int not null default 0,
  done_at      timestamptz not null default now()
);
alter table public.mfa_resets enable row level security;
revoke all on public.mfa_resets from anon, authenticated;
grant select on public.mfa_resets to authenticated;
drop policy if exists "mfa resets admin read" on public.mfa_resets;
create policy "mfa resets admin read" on public.mfa_resets
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
comment on table public.mfa_resets is '二段階認証をやり直した記録（スマホの紛失など）。MFA_RESET.sql からだけ書く';

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
--  守りの無い表 = 0、置き場 = 1、やり直しの記録 = 1 なら完了
select
  (select count(*)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
      and not exists (select 1 from pg_policies p
                       where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'mfa required')) as "守りの無い表",
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'mfa required') as "置き場",
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'mfa_resets')      as "やり直しの記録",
  (select count(*) from pg_policies where schemaname = 'public' and policyname = 'mfa required')                         as "守りを入れた表の数";
