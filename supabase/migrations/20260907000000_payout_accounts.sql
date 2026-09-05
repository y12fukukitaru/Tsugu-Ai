-- =============================================================
-- お振込先（口座）の登録：預からずに、受け渡すだけ
-- ---------------------------------------------------------------
--  これまではパートナーからカードで課金する前提でした。けれど
--  アソシエイトからの課金を止めた今、運営からお支払いする額のほうが
--  大きくなります。取りに行く仕組みではなく、お渡しする仕組みが要ります。
--
--  ■ いちばん大事なこと：口座情報をプラットホームに置かない
--    置けば、漏れたときに責任を負うのはこちらです。かといって
--    「メールで送ってください」では、パートナーの手間が増えるうえに
--    メールの中に口座が半永久的に残ります。どちらも避けたい。
--
--    そこで、この表は口座の**保管庫ではなく受け渡し口**にします。
--
--      ① パートナーが画面から登録する（ここで初めて口座番号が入る）
--      ② 運営が受け取り、自分の銀行の振込先に登録する
--      ③ 運営が「銀行に登録しました」を押す
--         → 口座番号・名義・支店コードをこの場で消す
--
--    ふだんの状態（③のあと）で残っているのは
--      銀行名 ／ 種別 ／ 下4桁 ／ 登録済みかどうか ／ 日時
--    だけです。これだけでは1円も動かせません。ご本人が
--    「正しい口座が入っている」と確かめるための控えです。
--
--    振込先は銀行側に一度登録すれば繰り返し使えます。だから
--    こちらが口座番号を持ち続ける理由が、そもそもありません。
--
--  ■ 読めてしまう経路を先に塞ぐ
--    RLS は「行」を守りますが「列」は守りません。select('*') を
--    うっかり書いた瞬間に口座番号が画面へ流れます。
--    そこで列そのものの権限を落とします（column-level grant）。
--    ご本人でさえ、自分の口座番号を読み返せません。
--    運営が読むときだけ、専用の関数を通します。そして
--    **誰がいつ誰の口座を見たかを必ず記録します。**
--
--  ■ 確かめかた（このファイルを流したあと、いちばん下に出ます）
--    受け渡し口=1 ／ 見た記録=1 ／ 関数=6 ／ 読める列=0
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           一度だけ。二度流しても壊れない。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 受け渡し口
-- ---------------------------------------------------------------
create table if not exists public.payout_accounts (
  user_id        uuid primary key,

  --  ふだん残しておくぶん（これだけでは送金できない）
  bank_name      text not null,
  account_type   text not null check (account_type in ('futsu','touza','chochiku')),
  last4          text,
  status         text not null default 'pending' check (status in ('pending','registered')),

  --  受け渡しのあいだだけ入っているぶん。運営が受け取ったら消える
  bank_code      text,
  branch_code    text,
  branch_name    text,
  account_no     text,
  holder_kana    text,

  submitted_at   timestamptz not null default now(),
  collected_at   timestamptz,
  collected_by   uuid,
  updated_at     timestamptz not null default now()
);

--  見た記録。消える情報だからこそ、見たことは消えないようにする
create table if not exists public.payout_account_reads (
  id          bigserial primary key,
  target_user uuid not null,
  read_by     uuid not null,
  read_at     timestamptz not null default now()
);
create index if not exists payout_account_reads_target_idx
  on public.payout_account_reads (target_user, read_at desc);

alter table public.payout_accounts      enable row level security;
alter table public.payout_account_reads enable row level security;

-- ---------------------------------------------------------------
-- ② 列の権限：口座番号は誰にも読ませない
-- ---------------------------------------------------------------
--  insert / update は関数（SECURITY DEFINER）からしか行わない。
--  ここで直接の書き込み権限も渡さない。
revoke all on public.payout_accounts      from authenticated;
revoke all on public.payout_account_reads from authenticated;

--  読めるのは「控え」の列だけ。account_no・holder_kana・
--  branch_code・bank_code はここに書かない。書かない限り読めない
grant select (user_id, bank_name, account_type, last4, status,
              submitted_at, collected_at, updated_at)
  on public.payout_accounts to authenticated;

--  見た記録は運営が読む。行の制限は下の policy でかける
grant select on public.payout_account_reads to authenticated;

do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.payout_accounts      to service_role';
    execute 'grant all on public.payout_account_reads to service_role';
  end if;
end $do$;

--  ご本人と運営だけが控えを見られる
drop policy if exists "payout own read"   on public.payout_accounts;
drop policy if exists "payout admin read" on public.payout_accounts;

create policy "payout own read" on public.payout_accounts
  for select to authenticated
  using (user_id = auth.uid());

create policy "payout admin read" on public.payout_accounts
  for select to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin'));

--  見た記録は運営だけが読める。書き込みは関数から
drop policy if exists "payout reads admin" on public.payout_account_reads;
create policy "payout reads admin" on public.payout_account_reads
  for select to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin'));

-- ---------------------------------------------------------------
-- ③ 登録する（ご本人だけ）
-- ---------------------------------------------------------------
--  形の確認をここでもやる。画面側だけの確認は、画面を通さない
--  呼び方をされたときに素通りする。桁が足りない口座は振込が返ってきて、
--  結局ご本人をお待たせすることになる。
create or replace function public.payout_account_submit(
  p_bank_name    text,
  p_bank_code    text,
  p_branch_name  text,
  p_branch_code  text,
  p_account_type text,
  p_account_no   text,
  p_holder_kana  text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_no     text;
  v_holder text;
begin
  if auth.uid() is null then return 'error: ログインが必要です'; end if;

  v_no     := regexp_replace(coalesce(p_account_no,''), '[^0-9]', '', 'g');
  v_holder := upper(btrim(coalesce(p_holder_kana,'')));

  if coalesce(btrim(p_bank_name),'') = '' then
    return 'error: 銀行名をご入力ください';
  end if;
  if coalesce(btrim(p_branch_name),'') = '' then
    return 'error: 支店名をご入力ください';
  end if;
  --  コードは任意。必須にすると、手元に控えが無い方がここで止まり、
  --  登録そのものをあきらめてしまう。止まった方には報酬が届かない。
  --  入れていただけたときだけ、桁を確かめる
  if coalesce(btrim(p_bank_code),'') <> '' and btrim(p_bank_code) !~ '^[0-9]{4}$' then
    return 'error: 銀行コードは数字4桁です（お分かりにならなければ空欄で結構です）';
  end if;
  if coalesce(btrim(p_branch_code),'') <> '' and btrim(p_branch_code) !~ '^[0-9]{3}$' then
    return 'error: 支店コードは数字3桁です（お分かりにならなければ空欄で結構です）';
  end if;
  if coalesce(p_account_type,'') not in ('futsu','touza','chochiku') then
    return 'error: 預金の種別をお選びください';
  end if;
  --  ふつうは7桁。ゆうちょなど例外があるので幅を持たせるが、
  --  1桁や9桁は明らかに打ち間違いなので止める
  if v_no !~ '^[0-9]{4,8}$' then
    return 'error: 口座番号は数字4〜8桁です（多くの銀行は7桁）';
  end if;
  if v_holder = '' then
    return 'error: 口座名義（カタカナ）をご入力ください';
  end if;
  --  銀行に通る文字だけ。漢字やひらがなが混ざると振込が返ってくる
  if v_holder !~ '^[ｦ-ﾟア-ンー・（）\(\)\.\-A-Z0-9 　]+$' then
    return 'error: 口座名義はカタカナ・英数字でご入力ください（漢字・ひらがなは通りません）';
  end if;

  insert into public.payout_accounts as t
    (user_id, bank_name, account_type, last4, status,
     bank_code, branch_code, branch_name, account_no, holder_kana,
     submitted_at, collected_at, collected_by, updated_at)
  values
    (auth.uid(), btrim(p_bank_name), p_account_type, right(v_no,4), 'pending',
     nullif(btrim(coalesce(p_bank_code,'')),''), nullif(btrim(coalesce(p_branch_code,'')),''),
     btrim(p_branch_name), v_no, v_holder,
     now(), null, null, now())
  on conflict (user_id) do update set
    bank_name    = excluded.bank_name,
    account_type = excluded.account_type,
    last4        = excluded.last4,
    --  口座を変えたら、また運営の確認からやり直し。
    --  古い口座に振り込んでしまわないため
    status       = 'pending',
    bank_code    = excluded.bank_code,
    branch_code  = excluded.branch_code,
    branch_name  = excluded.branch_name,
    account_no   = excluded.account_no,
    holder_kana  = excluded.holder_kana,
    submitted_at = now(),
    collected_at = null,
    collected_by = null,
    updated_at   = now();

  return 'ok';
end $$;

-- ---------------------------------------------------------------
-- ④ 運営が受け取る
-- ---------------------------------------------------------------
--  見るたびに記録が残る。記録が残ることが、むやみに開かない理由になる
create or replace function public.payout_account_reveal(p_user uuid)
returns table (
  bank_name text, bank_code text, branch_name text, branch_code text,
  account_type text, account_no text, holder_kana text, submitted_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin') then
    raise exception '運営のみが確認できます';
  end if;

  insert into public.payout_account_reads (target_user, read_by)
  values (p_user, auth.uid());

  return query
    select a.bank_name, a.bank_code, a.branch_name, a.branch_code,
           a.account_type, a.account_no, a.holder_kana, a.submitted_at
      from public.payout_accounts a
     where a.user_id = p_user;
end $$;

--  受け取り終わり。ここで口座番号が消える
create or replace function public.payout_account_collect(p_user uuid)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin') then
    return 'error: 運営のみが操作できます';
  end if;

  update public.payout_accounts set
    status       = 'registered',
    bank_code    = null,
    branch_code  = null,
    branch_name  = null,
    account_no   = null,
    holder_kana  = null,
    collected_at = now(),
    collected_by = auth.uid(),
    updated_at   = now()
  where user_id = p_user;

  if not found then return 'error: 見つかりません'; end if;
  return 'ok';
end $$;

-- ---------------------------------------------------------------
-- ⑤ 配分画面で使う：この人たちの口座は登録済みか
-- ---------------------------------------------------------------
--  未登録の方に「お振込額」だけ並ぶと、振り込んだつもりで
--  止まったままになる。画面の側で気づけるようにする
create or replace function public.payout_account_status(p_users uuid[])
returns table (user_id uuid, status text, bank_name text, last4 text)
language sql security definer stable set search_path = public as $$
  select a.user_id, a.status, a.bank_name, a.last4
    from public.payout_accounts a
   where a.user_id = any(p_users)
     and exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin');
$$;

--  受け取り待ちの一覧（口座番号は返さない。開くのは reveal だけ）
create or replace function public.payout_account_pending()
returns table (user_id uuid, name text, email text,
               bank_name text, last4 text, submitted_at timestamptz)
language sql security definer stable set search_path = public as $$
  select a.user_id,
         coalesce(p.full_name, p.company_name, ''), coalesce(p.email,''),
         a.bank_name, a.last4, a.submitted_at
    from public.payout_accounts a
    left join public.profiles p on p.id = a.user_id
   where a.status = 'pending'
     and exists (select 1 from public.profiles q
                  where q.id = auth.uid() and q.role = 'admin')
   order by a.submitted_at;
$$;

--  ご本人の控え。列の権限を落としてあるので、これで読む
create or replace function public.payout_account_mine()
returns table (bank_name text, account_type text, last4 text,
               status text, submitted_at timestamptz, collected_at timestamptz)
language sql security definer stable set search_path = public as $$
  select a.bank_name, a.account_type, a.last4,
         a.status, a.submitted_at, a.collected_at
    from public.payout_accounts a
   where a.user_id = auth.uid();
$$;

revoke all on function public.payout_account_submit(text,text,text,text,text,text,text) from public, anon;
revoke all on function public.payout_account_reveal(uuid)   from public, anon;
revoke all on function public.payout_account_collect(uuid)  from public, anon;
revoke all on function public.payout_account_status(uuid[]) from public, anon;
revoke all on function public.payout_account_pending()      from public, anon;
revoke all on function public.payout_account_mine()         from public, anon;

grant execute on function public.payout_account_submit(text,text,text,text,text,text,text) to authenticated;
grant execute on function public.payout_account_reveal(uuid)   to authenticated;
grant execute on function public.payout_account_collect(uuid)  to authenticated;
grant execute on function public.payout_account_status(uuid[]) to authenticated;
grant execute on function public.payout_account_pending()      to authenticated;
grant execute on function public.payout_account_mine()         to authenticated;

-- ---------------------------------------------------------------
-- ⑥ 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='payout_accounts')       as "受け渡し口",
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='payout_account_reads')  as "見た記録",
  (select count(*) from information_schema.routines
    where routine_schema='public' and routine_name like 'payout_account%') as "関数",
  --  ここが 0 でないと、口座番号がクライアントから読めてしまう
  (select count(*) from information_schema.column_privileges
    where table_schema='public' and table_name='payout_accounts'
      and grantee='authenticated' and privilege_type='SELECT'
      and column_name in ('account_no','holder_kana','bank_code','branch_code')) as "読める列";
