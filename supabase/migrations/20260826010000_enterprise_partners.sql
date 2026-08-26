-- =============================================================
-- 法人向けエンタープライズ・パートナー（EP）
-- ---------------------------------------------------------------
--  これまでのパートナーは「個人」が前提だった。法人と組むには、
--  次の2つのかたちがある。
--
--   A型：所属型（本部＋所属個人）
--        本部とマスター契約を結び、所属する個人が認定パートナーとして
--        登録される二層構造。委託料率は個人のLv基準から▲5ptで、その
--        5ptが本部オーバーライドとして本部へ入る。プラットフォーム
--        利用料は本部が一括負担（席数無制限・定額）、入会金はゼロ。
--        ティア判定は個人単位だが、法人合算実績で本部側の料率が上がる。
--        顧客は継に帰属し、担当者が退職したときは本部が後任を指名する。
--          A-1 … 継が運営（アカウント発行・初期導入・一次サポート・請求）
--          A-2 … 本部が自社分を運営し、そのぶん本部が5〜7pt厚く取る。
--                 ただし認定試験の合格判定だけは継に残す（品質管理のため）
--
--   B型：顧客基盤型（税理士法人・社労士法人等）＝エンタープライズ
--        士業法人が自社サービスとして顧問先に提供し、継へ卸値を払う
--        ホワイトラベル型。継は顧問先と契約しない。顧客は士業法人に
--        帰属し、解約時は継への直接移管条項を置く。
--        委託料率やティア昇格は無く、レンジ課金に一本化する。
--
--  この表が要るのは、いまのテナント分離が「単層」だからである。
--  パートナー1人が顧客を持つ形しか無く、法人の管理者が担当者へ席を
--  配る構造が作れない。そこで
--    親テナント（EP法人）─ 子テナント（顧問先）
--    担当者は「親テナント所属 ＋ 割当済みの子テナントのみ」
--  という二段判定にし、席の付与・剥奪を記録に残す。
--
--  ※ この移行では既存の表の権限には一切手を入れない。顧問先のデータを
--    担当者が見るための道は、いまも使われている
--    profiles.consultant_id ／ partner_assignments を通す。
--    席を配ると、そのしくみの上に割り当てが作られる。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になる。
-- =============================================================


-- ---------------------------------------------------------------
-- 1. EP法人（親テナント）
-- ---------------------------------------------------------------
create table if not exists public.ep_orgs (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  --  A1＝本部型（継が運営）／A2＝本部型（本部が自社分を運営）／B＝顧客基盤型
  kind           text not null default 'B' check (kind in ('A1','A2','B')),
  status         text not null default 'active' check (status in ('active','suspended','ended')),
  contact_name   text,
  contact_email  text,
  invoice_reg_no text,
  started_on     date,
  ended_on       date,
  --  B型：最低導入3社ぶんの初期導入研修費（一括30万円）を継が受領したか
  setup_fee_yen  integer not null default 300000,
  setup_paid_on  date,
  --  A-2で本部が上乗せして取る率（5〜7pt）。A-1とB型では使わない
  override_bonus_pt numeric(4,1) not null default 0,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists ep_orgs_status_idx on public.ep_orgs (status, kind);


-- ---------------------------------------------------------------
-- 2. 席（EP法人に属する担当者）
-- ---------------------------------------------------------------
--  seat_role='manager' が法人の管理者。席を配れるのはこの人だけ。
--  certified_at は認定研修の修了日。4社目以降をEPが独自に値付けする
--  には修了者が1名以上在籍している必要があるため、ここで持つ。
--  自己申告にせず運営が入れる（認定は運営が出すものなので）。
create table if not exists public.ep_members (
  id          uuid primary key default gen_random_uuid(),
  ep_id       uuid not null references public.ep_orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  seat_role   text not null default 'staff' check (seat_role in ('manager','staff')),
  status      text not null default 'active' check (status in ('active','revoked')),
  certified_at date,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references auth.users(id),
  revoked_at  timestamptz,
  revoked_by  uuid references auth.users(id),
  note        text
);

--  同じ人を同じ法人に二重に置かない
create unique index if not exists ep_members_uniq
  on public.ep_members (ep_id, user_id);
create index if not exists ep_members_user_idx
  on public.ep_members (user_id, status);


-- ---------------------------------------------------------------
-- 3. 顧問先（子テナント）
-- ---------------------------------------------------------------
--  ep_price … EPが顧問先へ請求している月額（B型。継は関与しない記録用）
--  setup_yen … 4社目以降の初期導入費。EPが独自に値付けするが上限10万円。
--              下限や固定額は定めない（再販価格の拘束にあたるため）。
create table if not exists public.ep_clients (
  id          uuid primary key default gen_random_uuid(),
  ep_id       uuid not null references public.ep_orgs(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'active' check (status in ('active','ended')),
  started_on  date not null default ((now() at time zone 'Asia/Tokyo')::date),
  ended_on    date,
  ep_price    integer,
  setup_yen   integer check (setup_yen is null or (setup_yen >= 0 and setup_yen <= 100000)),
  note        text,
  created_at  timestamptz not null default now()
);

create unique index if not exists ep_clients_uniq
  on public.ep_clients (ep_id, customer_id);
create index if not exists ep_clients_ep_idx
  on public.ep_clients (ep_id, status);


-- ---------------------------------------------------------------
-- 4. 席の割当（担当者 → 顧問先）
-- ---------------------------------------------------------------
--  revoked_at が null のものだけが「いま見られる」。剥奪しても行は消さず、
--  担当者交代の監査証跡として残す。
create table if not exists public.ep_grants (
  id          uuid primary key default gen_random_uuid(),
  ep_id       uuid not null references public.ep_orgs(id) on delete cascade,
  member_id   uuid not null references public.ep_members(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references auth.users(id),
  revoked_at  timestamptz,
  revoked_by  uuid references auth.users(id)
);

--  生きている割当は1組につき1本だけ
create unique index if not exists ep_grants_live_uniq
  on public.ep_grants (member_id, customer_id) where revoked_at is null;
create index if not exists ep_grants_ep_idx
  on public.ep_grants (ep_id, revoked_at);


-- ---------------------------------------------------------------
-- 5. 監査ログ
-- ---------------------------------------------------------------
create table if not exists public.ep_audit (
  id       bigserial primary key,
  ep_id    uuid not null references public.ep_orgs(id) on delete cascade,
  action   text not null,
  detail   jsonb not null default '{}'::jsonb,
  actor    uuid references auth.users(id),
  at       timestamptz not null default now()
);

create index if not exists ep_audit_ep_idx on public.ep_audit (ep_id, at desc);


-- ---------------------------------------------------------------
-- 6. 判定のための関数
-- ---------------------------------------------------------------
--  ep_members の権限の中から ep_members を見ると再帰する。
--  security definer で切り離す。
create or replace function public.ep_is_member(p_ep uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.ep_members m
     where m.ep_id = p_ep and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function public.ep_is_manager(p_ep uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.ep_members m
     where m.ep_id = p_ep and m.user_id = auth.uid()
       and m.status = 'active' and m.seat_role = 'manager'
  );
$$;

create or replace function public.ep_is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  );
$$;

revoke all on function public.ep_is_member(uuid)  from public;
revoke all on function public.ep_is_manager(uuid) from public;
revoke all on function public.ep_is_admin()       from public;
grant execute on function public.ep_is_member(uuid)  to authenticated;
grant execute on function public.ep_is_manager(uuid) to authenticated;
grant execute on function public.ep_is_admin()       to authenticated;


-- ---------------------------------------------------------------
-- 7. 権限（RLS）
-- ---------------------------------------------------------------
alter table public.ep_orgs    enable row level security;
alter table public.ep_members enable row level security;
alter table public.ep_clients enable row level security;
alter table public.ep_grants  enable row level security;
alter table public.ep_audit   enable row level security;

-- ---- 法人 ----
--  作れる・区分を変えられるのは運営だけ。所属者は自分の法人を読むだけ。
drop policy if exists "ep_orgs admin" on public.ep_orgs;
create policy "ep_orgs admin" on public.ep_orgs
  for all to authenticated
  using (public.ep_is_admin()) with check (public.ep_is_admin());

drop policy if exists "ep_orgs member read" on public.ep_orgs;
create policy "ep_orgs member read" on public.ep_orgs
  for select to authenticated
  using (public.ep_is_member(id));

-- ---- 席 ----
drop policy if exists "ep_members admin" on public.ep_members;
create policy "ep_members admin" on public.ep_members
  for all to authenticated
  using (public.ep_is_admin()) with check (public.ep_is_admin());

--  管理者は自分の法人の席を配れる・外せる
drop policy if exists "ep_members manager" on public.ep_members;
create policy "ep_members manager" on public.ep_members
  for all to authenticated
  using (public.ep_is_manager(ep_id)) with check (public.ep_is_manager(ep_id));

--  担当者は同じ法人の席を読むだけ（誰が担当かは見えてよい）
drop policy if exists "ep_members read" on public.ep_members;
create policy "ep_members read" on public.ep_members
  for select to authenticated
  using (public.ep_is_member(ep_id));

-- ---- 顧問先 ----
drop policy if exists "ep_clients admin" on public.ep_clients;
create policy "ep_clients admin" on public.ep_clients
  for all to authenticated
  using (public.ep_is_admin()) with check (public.ep_is_admin());

drop policy if exists "ep_clients manager" on public.ep_clients;
create policy "ep_clients manager" on public.ep_clients
  for all to authenticated
  using (public.ep_is_manager(ep_id)) with check (public.ep_is_manager(ep_id));

--  担当者は、自分に割り当てられた顧問先だけ読める（二段判定）
drop policy if exists "ep_clients granted read" on public.ep_clients;
create policy "ep_clients granted read" on public.ep_clients
  for select to authenticated
  using (
    public.ep_is_member(ep_id)
    and exists (
      select 1 from public.ep_grants g
        join public.ep_members m on m.id = g.member_id
       where g.ep_id = ep_clients.ep_id
         and g.customer_id = ep_clients.customer_id
         and g.revoked_at is null
         and m.user_id = auth.uid() and m.status = 'active'
    )
  );

-- ---- 割当 ----
drop policy if exists "ep_grants admin" on public.ep_grants;
create policy "ep_grants admin" on public.ep_grants
  for all to authenticated
  using (public.ep_is_admin()) with check (public.ep_is_admin());

drop policy if exists "ep_grants manager" on public.ep_grants;
create policy "ep_grants manager" on public.ep_grants
  for all to authenticated
  using (public.ep_is_manager(ep_id)) with check (public.ep_is_manager(ep_id));

--  担当者は自分の割当だけ。同僚が誰を持っているかまでは見せない
drop policy if exists "ep_grants read" on public.ep_grants;
create policy "ep_grants read" on public.ep_grants
  for select to authenticated
  using (
    public.ep_is_member(ep_id)
    and exists (select 1 from public.ep_members m
                 where m.id = ep_grants.member_id and m.user_id = auth.uid())
  );

-- ---- 監査ログ ----
--  書き換えも消去もさせない。入るのは下のトリガーからだけ。
drop policy if exists "ep_audit read" on public.ep_audit;
create policy "ep_audit read" on public.ep_audit
  for select to authenticated
  using (public.ep_is_admin() or public.ep_is_manager(ep_id));


-- ---------------------------------------------------------------
-- 8. 席の付与・剥奪を自動で記録する
-- ---------------------------------------------------------------
--  人が書くのではなく、割当そのものの変化から残す。書き忘れが起きない。
create or replace function public.ep_grants_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.ep_audit (ep_id, action, detail, actor)
    values (new.ep_id, 'grant',
            jsonb_build_object('member_id', new.member_id, 'customer_id', new.customer_id),
            auth.uid());
  elsif TG_OP = 'UPDATE'
        and old.revoked_at is null and new.revoked_at is not null then
    insert into public.ep_audit (ep_id, action, detail, actor)
    values (new.ep_id, 'revoke',
            jsonb_build_object('member_id', new.member_id, 'customer_id', new.customer_id),
            auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists ep_grants_audit_tg on public.ep_grants;
create trigger ep_grants_audit_tg
  after insert or update on public.ep_grants
  for each row execute function public.ep_grants_audit();


-- ---------------------------------------------------------------
-- 9. メールから人を探して追加する
-- ---------------------------------------------------------------
--  管理者に profiles を検索させたくない（他社の人まで引けてしまう）。
--  メールを1件だけ引き当てる窓口をここに置き、権限は関数の中で見る。
create or replace function public.ep_add_client(p_ep uuid, p_email text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
begin
  if not (public.ep_is_manager(p_ep) or public.ep_is_admin()) then
    return json_build_object('ok', false, 'error', 'この法人の管理者だけが追加できます');
  end if;

  select p.id, coalesce(p.company_name, p.email)
    into v_id, v_name
    from public.profiles p
   where lower(p.email) = lower(btrim(p_email)) and p.role = 'customer'
   limit 1;

  if v_id is null then
    return json_build_object('ok', false, 'error', 'そのメールの顧客が見つかりません。先に顧客登録をお願いします');
  end if;

  if exists (select 1 from public.ep_clients c
              where c.ep_id = p_ep and c.customer_id = v_id and c.status = 'active') then
    return json_build_object('ok', false, 'error', 'すでに顧問先に入っています');
  end if;

  insert into public.ep_clients (ep_id, customer_id)
  values (p_ep, v_id)
  on conflict (ep_id, customer_id)
  do update set status = 'active', ended_on = null;

  insert into public.ep_audit (ep_id, action, detail, actor)
  values (p_ep, 'client_add', jsonb_build_object('customer_id', v_id), auth.uid());

  return json_build_object('ok', true, 'customer_id', v_id, 'name', v_name);
end;
$$;

create or replace function public.ep_add_member(p_ep uuid, p_email text, p_role text default 'staff')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
begin
  if not (public.ep_is_manager(p_ep) or public.ep_is_admin()) then
    return json_build_object('ok', false, 'error', 'この法人の管理者だけが追加できます');
  end if;
  if p_role not in ('manager','staff') then
    return json_build_object('ok', false, 'error', '役割の指定が正しくありません');
  end if;
  --  管理者を増やせるのは運営だけ。管理者どうしで勝手に増やすと、
  --  誰が席を配ったのかが辿れなくなる。
  if p_role = 'manager' and not public.ep_is_admin() then
    return json_build_object('ok', false, 'error', '管理者の追加は運営にご依頼ください');
  end if;

  select p.id, coalesce(p.full_name, p.company_name, p.email)
    into v_id, v_name
    from public.profiles p
   where lower(p.email) = lower(btrim(p_email)) and p.role = 'consultant'
   limit 1;

  if v_id is null then
    return json_build_object('ok', false, 'error', 'そのメールの認定パートナーが見つかりません');
  end if;

  insert into public.ep_members (ep_id, user_id, seat_role, granted_by)
  values (p_ep, v_id, p_role, auth.uid())
  on conflict (ep_id, user_id)
  do update set status = 'active', revoked_at = null, revoked_by = null;

  insert into public.ep_audit (ep_id, action, detail, actor)
  values (p_ep, 'member_add', jsonb_build_object('user_id', v_id, 'seat_role', p_role), auth.uid());

  return json_build_object('ok', true, 'user_id', v_id, 'name', v_name);
end;
$$;

revoke all on function public.ep_add_client(uuid, text)       from public;
revoke all on function public.ep_add_member(uuid, text, text) from public;
grant execute on function public.ep_add_client(uuid, text)       to authenticated;
grant execute on function public.ep_add_member(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------
-- 10. 名前を引くための読み取り窓口
-- ---------------------------------------------------------------
--  一覧に「メールだけ」が並ぶと誰のことか分からない。かといって
--  profiles を広く読ませたくないので、自分の法人に居る人だけを返す。
--  担当者には、同じ法人の席と「自分に割り当てられた顧問先」だけ。
--  持っていない顧問先の名前まで見えると、二段判定の意味が無くなる。
create or replace function public.ep_people(p_ep uuid)
returns table (id uuid, email text, name text, role text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.email,
         coalesce(nullif(btrim(p.company_name), ''), nullif(btrim(p.full_name), ''), p.email),
         p.role
    from public.profiles p
   where (public.ep_is_member(p_ep) or public.ep_is_admin())
     and (
       p.id in (select m.user_id from public.ep_members m where m.ep_id = p_ep)
       or (
         (public.ep_is_manager(p_ep) or public.ep_is_admin())
         and p.id in (select c.customer_id from public.ep_clients c where c.ep_id = p_ep)
       )
       or p.id in (
         select g.customer_id from public.ep_grants g
           join public.ep_members m2 on m2.id = g.member_id
          where g.ep_id = p_ep and g.revoked_at is null
            and m2.user_id = auth.uid() and m2.status = 'active'
       )
     );
$$;

revoke all on function public.ep_people(uuid) from public;
grant execute on function public.ep_people(uuid) to authenticated;


-- =============================================================
-- 確認（Run したあとに、この select だけを実行してください）
-- =============================================================
-- select
--   (select count(*) from information_schema.tables
--     where table_schema='public'
--       and table_name in ('ep_orgs','ep_members','ep_clients','ep_grants','ep_audit')) as 表,
--   (select count(*) from pg_policies
--     where schemaname='public'
--       and tablename in ('ep_orgs','ep_members','ep_clients','ep_grants','ep_audit')) as 権限の本数,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname='public'
--       and p.proname in ('ep_is_member','ep_is_manager','ep_is_admin',
--                         'ep_add_client','ep_add_member','ep_people','ep_grants_audit')) as 関数;
--   -- 表=5、権限の本数=12、関数=7 なら成功です。
