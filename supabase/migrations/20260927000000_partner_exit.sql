-- =============================================================
-- パートナーが契約を終えるときの道筋
-- ---------------------------------------------------------------
--  これまでパートナーには「契約を終える」ための場所がなかった。
--  継ナビくんの「運営への問い合わせ」に書くしかなく、ほかの質問と
--  同じ受信箱に混ざるので、運営に件数も毎朝のメールも届かない。
--  引き継ぎは顧客一覧で1社ずつ担当を付け替え、止めておく状態もなかった。
--
--  ① 表 partner_exit_requests … パートナーからの「契約の終了のお申し出」
--       経営者の解約のご依頼（cancel_requests）と同じ作り。
--       受付中 → 対応済み。本人は取り下げられる。行は消さない。
--       希望の終了月（任意）と、理由・伝えたいこと（任意）を預かる。
--  ② profiles.partner_status … 'active'（通常）／'suspended'（停止中）
--       停止中のあいだも、ログイン・閲覧・報酬明細はそのまま。
--       新しい受け持ちにつながること（顧客の招待・顧問契約の送信）だけ止める。
--       本人は変えられない（運営だけ）。変えようとしても元の値に戻す。
--  ③ 関数 partner_handover(from, to) … 担当顧問先をまとめて引き継ぐ（代表のみ）
--       ・担当顧客（profiles.consultant_id）を引き継ぎ先へ
--       ・2名体制（partner_assignments）で、その方がメイン・サブの承認済みの体制は終える
--       ・登録待ちの招待（customer_invites）の担当を引き継ぎ先へ
--       ・同意待ちの顧問契約（contract_offers）の「担当になる人」を引き継ぎ先へ
--       担当の付け替えは、これまでどおり代表だけができる（profiles_freeze_privileged）。
--  ④ 停止中のパートナーを担当にする招待・顧問契約は作れず、登録済みの顧客を
--       自分の担当にする（claim_client）こともできないようにする
--
--  アカウントの削除は、これまでどおり Supabase の Authentication → Users から
--  行う（画面から消せるのは経営者だけ）。引き継ぎと最終月の報酬が済んでから。
--
--  確かめかた：表=1、権限（表）=4、受付中の二重止め=1、停止の列=1、
--              関数=3（partner_is_suspended・partner_handover・partner_status_guard）、
--              止めのトリガー=3
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。Edge Function の変更はありません
--           （毎朝のメールは agent-heartbeat を更新したときから届きます）。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 契約の終了のお申し出
-- ---------------------------------------------------------------
create table if not exists public.partner_exit_requests (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references auth.users(id) on delete cascade,
  --  希望の終了月（その月の末日で終える想定）。空なら運営と相談
  end_month    date,
  reason       text,
  note         text,
  status       text not null default 'open'
               check (status in ('open','done','withdrawn')),
  created_at   timestamptz not null default now(),
  handled_at   timestamptz,
  handled_by   uuid,
  admin_note   text
);

--  同じ人が受付中のお申し出を二つ持つことはない。取り下げ後は出し直せる
create unique index if not exists partner_exit_requests_open_uniq
  on public.partner_exit_requests (partner_id) where status = 'open';
create index if not exists partner_exit_requests_status_idx
  on public.partner_exit_requests (status, created_at desc);

alter table public.partner_exit_requests enable row level security;

grant select, insert, update on public.partner_exit_requests to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.partner_exit_requests to service_role';
  end if;
end $do$;

drop policy if exists "partner_exit own read"     on public.partner_exit_requests;
drop policy if exists "partner_exit own insert"   on public.partner_exit_requests;
drop policy if exists "partner_exit own withdraw" on public.partner_exit_requests;
drop policy if exists "partner_exit admin all"    on public.partner_exit_requests;

create policy "partner_exit own read" on public.partner_exit_requests
  for select to authenticated
  using (partner_id = auth.uid());
--  出せるのはパートナー本人だけ。受付中として出す
create policy "partner_exit own insert" on public.partner_exit_requests
  for insert to authenticated
  with check (partner_id = auth.uid() and status = 'open'
              and exists (select 1 from public.profiles p
                           where p.id = auth.uid() and p.role = 'consultant'));
--  本人ができるのは取り下げだけ（対応済みにはできない）
create policy "partner_exit own withdraw" on public.partner_exit_requests
  for update to authenticated
  using (partner_id = auth.uid() and status = 'open')
  with check (partner_id = auth.uid() and status = 'withdrawn');
create policy "partner_exit admin all" on public.partner_exit_requests
  for all to authenticated
  using (public.ep_is_admin())
  with check (public.ep_is_admin());

comment on table public.partner_exit_requests is
  'パートナーからの契約の終了のお申し出。引き継ぎ・最終月の報酬・アカウントの削除は運営が行う';


-- ---------------------------------------------------------------
-- ② 停止中（partner_status）
-- ---------------------------------------------------------------
alter table public.profiles add column if not exists partner_status text not null default 'active';
alter table public.profiles drop constraint if exists profiles_partner_status_check;
alter table public.profiles add constraint profiles_partner_status_check
  check (partner_status in ('active','suspended'));

--  本人は変えられない。運営（ep_is_admin）と SQL Editor・service_role だけ。
--  エラーにせず元の値に戻す（profiles_freeze_privileged と同じ考え方。
--  既存の画面の保存処理を壊さない）
create or replace function public.partner_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare ok boolean := false;
begin
  if auth.uid() is null then ok := true; end if;
  if not ok then
    begin ok := coalesce(public.ep_is_admin(), false);
    exception when others then ok := false; end;
  end if;
  if not ok then
    if tg_op = 'UPDATE' then new.partner_status := old.partner_status;
    else new.partner_status := 'active'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_partner_status_guard on public.profiles;
create trigger profiles_partner_status_guard
  before insert or update on public.profiles
  for each row execute function public.partner_status_guard();

--  「この人は停止中か」。権限の中からでも確実に答えられるよう security definer
create or replace function public.partner_is_suspended(p_uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select partner_status = 'suspended' from public.profiles where id = p_uid), false);
$$;
revoke all on function public.partner_is_suspended(uuid) from public;
grant execute on function public.partner_is_suspended(uuid) to authenticated;


-- ---------------------------------------------------------------
-- ④ 停止中のパートナーを担当にする招待・顧問契約は作らせない
-- ---------------------------------------------------------------
create or replace function public.partner_suspend_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'customer_invites' then
    if new.consultant_id is not null and public.partner_is_suspended(new.consultant_id) then
      raise exception 'partner_suspended: 停止中のパートナーを担当にする招待は作れません';
    end if;
  elsif tg_table_name = 'contract_offers' then
    if new.kind = 'customer' and (public.partner_is_suspended(new.offered_by)
        or (new.consultant_id is not null and public.partner_is_suspended(new.consultant_id))) then
      raise exception 'partner_suspended: 停止中のパートナーからは顧問契約を送れません';
    end if;
  end if;
  return new;
end;
$$;

do $do$ begin
  if to_regclass('public.customer_invites') is not null then
    execute 'drop trigger if exists customer_invites_suspend_block on public.customer_invites';
    execute 'create trigger customer_invites_suspend_block before insert on public.customer_invites
               for each row execute function public.partner_suspend_block()';
  end if;
  if to_regclass('public.contract_offers') is not null then
    execute 'drop trigger if exists contract_offers_suspend_block on public.contract_offers';
    execute 'create trigger contract_offers_suspend_block before insert on public.contract_offers
               for each row execute function public.partner_suspend_block()';
  end if;
end $do$;


--  登録済みの顧客を自分の担当にする claim_client にも、同じ止めを入れる。
--  中身は 20260903020000_claim_client_guard.sql のままで、①' の3行だけを足した
create or replace function public.claim_client(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me      uuid := auth.uid();
  me_role text;
  target  uuid;
  cur     uuid;
begin
  if me is null then
    return 'error: ログインが必要です';
  end if;

  --  ① 呼んだ人が、パートナーか運営であること（ここは元のままの考え方）
  select role into me_role from public.profiles where id = me;
  if me_role is null or me_role not in ('consultant','admin') then
    return 'error: 認定パートナーまたは運営のみご利用いただけます';
  end if;

  --  ①' 停止中のパートナーは、新しい顧客を担当にできない（2026-09-27 パートナーの契約の終了）
  if me_role = 'consultant' and public.partner_is_suspended(me) then
    return 'error: ただいま停止中のため、新しい顧客を担当にできません';
  end if;

  --  ② その顧客を探す。担当が誰かも一緒に取る
  select id, consultant_id into target, cur
    from public.profiles
   where lower(email) = lower(p_email)
     and role = 'customer';

  --  ③ 見つからない
  --     この文言は画面側が見ている。「見つかりません」が含まれるときだけ、
  --     パートナーの画面は招待（customer_invites）に切り替える。
  --     ここを書き換えるときは index.html の claimClient も一緒に直すこと。
  if target is null then
    return 'error: 該当する顧客アカウントが見つかりません（先に顧客としてご登録ください）';
  end if;

  --  ④ すでに自分が担当。何度押しても同じ結果になるように、成功として返す
  if cur = me then
    return 'ok';
  end if;

  --  ⑤ ここが今回の要。ほかの方が担当しているなら、パートナーには断る
  if cur is not null and me_role <> 'admin' then
    return 'error: この方は、すでにほかのパートナーが担当しています。担当の変更は運営までご連絡ください';
  end if;

  update public.profiles set consultant_id = me where id = target;
  return 'ok';
end;
$$;

revoke all on function public.claim_client(text) from public;
grant execute on function public.claim_client(text) to authenticated;

comment on function public.claim_client(text) is
  '登録済みの顧客を自分の担当にする。すでに担当がいる方は運営のみ付け替えられる。停止中のパートナーは使えない';


-- ---------------------------------------------------------------
-- ③ 担当顧問先をまとめて引き継ぐ（代表のみ）
-- ---------------------------------------------------------------
create or replace function public.partner_handover(p_from uuid, p_to uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  n_cust int := 0; n_team int := 0; n_inv int := 0; n_offer int := 0;
  to_role text;
begin
  if auth.uid() is null or not coalesce(public.is_owner(), false) then
    return json_build_object('ok', false, 'error', '担当の付け替えは代表だけができます');
  end if;
  if p_from is null or p_to is null or p_from = p_to then
    return json_build_object('ok', false, 'error', '引き継ぎ元と引き継ぎ先を選んでください');
  end if;
  select role into to_role from public.profiles where id = p_to;
  if to_role is null or to_role not in ('consultant','admin') then
    return json_build_object('ok', false, 'error', '引き継ぎ先はパートナーか運営を選んでください');
  end if;
  if public.partner_is_suspended(p_to) then
    return json_build_object('ok', false, 'error', '引き継ぎ先が停止中です');
  end if;

  --  代表なので profiles_freeze_privileged はそのまま通す（担当の付け替えは代表だけ）
  update public.profiles set consultant_id = p_to
   where consultant_id = p_from and role = 'customer';
  get diagnostics n_cust = row_count;

  if to_regclass('public.partner_assignments') is not null then
    execute $q$update public.partner_assignments
                 set status = 'ended', decided_at = now()
               where status in ('approved','pending') and (main_id = $1 or sub_id = $1)$q$
      using p_from;
    get diagnostics n_team = row_count;
  end if;
  if to_regclass('public.customer_invites') is not null then
    update public.customer_invites set consultant_id = p_to
     where consultant_id = p_from and status = 'pending';
    get diagnostics n_inv = row_count;
  end if;
  if to_regclass('public.contract_offers') is not null then
    update public.contract_offers set consultant_id = p_to
     where kind = 'customer' and status = 'sent' and consultant_id = p_from;
    get diagnostics n_offer = row_count;
  end if;

  return json_build_object('ok', true, 'customers', n_cust, 'teams_ended', n_team,
                           'invites', n_inv, 'offers', n_offer);
end;
$$;
revoke all on function public.partner_handover(uuid, uuid) from public;
grant execute on function public.partner_handover(uuid, uuid) to authenticated;

comment on function public.partner_handover(uuid, uuid) is
  '担当顧問先・2名体制・登録待ちの招待・同意待ちの顧問契約を、まとめて引き継ぐ（代表のみ）';


-- ---------------------------------------------------------------
-- 確かめかた
-- ---------------------------------------------------------------
-- select
--   (select count(*) from pg_tables where schemaname='public' and tablename='partner_exit_requests') as "表=1",
--   (select count(*) from pg_policies where tablename='partner_exit_requests')                       as "権限（表）=4",
--   (select count(*) from pg_indexes where indexname='partner_exit_requests_open_uniq')              as "受付中の二重止め=1",
--   (select count(*) from information_schema.columns where table_name='profiles' and column_name='partner_status') as "停止の列=1",
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname in ('partner_is_suspended','partner_handover','partner_status_guard')) as "関数=3",
--   (select count(*) from pg_trigger where tgname in
--     ('profiles_partner_status_guard','customer_invites_suspend_block','contract_offers_suspend_block')) as "止めのトリガー=3";
