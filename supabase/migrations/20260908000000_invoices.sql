-- =============================================================
-- 請求の台帳と、未収の可視化
-- ---------------------------------------------------------------
--  いまの仕組みは revenue_entries（入ってきたお金）しか記録していません。
--  つまり、
--
--      入ってこなかったお金が、どこにも表示されない
--
--  という状態でした。請求したかどうかを持っていないので、未収が
--  発生しても誰も気づけません。口座振替の代行会社を入れても、
--  振替不能の結果を受け取る場所がありません。
--
--  ここで「今月この顧客にいくら請求した」を先に立てます。
--  立ててあれば、入金と突き合わせて**足りないぶんが残ります**。
--  残ったものが未収です。見えれば、追える。
--
--  ■ 金額の決め方は、いまの画面と同じにする
--    顧問料は app_settings の bl-adv（税抜）から。運営が直接担当する
--    顧客は bl-direct の一律。ここを別の式で書くと、請求書と
--    運営画面の数字が食い違います。設定値をそのまま読みます。
--
--  ■ 二重請求は構造で止める
--    (顧客, 年月, 区分) に一意制約を張ります。何度「請求を立てる」を
--    押しても、同じ月のものは増えません。押し間違いは必ず起きるので、
--    注意書きではなく制約で止めます。
--
--  ■ 消さずに「取消」で残す
--    立ててしまった請求を delete すると、なぜ消えたか分からなくなります。
--    status='void' にして、理由を残します。お金の記録は消さない。
--
--  確かめかた：請求の表=1、権限の本数=4、関数=7、二重請求止め=1
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           一度だけ。二度流しても壊れない。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 請求の台帳
-- ---------------------------------------------------------------
create table if not exists public.invoices (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references auth.users(id) on delete cascade,
  --  'YYYY-MM'。どの月ぶんの請求か
  period       text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  --  advisory＝顧問料／direct＝運営直接担当／setup＝初期導入費／other
  kind         text not null default 'advisory'
               check (kind in ('advisory','direct','setup','other')),
  title        text not null,

  amount_ex    integer not null check (amount_ex >= 0),   -- 税抜
  tax          integer not null default 0 check (tax >= 0),
  amount       integer not null check (amount >= 0),      -- 税込＝請求額

  due_on       date not null,
  --  open＝未入金／paid＝入金済み／partial＝一部入金／void＝取消
  status       text not null default 'open'
               check (status in ('open','paid','partial','void')),
  paid_amount  integer not null default 0 check (paid_amount >= 0),
  paid_on      date,
  --  transfer＝口座振替／card＝カード／bank＝振込／other
  method       text,
  note         text,
  void_reason  text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

--  同じ月・同じ区分の請求は一本だけ。押し間違いを構造で止める
create unique index if not exists invoices_uniq
  on public.invoices (customer_id, period, kind);
create index if not exists invoices_open_idx
  on public.invoices (status, due_on) where status in ('open','partial');

alter table public.invoices enable row level security;

grant select on public.invoices to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.invoices to service_role';
  end if;
end $do$;

-- ---------------------------------------------------------------
-- ② 誰が見てよいか
-- ---------------------------------------------------------------
--  書き込みは関数（SECURITY DEFINER）からだけ。表に直接は触らせない。
--  金額を画面から書き換えられると、台帳の意味が無くなる
drop policy if exists "invoice admin read"    on public.invoices;
drop policy if exists "invoice own read"      on public.invoices;
drop policy if exists "invoice member read"   on public.invoices;
drop policy if exists "invoice partner read"  on public.invoices;

create policy "invoice admin read" on public.invoices
  for select to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin'));

--  ご本人（経営者）。未入金があることは、まずご本人が知るべき
create policy "invoice own read" on public.invoices
  for select to authenticated
  using (customer_id = auth.uid());

create policy "invoice member read" on public.invoices
  for select to authenticated
  using (exists (select 1 from public.company_members m
                  where m.customer_id = invoices.customer_id
                    and m.member_id = auth.uid() and m.status = 'active'));

--  担当パートナー。未収を追えるのは、いちばん近くにいる人
create policy "invoice partner read" on public.invoices
  for select to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.id = invoices.customer_id and p.consultant_id = auth.uid())
    or exists (select 1 from public.partner_assignments a
                where a.customer_id = invoices.customer_id
                  and a.status = 'approved'
                  and (a.main_id = auth.uid() or a.sub_id = auth.uid()))
  );

create or replace function public.invoice_is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin');
$$;
revoke all on function public.invoice_is_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------
-- ③ その月の請求を立てる
-- ---------------------------------------------------------------
--  対象は、その月の末日までに登録された顧客。翌月に入った方に
--  さかのぼって請求すると、身に覚えのない請求書が届くことになる。
--  すでに解約（削除）された方も外す。
create or replace function public.invoice_generate(p_period text, p_due_day int default 27)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rates  jsonb;
  v_adv    integer;
  v_direct integer;
  v_start  date;
  v_end    date;
  v_due    date;
  v_made   int := 0;
  v_skip   int := 0;
  r        record;
  v_ex     integer;
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;
  if coalesce(p_period,'') !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', '年月は YYYY-MM の形でご指定ください');
  end if;

  v_start := (p_period || '-01')::date;
  v_end   := (v_start + interval '1 month')::date;
  --  支払期日。月末を超える日を指定されたら月末に丸める
  v_due   := least((v_start + interval '1 month' - interval '1 day')::date,
                   (v_start + make_interval(days => greatest(p_due_day,1) - 1))::date);

  select coalesce((select value from public.app_settings where key='billing_rates'), '{}'::jsonb)
    into v_rates;
  --  金額は運営画面の設定をそのまま使う。別の式で書くと請求書と
  --  画面の数字が食い違う
  v_adv    := coalesce(nullif(btrim(v_rates->>'bl-adv'),    '')::numeric, 45000)::integer;
  v_direct := coalesce(nullif(btrim(v_rates->>'bl-direct'), '')::numeric, 30000)::integer;

  for r in
    select p.id,
           coalesce(p.company_name, p.contact_name, p.email, '') as nm,
           (a.id is not null) as is_direct
      from public.profiles p
      left join public.profiles a
        on a.id = p.consultant_id and a.role = 'admin'
     where p.role = 'customer'
       --  その月のうちに登録された方まで。翌月以降の登録は対象外
       and p.created_at < v_end
       --  すでに削除された方は請求しない
       and not exists (select 1 from public.account_deletions d
                        where d.deleted_user_id = p.id)
  loop
    v_ex := case when r.is_direct then v_direct else v_adv end;
    begin
      insert into public.invoices
        (customer_id, period, kind, title, amount_ex, tax, amount, due_on)
      values
        (r.id, p_period,
         case when r.is_direct then 'direct' else 'advisory' end,
         case when r.is_direct then p_period || ' 顧問料（運営直接担当）'
              else p_period || ' 顧問料' end,
         v_ex, v_ex * 10 / 100, v_ex + v_ex * 10 / 100, v_due);
      v_made := v_made + 1;
    exception when unique_violation then
      --  もう立ててある。二度目は何もしない（押し間違いで増やさない）
      v_skip := v_skip + 1;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'made', v_made, 'skipped', v_skip,
                            'due_on', v_due, 'period', p_period);
end $$;

-- ---------------------------------------------------------------
-- ④ 入金と突き合わせる
-- ---------------------------------------------------------------
--  revenue_entries（入ってきたお金）と、その月の請求を照らす。
--  同じ顧客・同じ額がその月にあれば入金済みにする。額が足りなければ
--  一部入金として残す。**勝手に消さず、残ったものが未収になる。**
create or replace function public.invoice_reconcile(p_period text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date;
  v_paid int := 0; v_part int := 0;
  r record; v_sum integer; v_on date;
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;
  if coalesce(p_period,'') !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', '年月は YYYY-MM の形でご指定ください');
  end if;
  v_start := (p_period || '-01')::date;
  --  入金は翌月にずれ込むことがある。ひと月ぶん余裕を見る
  v_end   := (v_start + interval '2 month')::date;

  for r in
    select * from public.invoices
     where period = p_period and status in ('open','partial')
  loop
    select coalesce(sum(e.amount),0), max(e.occurred_on)
      into v_sum, v_on
      from public.revenue_entries e
     where e.customer_id = r.customer_id
       and e.occurred_on >= v_start and e.occurred_on < v_end
       and coalesce(e.category,'') in ('advisory','other')
       and e.amount > 0;

    if v_sum <= 0 then
      continue;                          -- 入金なし。未収のまま残す
    elsif v_sum >= r.amount then
      update public.invoices
         set status='paid', paid_amount=r.amount, paid_on=v_on, updated_at=now()
       where id = r.id;
      v_paid := v_paid + 1;
    else
      update public.invoices
         set status='partial', paid_amount=v_sum, paid_on=v_on, updated_at=now()
       where id = r.id;
      v_part := v_part + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'paid', v_paid, 'partial', v_part);
end $$;

-- ---------------------------------------------------------------
-- ⑤ 手で直す（入金済みにする／取り消す）
-- ---------------------------------------------------------------
create or replace function public.invoice_mark_paid(
  p_id uuid, p_amount integer default null,
  p_on date default null, p_method text default 'transfer')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_inv record; v_amt integer;
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;
  select * into v_inv from public.invoices where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', '見つかりません'); end if;
  if v_inv.status = 'void' then
    return jsonb_build_object('ok', false, 'error', '取り消した請求は入金済みにできません');
  end if;

  v_amt := coalesce(p_amount, v_inv.amount);
  if v_amt < 0 then return jsonb_build_object('ok', false, 'error', '金額が正しくありません'); end if;

  update public.invoices
     set paid_amount = v_amt,
         paid_on     = coalesce(p_on, (now() at time zone 'Asia/Tokyo')::date),
         method      = coalesce(p_method, method),
         status      = case when v_amt >= v_inv.amount then 'paid'
                            when v_amt > 0 then 'partial' else 'open' end,
         updated_at  = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

--  消さずに残す。なぜ請求しないことにしたのかが、あとから読める
create or replace function public.invoice_void(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;
  if coalesce(btrim(p_reason),'') = '' then
    return jsonb_build_object('ok', false, 'error', '取り消す理由をご記入ください');
  end if;
  update public.invoices
     set status='void', void_reason=btrim(p_reason), updated_at=now()
   where id = p_id and status <> 'void';
  if not found then return jsonb_build_object('ok', false, 'error', '見つかりません'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------
-- ⑥ 未収の一覧
-- ---------------------------------------------------------------
--  期日を過ぎて入っていないもの。何日遅れているかと、
--  担当パートナーまで返す。追う相手が分からないと動けない
create or replace function public.invoice_overdue(p_grace int default 0)
returns table (
  id uuid, customer_id uuid, customer_name text, customer_email text,
  partner_name text, partner_email text,
  period text, title text, amount integer, paid_amount integer,
  due_on date, days_late int, status text
)
language sql security definer stable set search_path = public as $$
  select i.id, i.customer_id,
         coalesce(c.company_name, c.contact_name, c.email, ''), coalesce(c.email,''),
         coalesce(pt.full_name, pt.company_name, ''), coalesce(pt.email,''),
         i.period, i.title, i.amount, i.paid_amount, i.due_on,
         ((now() at time zone 'Asia/Tokyo')::date - i.due_on)::int,
         i.status
    from public.invoices i
    left join public.profiles c  on c.id  = i.customer_id
    left join public.profiles pt on pt.id = c.consultant_id
   where i.status in ('open','partial')
     and i.due_on < ((now() at time zone 'Asia/Tokyo')::date - coalesce(p_grace,0))
     and public.invoice_is_admin()
   order by i.due_on, i.period;
$$;

--  右下のバッジ用。件数と合計だけ
create or replace function public.invoice_overdue_count()
returns table (cnt int, total integer)
language sql security definer stable set search_path = public as $$
  select count(*)::int, coalesce(sum(i.amount - i.paid_amount),0)::integer
    from public.invoices i
   where i.status in ('open','partial')
     and i.due_on < (now() at time zone 'Asia/Tokyo')::date
     and public.invoice_is_admin();
$$;

revoke all on function public.invoice_generate(text,int)                   from public, anon;
revoke all on function public.invoice_reconcile(text)                      from public, anon;
revoke all on function public.invoice_mark_paid(uuid,integer,date,text)    from public, anon;
revoke all on function public.invoice_void(uuid,text)                      from public, anon;
revoke all on function public.invoice_overdue(int)                         from public, anon;
revoke all on function public.invoice_overdue_count()                      from public, anon;

grant execute on function public.invoice_generate(text,int)                to authenticated;
grant execute on function public.invoice_reconcile(text)                   to authenticated;
grant execute on function public.invoice_mark_paid(uuid,integer,date,text) to authenticated;
grant execute on function public.invoice_void(uuid,text)                   to authenticated;
grant execute on function public.invoice_overdue(int)                      to authenticated;
grant execute on function public.invoice_overdue_count()                   to authenticated;

-- ---------------------------------------------------------------
-- ⑦ 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='invoices')            as "請求の表",
  (select count(*) from pg_policies
    where schemaname='public' and tablename='invoices')               as "権限の本数",
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'invoice%')           as "関数",
  (select count(*) from pg_indexes
    where schemaname='public' and indexname='invoices_uniq')          as "二重請求止め";
--  期待値：請求の表=1、権限の本数=4、関数=7、二重請求止め=1
-- =============================================================
