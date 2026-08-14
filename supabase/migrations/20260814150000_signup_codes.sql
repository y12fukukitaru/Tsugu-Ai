-- =============================================================
-- 登録コード（役割の自己適用）
--  新規登録直後は全員 role='customer' になるため、パートナーは運営が
--  権限を変えるまで何もできなかった。運営が発行した登録コードを本人が
--  入力すると、その場で自分の役割が切り替わるようにする。
--
--  安全性：
--   - コード一覧はクライアントから読めない（運営のみ select 可）
--   - 昇格は SECURITY DEFINER の関数経由のみ。関数内でコードの有効性・
--     使用上限・有効期限を検証する
--   - 付与できる役割は consultant / customer のみ（admin は付与不可）
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================

-- 初回ログインの「はじめの設定」を済ませたかどうか
alter table public.profiles add column if not exists onboarded boolean not null default false;
-- 既存ユーザーは設定済みとみなす（初回設定画面を出さない）
update public.profiles
   set onboarded = true
 where onboarded = false
   and (company_name is not null or contact_name is not null or full_name is not null or role = 'admin');

create table if not exists public.signup_codes (
  code        text primary key,
  role        text not null check (role in ('consultant','customer')),
  label       text,
  max_uses    int  not null default 100,
  used_count  int  not null default 0,
  expires_at  timestamptz,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.signup_codes enable row level security;

-- 一覧・発行・停止は運営のみ
drop policy if exists "admin manages signup codes" on public.signup_codes;
create policy "admin manages signup codes" on public.signup_codes
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 本人がコードを入力して自分の役割を切り替える
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

  update public.profiles set role = c.role where id = auth.uid();
  update public.signup_codes set used_count = used_count + 1 where code = c.code;

  return json_build_object('ok', true, 'role', c.role);
end;
$$;

revoke all on function public.redeem_signup_code(text) from public;
grant execute on function public.redeem_signup_code(text) to authenticated;

-- 初期コード（運営コンソールでいつでも変更・停止できます）
insert into public.signup_codes (code, role, label, max_uses)
values ('TSUGU-PARTNER', 'consultant', '認定パートナー用（初期コード）', 500)
on conflict (code) do nothing;
