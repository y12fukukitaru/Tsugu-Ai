-- =============================================================
-- 解約のご依頼：経営者が自分から申し出られるようにする
-- ---------------------------------------------------------------
--  いまは「ログアウト」しかない。やめたい経営者には、担当パートナーに
--  切り出すか、運営を探して連絡する以外の道がない。言い出しにくい話ほど、
--  押せる場所が要る。
--
--  ただし、押した瞬間に消えてよいものではない。顧問契約と課金があり、
--  引き継ぐ資料もある。だからこの表は「ご依頼」を預かるところで、
--  実際の解約とアカウントの削除は運営が行う。
--
--  再登録は新規扱いになる。運営が auth.users から消せば、profiles も
--  紐づくデータも外部キーで一緒に消える。同じメールアドレスで登録し直すと
--  別の利用者として作られるので、前の記録は引き継がれない。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           一度だけ。二度流しても壊れない（if not exists / drop policy）。
-- =============================================================

create table if not exists public.cancel_requests (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references auth.users(id) on delete cascade,
  --  差し支えなければ、という前提で伺う。空でも受け付ける
  reason       text,
  note         text,
  --  受付 → 対応済み。取り下げもできる
  status       text not null default 'open'
               check (status in ('open','done','withdrawn')),
  created_at   timestamptz not null default now(),
  handled_at   timestamptz,
  handled_by   uuid,
  admin_note   text
);

--  同じ人が受付中の依頼を二つ持つことはない。取り下げ後は出し直せる
create unique index if not exists cancel_requests_open_uniq
  on public.cancel_requests (customer_id) where status = 'open';

create index if not exists cancel_requests_status_idx
  on public.cancel_requests (status, created_at desc);

alter table public.cancel_requests enable row level security;

-- ---- 権限（grant）----
--  Supabase では既定で authenticated / service_role に権限が付くよう
--  設定されているが、それに頼ると、その設定が変わった日に黙って動かなくなる。
--  この SQL だけで完結するよう、必要なぶんを明示しておく。
--  実際に何が見えるかは、この下の RLS が決める。
grant select, insert, update on public.cancel_requests to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.cancel_requests to service_role';
  end if;
end $do$;


-- ---- 経営者本人：自分の依頼を出す・見る・取り下げる ----
--  取り下げは status を withdrawn にする更新で行う。行は消さない。
--  「いつ申し出て、いつ取り下げたか」は、あとから双方が確かめられるほうがよい。
drop policy if exists "cancel_requests own" on public.cancel_requests;
create policy "cancel_requests own" on public.cancel_requests
  for all to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

-- ---- 運営：全部見えて、対応済みにできる ----
drop policy if exists "cancel_requests admin read" on public.cancel_requests;
create policy "cancel_requests admin read" on public.cancel_requests
  for select to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "cancel_requests admin update" on public.cancel_requests;
create policy "cancel_requests admin update" on public.cancel_requests
  for update to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p
                       where p.id = auth.uid() and p.role = 'admin'));

-- ---- 「この顧客は自分の担当か」を、profiles の権限に頼らずに答える ----
--  権限の中から素直に profiles を読むと、その profiles 自身の権限に縛られる。
--  パートナーが顧客の行を読めるかどうかは profiles 側の設定しだいで、
--  そこが変わるとこの権限も黙って効かなくなる。だから判定を関数に閉じ、
--  security definer で確実に答えられるようにする。
--
--  名前について：
--    本番にはすでに is_my_client(cust uuid) がある。同じ名前で引数名だけを
--    変えることは PostgreSQL が許さない（cannot change name of input parameter）。
--    かといって引数名を合わせて中身を上書きすると、その関数を使っている
--    別の権限の挙動まで黙って変わりかねない。中身を見ていない関数を
--    書き換えるのは避ける。だからこの用途専用の名前にして、既存のものには
--    一切触れない。
create or replace function public.cancel_partner_can_see(p_customer uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = p_customer and consultant_id = auth.uid()
  );
$$;

revoke all on function public.cancel_partner_can_see(uuid) from public;
grant execute on function public.cancel_partner_can_see(uuid) to authenticated;

comment on function public.cancel_partner_can_see(uuid) is
  '呼び出した人が、その顧客の担当パートナーかどうか。解約のご依頼の権限から使う';

-- ---- 担当パートナー：自分の顧客のぶんだけ見える ----
--  知らないうちに担当顧客が抜けている、という事態を防ぐため。
--  読むだけ。対応は運営が行う。
drop policy if exists "cancel_requests partner read" on public.cancel_requests;
create policy "cancel_requests partner read" on public.cancel_requests
  for select to authenticated
  using (public.cancel_partner_can_see(customer_id));

comment on table public.cancel_requests is
  '経営者からの解約のご依頼。実際の解約とアカウント削除は運営が行う';


-- ---------------------------------------------------------------
-- 確認（Run のあとに、これだけ見れば十分）
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='cancel_requests')          as 表,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='cancel_requests')             as 権限の本数,
  (select count(*) from pg_indexes
    where schemaname='public' and indexname='cancel_requests_open_uniq')   as 二重依頼止め,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='cancel_partner_can_see')       as 担当判定;
--  期待値：表=1、権限の本数=4、二重依頼止め=1、担当判定=1


-- =============================================================
-- 運営がアカウントを削除するときの手順（覚え書き）
-- ---------------------------------------------------------------
--  ① この画面（運営 → サポート管理）で、ご依頼の中身と担当パートナーを確かめる
--  ② 顧問契約の締め（最終月の請求・成果物のお渡し）を済ませる
--  ③ 同じ画面の「アカウントを削除する…」を押し、その方の会社名を打ち込んで
--     「削除する」。profiles・試算表・相談・手元資金など、紐づくものは
--     外部キーで一緒に消える
--  ④ ご依頼は自動で「対応済み」になる
--
--  ③のあと、同じメールアドレスで登録し直すと「新しい利用者」として作られる。
--  前の記録は戻らない。だから③の前に、必要な資料はお渡ししておくこと。
--
--  残っていた招待（customer_invites）は、③のときに自動で片づけられる。
--  片づけないと、登録し直したときに以前の担当が再び付いてしまうため。
--
--  ※ Edge Function（admin-delete-user）をまだデプロイしていない場合は、
--    これまでどおり Dashboard → Authentication → Users → Delete user でも
--    消せる。その場合は招待が残るので、下を流して片づけること。
--      update public.customer_invites set status='cancelled'
--       where lower(email) = lower('その方のメールアドレス') and status='pending';
-- =============================================================
