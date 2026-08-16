-- =============================================================
-- 権限昇格の防止（重大）
--
--  いま入っているポリシー profiles_update_own は
--      USING (auth.uid() = id)  WITH CHECK (auth.uid() = id)
--  で、「本人なら自分の行を書き換えてよい」だけを見ている。
--  PostgreSQL の RLS は行の単位で判定するため、これでは
--  「どの列を書き換えたか」を止められない。
--
--  つまり、ログインできる人なら誰でもブラウザの開発者ツールから
--      update profiles set role = 'admin' where id = auth.uid()
--  を実行でき、その場で運営に昇格できてしまう。
--  画面側で運営メニューを隠していても、隠しているだけでは防げない。
--
--  同じ理由で profiles_partner_update（パートナーが担当顧客の行を
--  書き換えられる）からも、顧客の role を admin にできてしまう。
--
--  もう一つの入口：profiles_insert_own も WITH CHECK (auth.uid() = id) だけ
--  なので、新規登録した直後に自分の行を role='admin' で作れてしまう。
--  （画面は role='customer' で作るが、画面を通さなければよい）
--
--  対策：特権列をトリガーで凍結する。運営（代表）以外が変更しようと
--        しても、エラーにはせず「元の値のまま」（新規作成なら安全な値）に
--        戻す。エラーにしないのは、既存の画面の保存処理を壊さないため。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================

create or replace function public.profiles_freeze_privileged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean := false;
begin
  -- ① SQL Editor や service_role からの操作（auth.uid() が無い）は許す。
  --    運営が手作業で直せなくなるのを防ぐため。
  if auth.uid() is null then
    allowed := true;
  end if;

  -- ② 運営（代表）は変更できる。運営コンソールの役割変更はここを通る。
  if not allowed then
    begin
      allowed := coalesce(public.is_owner(), false);
    exception when others then
      allowed := false;   -- 関数が無い環境でも落とさない
    end;
  end if;

  -- ③ 登録コードの引き換え（redeem_signup_code）からの変更は許す。
  --    この印は同じトランザクションの中だけ有効で、画面からは付けられない。
  if not allowed then
    allowed := coalesce(current_setting('tsugu.allow_role_change', true), '') = 'on';
  end if;

  if not allowed then
    if TG_OP = 'UPDATE' then
      -- 変更しようとしても、元の値のまま
      new.role          := old.role;
      new.admin_role    := old.admin_role;
      new.admin_perms   := old.admin_perms;
      new.consultant_id := old.consultant_id;
    else
      -- 新規作成。運営として作ることはできない
      if new.role is null or new.role not in ('customer','consultant') then
        new.role := 'customer';
      end if;
      new.admin_role    := null;
      new.admin_perms   := null;
      new.consultant_id := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_freeze_privileged on public.profiles;
create trigger profiles_freeze_privileged
  before insert or update on public.profiles
  for each row execute function public.profiles_freeze_privileged();


-- -------------------------------------------------------------
-- 登録コードの引き換えは、これまでどおり役割を変えられるようにする
-- （中身は従来と同じ。上のトリガーに通すための印を1行足しただけ）
-- -------------------------------------------------------------
create or replace function public.redeem_signup_code(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.signup_codes%rowtype;
  cur_role text;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'ログインが必要です');
  end if;

  select * into c from public.signup_codes
   where upper(code) = upper(btrim(p_code)) limit 1;

  if not found or c.active is not true then
    return json_build_object('ok', false, 'error', 'コードが見つかりません');
  end if;
  if c.expires_at is not null and c.expires_at < now() then
    return json_build_object('ok', false, 'error', 'このコードは有効期限が切れています');
  end if;
  if c.used_count >= c.max_uses then
    return json_build_object('ok', false, 'error', 'このコードは使用上限に達しています');
  end if;

  select role into cur_role from public.profiles where id = auth.uid();
  -- 運営アカウントは降格させない
  if cur_role = 'admin' then
    return json_build_object('ok', false, 'error', '運営アカウントでは使用できません');
  end if;

  -- ここだけ役割の変更を許す印（このトランザクションの中でのみ有効）
  perform set_config('tsugu.allow_role_change', 'on', true);
  update public.profiles set role = c.role where id = auth.uid();
  perform set_config('tsugu.allow_role_change', 'off', true);

  update public.signup_codes set used_count = used_count + 1 where code = c.code;

  return json_build_object('ok', true, 'role', c.role);
end;
$$;

revoke all on function public.redeem_signup_code(text) from public;
grant execute on function public.redeem_signup_code(text) to authenticated;


-- =============================================================
-- 確認 その1（Run したあとに、この select だけを実行）
--   トリガーが付いていれば1行返ります。
-- =============================================================
-- select tgname as トリガー, tgenabled as 状態
--   from pg_trigger
--  where tgrelid = 'public.profiles'::regclass
--    and not tgisinternal;

-- =============================================================
-- 確認 その2（本当の確認はこちら）
--   SQL Editor は auth.uid() が無いため、上の①で「許す」側に入ります。
--   実際に塞がったかどうかは、ブラウザから確かめてください。
--
--   1. 顧客またはパートナーのアカウントでログイン
--   2. F12（開発者ツール）→ Console を開く
--   3. 次を貼って実行
--
--        await sb.from('profiles').update({role:'admin'}).eq('id', ME);
--        (await sb.from('profiles').select('role').eq('id',ME).single()).data
--
--   結果：
--     修正前 … {role: 'admin'}      ← 昇格できてしまう
--     修正後 … {role: 'customer'}   ← 変わらない（エラーも出ない）
--
--   ※ 万一 'admin' になってしまった場合は、SQL Editor から
--        update public.profiles set role='customer' where id='<そのUUID>';
--      で戻せます（SQL Editor からは変更できます）。
-- =============================================================
