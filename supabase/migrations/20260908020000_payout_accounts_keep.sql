-- =============================================================
-- お振込先を「預かる」形に変える（暗号化して保持する）
-- ---------------------------------------------------------------
--  これまでの設計は、口座情報をプラットホームに置かないためのもの
--  でした。運営が一度だけ受け取って自分の銀行に登録し、受け取った
--  時点で口座番号を消す。「受け渡し口であって保管庫ではない」。
--
--  ■ なぜ変えるか
--    GMOあおぞらネット銀行のオープンAPIには、
--
--        「登録済み振込先へ、振込先IDを指定して振り込む」API が無い
--
--    ことが分かりました（スタンダードAPI 28本のうち、振込系は
--    振込依頼・総合振込依頼のみ。振込先マスタを登録するAPIも、
--    照会するAPIもありません）。つまりAPIで自動送金するには、
--    毎月こちらから口座情報を渡すことになります。
--    自動化を採るなら、持たないという前提のほうを変えるしかない。
--
--    持つと決めた以上、消していた頃より**厳しく**扱います。
--
--  ■ ① 平文では一瞬も置かない
--    これまでは、登録から運営が受け取るまでの数時間、口座番号が
--    平文で表に入っていました。短いから許されていただけです。
--    ずっと持つならもう許されません。
--    登録の瞬間に暗号化し、平文の列には二度と書きません。
--    鍵は表の中ではなく Supabase Vault に置きます。表を丸ごと
--    抜かれても、それだけでは読めません。
--
--  ■ ② 読める経路は、これまでどおり塞いだまま
--    列そのものの権限を落としてあるので、暗号文の列すら
--    ブラウザからは読めません。復号は関数の中だけ。
--    そして**読むたびに記録が残ります**。画面で開いたのか、
--    振込のために取り出したのかも書き分けます。
--
--  ■ ③ 消す道を用意する
--    持つと決めたなら、やめる道も要ります。パートナーが辞めたとき、
--    ご本人から求められたとき、その場で消せるようにします。
--    消したことも記録に残します。
--
--  ■ これで守れないもの
--    service_role の鍵を盗まれた場合は復号できてしまいます。
--    暗号化が効くのは「表やバックアップが漏れたとき」までです。
--    そこから先を守るなら、鍵を Edge Function 側だけに置き、
--    登録もEdge Function経由にする必要があります。次の段です。
--
--  確かめかた：暗号の列=1、平文の残り=0、鍵=1、関数=13、読める列=0
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           20260907020000_payout_accounts_ep.sql のあとに流してください。
--           何度流しても同じ結果になります。
-- =============================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- ① 鍵の置き場所
-- ---------------------------------------------------------------
--  Vault があればそちらへ。無い環境（ローカル検証など）のために
--  受け皿の表も用意しますが、誰にも権限を渡しません
create table if not exists public.payout_keys (
  id  int primary key default 1 check (id = 1),
  k   text not null,
  created_at timestamptz not null default now()
);
alter table public.payout_keys enable row level security;
revoke all on public.payout_keys from authenticated, anon;

do $do$
declare v_has_vault boolean; v_has boolean;
begin
  select exists (select 1 from pg_namespace where nspname = 'vault') into v_has_vault;

  if v_has_vault then
    begin
      execute 'select exists (select 1 from vault.secrets where name = $1)'
        into v_has using 'tsugu_payout_key';
      if not v_has then
        --  鍵はここで作ります。運営が手で用意しなくてよいように
        execute 'select vault.create_secret($1, $2, $3)'
          using encode(gen_random_bytes(32), 'base64'),
                'tsugu_payout_key',
                'お振込先（口座情報）の暗号鍵。消すと復号できなくなります';
      end if;
      return;
    exception when others then
      --  Vault の作法が違う版もある。落ちずに下の受け皿へ
      null;
    end;
  end if;

  if not exists (select 1 from public.payout_keys where id = 1) then
    insert into public.payout_keys (id, k) values (1, encode(gen_random_bytes(32), 'base64'));
  end if;
end $do$;

--  鍵を返すだけの関数。ほかの関数の中からしか呼ばない
create or replace function public.payout_key() returns text
language plpgsql security definer stable set search_path = public as $$
declare v text;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
      into v using 'tsugu_payout_key';
  exception when others then
    v := null;
  end;
  if coalesce(v,'') = '' then
    select k into v from public.payout_keys where id = 1;
  end if;
  if coalesce(v,'') = '' then
    raise exception '口座の暗号鍵が見つかりません。20260908020000 の SQL をもう一度流してください';
  end if;
  return v;
end $$;
revoke all on function public.payout_key() from public, anon, authenticated;

-- ---------------------------------------------------------------
-- ② 暗号文の列と、読んだ記録の使い分け
-- ---------------------------------------------------------------
alter table public.payout_accounts add column if not exists account_enc bytea;
comment on column public.payout_accounts.account_enc is
  '口座情報（銀行コード・支店・口座番号・名義）を暗号化したもの。平文の列は使いません';

--  いつ消したか。消したことも記録に残す
alter table public.payout_accounts add column if not exists forgotten_at timestamptz;

--  画面で開いたのか、振込のために取り出したのか
alter table public.payout_account_reads add column if not exists purpose text;

-- ---------------------------------------------------------------
-- ③ すでに入っている平文を、暗号文へ移す
-- ---------------------------------------------------------------
--  移したら平文は消します。ここを二度流しても、対象がもう無いので
--  何も起きません
update public.payout_accounts
   set account_enc = pgp_sym_encrypt(
         jsonb_build_object(
           'bank_code',   coalesce(bank_code,''),
           'branch_code', coalesce(branch_code,''),
           'branch_name', coalesce(branch_name,''),
           'account_no',  coalesce(account_no,''),
           'holder_kana', coalesce(holder_kana,'')
         )::text, public.payout_key()),
       bank_code = null, branch_code = null, branch_name = null,
       account_no = null, holder_kana = null,
       updated_at = now()
 where account_enc is null
   and coalesce(account_no,'') <> '';

-- ---------------------------------------------------------------
-- ④ 登録：暗号化して入れる。平文の列には書かない
-- ---------------------------------------------------------------
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
  v_ep     uuid;
  v_mgr    boolean;
  v_enc    bytea;
begin
  if auth.uid() is null then return 'error: ログインが必要です'; end if;

  --  EP-I の担当者は、登録しても振り込まれない。待たせないために止める
  select e.ep_id, e.is_mgr into v_ep, v_mgr from public.payout_ep1_of(auth.uid()) e;
  if v_ep is not null and not coalesce(v_mgr,false) then
    return 'error: EP-I のお支払いは法人口座へまとめます。口座のご登録は、法人の管理者にお願いしてください';
  end if;

  v_no     := regexp_replace(coalesce(p_account_no,''), '[^0-9]', '', 'g');
  v_holder := upper(btrim(coalesce(p_holder_kana,'')));

  if coalesce(btrim(p_bank_name),'') = '' then
    return 'error: 銀行名をご入力ください';
  end if;
  if coalesce(btrim(p_branch_name),'') = '' then
    return 'error: 支店名をご入力ください';
  end if;
  if coalesce(btrim(p_bank_code),'') <> '' and btrim(p_bank_code) !~ '^[0-9]{4}$' then
    return 'error: 銀行コードは数字4桁です（お分かりにならなければ空欄で結構です）';
  end if;
  if coalesce(btrim(p_branch_code),'') <> '' and btrim(p_branch_code) !~ '^[0-9]{3}$' then
    return 'error: 支店コードは数字3桁です（お分かりにならなければ空欄で結構です）';
  end if;
  if coalesce(p_account_type,'') not in ('futsu','touza','chochiku') then
    return 'error: 預金の種別をお選びください';
  end if;
  if v_no !~ '^[0-9]{4,8}$' then
    return 'error: 口座番号は数字4〜8桁です（多くの銀行は7桁）';
  end if;
  if v_holder = '' then
    return 'error: 口座名義（カタカナ）をご入力ください';
  end if;
  if v_holder !~ '^[ｦ-ﾟア-ンー・（）\(\)\.\-A-Z0-9 　]+$' then
    return 'error: 口座名義はカタカナ・英数字でご入力ください（漢字・ひらがなは通りません）';
  end if;

  --  ここで暗号にする。平文が表に載るのはこの変数の中だけ
  v_enc := pgp_sym_encrypt(
    jsonb_build_object(
      'bank_code',   coalesce(nullif(btrim(coalesce(p_bank_code,'')),''),''),
      'branch_code', coalesce(nullif(btrim(coalesce(p_branch_code,'')),''),''),
      'branch_name', btrim(p_branch_name),
      'account_no',  v_no,
      'holder_kana', v_holder
    )::text, public.payout_key());

  insert into public.payout_accounts as t
    (user_id, ep_id, bank_name, account_type, last4, status,
     account_enc, submitted_at, collected_at, collected_by, forgotten_at, updated_at)
  values
    (auth.uid(), v_ep, btrim(p_bank_name), p_account_type, right(v_no,4), 'pending',
     v_enc, now(), null, null, null, now())
  on conflict (user_id) do update set
    ep_id        = excluded.ep_id,
    bank_name    = excluded.bank_name,
    account_type = excluded.account_type,
    last4        = excluded.last4,
    --  口座を変えたら、また運営の確認からやり直し。
    --  古い口座に振り込んでしまわないため
    status       = 'pending',
    account_enc  = excluded.account_enc,
    --  平文の列は、もう二度と使わない
    bank_code    = null,
    branch_code  = null,
    branch_name  = null,
    account_no   = null,
    holder_kana  = null,
    submitted_at = now(),
    collected_at = null,
    collected_by = null,
    forgotten_at = null,
    updated_at   = now();

  return 'ok';
end $$;

-- ---------------------------------------------------------------
-- ⑤ 運営が画面で開く（記録が残る）
-- ---------------------------------------------------------------
drop function if exists public.payout_account_reveal(uuid);
create or replace function public.payout_account_reveal(p_user uuid)
returns table (
  bank_name text, bank_code text, branch_name text, branch_code text,
  account_type text, account_no text, holder_kana text, submitted_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin') then
    raise exception '運営のみが確認できます';
  end if;

  insert into public.payout_account_reads (target_user, read_by, purpose)
  values (p_user, auth.uid(), 'screen');

  return query
    select a.bank_name,
           nullif(d.j->>'bank_code',''),
           nullif(d.j->>'branch_name',''),
           nullif(d.j->>'branch_code',''),
           a.account_type,
           nullif(d.j->>'account_no',''),
           nullif(d.j->>'holder_kana',''),
           a.submitted_at
      from public.payout_accounts a
      left join lateral (
        select case when a.account_enc is null then '{}'::jsonb
               else pgp_sym_decrypt(a.account_enc, public.payout_key())::jsonb end as j
      ) d on true
     where a.user_id = p_user;
end $$;

-- ---------------------------------------------------------------
-- ⑥ 運営が「確認しました」を押す（もう消さない）
-- ---------------------------------------------------------------
--  以前はここで口座番号を消していました。毎月この口座へ振り込む
--  ようになったので、消すと翌月に振り込めません。
--  status を registered にするのは「この口座で振り込みます」の意味です
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
    collected_at = now(),
    collected_by = auth.uid(),
    updated_at   = now()
  where user_id = p_user and forgotten_at is null;

  if not found then return 'error: 見つかりません'; end if;
  return 'ok';
end $$;

-- ---------------------------------------------------------------
-- ⑦ 振込のために取り出す（サーバー側だけ）
-- ---------------------------------------------------------------
--  銀行APIを叩く Edge Function から呼びます。ブラウザからは呼べません。
--  取り出したことも記録に残します
create or replace function public.payout_account_for_transfer(p_users uuid[])
returns table (
  user_id uuid, bank_name text, bank_code text, branch_name text, branch_code text,
  account_type text, account_no text, holder_kana text
)
language plpgsql security definer set search_path = public as $$
begin
  insert into public.payout_account_reads (target_user, read_by, purpose)
  select u, coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid), 'transfer'
    from unnest(p_users) u;

  return query
    select a.user_id, a.bank_name,
           nullif(d.j->>'bank_code',''),
           nullif(d.j->>'branch_name',''),
           nullif(d.j->>'branch_code',''),
           a.account_type,
           nullif(d.j->>'account_no',''),
           nullif(d.j->>'holder_kana','')
      from public.payout_accounts a
      left join lateral (
        select case when a.account_enc is null then '{}'::jsonb
               else pgp_sym_decrypt(a.account_enc, public.payout_key())::jsonb end as j
      ) d on true
     where a.user_id = any(p_users)
       --  確認の済んでいない口座には振り込まない。
       --  変更の途中かもしれず、古い口座へ送ってしまう
       and a.status = 'registered'
       and a.forgotten_at is null;
end $$;

-- ---------------------------------------------------------------
-- ⑧ 消す
-- ---------------------------------------------------------------
--  持つと決めたなら、やめる道も要る。辞めた方の口座を持ち続ける
--  理由はありません
create or replace function public.payout_account_forget(p_user uuid, p_reason text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin') then
    return 'error: 運営のみが操作できます';
  end if;
  if coalesce(btrim(p_reason),'') = '' then
    return 'error: 消す理由をご記入ください（記録に残ります）';
  end if;

  update public.payout_accounts set
    account_enc  = null,
    status       = 'pending',
    forgotten_at = now(),
    updated_at   = now()
  where user_id = p_user and forgotten_at is null;

  if not found then return 'error: 見つかりません（すでに消えています）'; end if;

  insert into public.payout_account_reads (target_user, read_by, purpose)
  values (p_user, auth.uid(), 'forget:' || btrim(p_reason));
  return 'ok';
end $$;

--  ご本人からも消せるように。求められて消せないのでは、預かる資格がない
create or replace function public.payout_account_forget_mine()
returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 'error: ログインが必要です'; end if;

  update public.payout_accounts set
    account_enc  = null,
    status       = 'pending',
    forgotten_at = now(),
    updated_at   = now()
  where user_id = auth.uid() and forgotten_at is null;

  if not found then return 'error: ご登録がありません'; end if;

  insert into public.payout_account_reads (target_user, read_by, purpose)
  values (auth.uid(), auth.uid(), 'forget:ご本人の操作');
  return 'ok';
end $$;

-- ---------------------------------------------------------------
-- ⑨ 控えに「預かっているか」を出す
-- ---------------------------------------------------------------
drop function if exists public.payout_account_mine();
create or replace function public.payout_account_mine()
returns table (bank_name text, account_type text, last4 text,
               status text, submitted_at timestamptz, collected_at timestamptz,
               ep_id uuid, ep_name text, held boolean)
language sql security definer stable set search_path = public as $$
  select a.bank_name, a.account_type, a.last4,
         a.status, a.submitted_at, a.collected_at,
         a.ep_id, o.name,
         (a.account_enc is not null)
    from public.payout_accounts a
    left join public.ep_orgs o on o.id = a.ep_id
   where a.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------
-- ⑩ 権限
-- ---------------------------------------------------------------
--  暗号文の列は grant に入れない（入れない限り読めない）
revoke all on function public.payout_account_reveal(uuid)              from public, anon;
revoke all on function public.payout_account_collect(uuid)             from public, anon;
revoke all on function public.payout_account_forget(uuid,text)         from public, anon;
revoke all on function public.payout_account_forget_mine()             from public, anon;
revoke all on function public.payout_account_mine()                    from public, anon;
--  取り出しはサーバー側だけ。authenticated には渡さない
revoke all on function public.payout_account_for_transfer(uuid[])      from public, anon, authenticated;

grant execute on function public.payout_account_reveal(uuid)      to authenticated;
grant execute on function public.payout_account_collect(uuid)     to authenticated;
grant execute on function public.payout_account_forget(uuid,text) to authenticated;
grant execute on function public.payout_account_forget_mine()     to authenticated;
grant execute on function public.payout_account_mine()            to authenticated;

do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.payout_account_for_transfer(uuid[]) to service_role';
  end if;
end $do$;

-- ---------------------------------------------------------------
-- ⑪ 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='payout_accounts'
      and column_name='account_enc')                              as "暗号の列",
  --  ここが 0 でないと、平文の口座番号がまだ残っています
  (select count(*) from public.payout_accounts
    where coalesce(account_no,'') <> '' or coalesce(holder_kana,'') <> '')
                                                                   as "平文の残り",
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='payout_key')          as "鍵",
  (select count(*) from information_schema.routines
    where routine_schema='public' and routine_name like 'payout%') as "関数",
  --  ここが 0 でないと、口座がクライアントから読めてしまう
  (select count(*) from information_schema.column_privileges
    where table_schema='public' and table_name='payout_accounts'
      and grantee='authenticated' and privilege_type='SELECT'
      and column_name in ('account_no','holder_kana','bank_code','branch_code','account_enc'))
                                                                   as "読める列";
--  期待値：暗号の列=1、平文の残り=0、鍵=1、関数=13、読める列=0
-- =============================================================
