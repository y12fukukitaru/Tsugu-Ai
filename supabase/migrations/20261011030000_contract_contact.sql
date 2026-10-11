-- =============================================================
-- 契約のときに、住所・電話番号・法人番号もいただく（2026-10-11）
-- ---------------------------------------------------------------
--  会社名だけでは、同じ名前の会社と見分けがつかない。同意のときに
--    ・所在地（法人）／ご住所（個人）……必須。同意した控え（契約書の本文）に入る
--    ・電話番号……………………………………必須。控えには入れない（下の「守り」）
--    ・法人番号（13桁）…………………………任意。国税庁が公表している番号。控えに入る
--  をいただく。すべての契約（顧問契約・認定パートナー・EP-I・EP-II 本部・EP-II 所属）で同じ。
--
--  守り（個人の情報になり得るもの）
--    ・個人のパートナーの住所・電話、ご担当者の携帯は「個人情報」にあたる。
--      法人の所在地・代表電話・法人番号は会社の情報（個人情報ではない）。
--    ・読めるのは、これまでの契約の決まりのまま：運営／送った人／同意して登録したご本人。
--    ・電話番号は契約書の本文（控え）に入れない。控えは URL を知っている人が読めるため、
--      URL が転送されても電話番号までは広がらないようにする。表の列にだけ置く。
--    ・締結の知らせ（アプリ・メール・LINE）には載せない（これまでどおり会社名とお名前まで）。
--    ・使い道：契約の相手を確かめる・連絡する。プライバシーポリシーに書き足す（弁護士の確認のうえで公開）。
--
--  あわせて：契約の受け取り（contract_claim）
--    ・電話番号を、プロフィールの電話（空のときだけ）に入れる
--      （パートナーは一枚紙の連絡先に、顧客は担当パートナーからの連絡に使う）
--    ・EP-II 所属パートナー（partner_ep2_member）の契約を、パートナー契約として扱う
--      （これまでは顧問契約の扱いになり、役割がパートナーにならなかった）
--    ・ほかは 20261011020000_contract_claim_v3.sql と同じ
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--   何度流しても同じ結果になります。
--   この SQL を流すまでは、画面は住所・電話番号を送らずに同意します（同意そのものは止まりません）。
-- =============================================================

-- ① 列
alter table public.contract_offers add column if not exists agreed_address text;
alter table public.contract_offers add column if not exists agreed_tel     text;
alter table public.contract_offers add column if not exists agreed_corp_no text;
comment on column public.contract_offers.agreed_address is '同意のときにいただいた所在地（法人）／ご住所（個人）。控えの本文にも入る';
comment on column public.contract_offers.agreed_tel     is '同意のときにいただいた電話番号。控えの本文には入れない（URL から広がらないように）';
comment on column public.contract_offers.agreed_corp_no is '法人番号（13桁・任意）。国税庁の公表番号';

alter table public.contract_offers drop constraint if exists contract_offers_contact_chk;
alter table public.contract_offers add constraint contract_offers_contact_chk check (
      (agreed_address is null or char_length(agreed_address) <= 200)
  and (agreed_tel is null or (char_length(agreed_tel) <= 20 and agreed_tel ~ '^[0-9+() -]+$'))
  and (agreed_corp_no is null or agreed_corp_no ~ '^[0-9]{13}$')
) not valid;

-- ② 法人番号の検査（先頭1桁が検査用の数字。国税庁の計算方法）
--    残り12桁を右から数えて、奇数番目は×1・偶数番目は×2 で足し、9 −（合計を9で割った余り）
create or replace function public.tsugu_corp_no_ok(p text)
returns boolean
language plpgsql
immutable
as $$
declare s int := 0; i int; d int;
begin
  if p is null or p !~ '^[0-9]{13}$' then return false; end if;
  for i in 1..12 loop
    d := substr(p, 14 - i, 1)::int;           -- 右から i 番目
    s := s + d * (case when i % 2 = 1 then 1 else 2 end);
  end loop;
  return substr(p, 1, 1)::int = 9 - (s % 9);
end;
$$;

-- ③ 同意：住所・電話番号・法人番号を受け取る
--    引数が増えるので、前の形（4つ）を消してから作り直す（残すと呼び分けができなくなる）
drop function if exists public.contract_agree(text, text, text, text);
create or replace function public.contract_agree(
  p_token text, p_name text, p_org text default null, p_ua text default null,
  p_address text default null, p_tel text default null, p_corp_no text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.contract_offers%rowtype;
  final_body text;
  hq text;
  nm  text := btrim(coalesce(p_name,''));
  og  text := btrim(coalesce(p_org,''));
  adr text := btrim(regexp_replace(coalesce(p_address,''), '\s+', ' ', 'g'));
  tel text := btrim(translate(coalesce(p_tel,''), '０１２３４５６７８９－ー（）＋　', '0123456789--()+ '));
  cno text := regexp_replace(translate(coalesce(p_corp_no,''), '０１２３４５６７８９', '0123456789'), '[^0-9]', '', 'g');
  is_org boolean;
  extra text;
  mail_line text;
begin
  if nm = '' then
    return jsonb_build_object('ok', false, 'error', 'ご担当者さまのお名前をご記入ください。');
  end if;

  select * into o from public.contract_offers where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'この契約書は見つかりませんでした。');
  end if;
  if o.status = 'agreed' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if o.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'この契約は取り消されています。');
  end if;
  if o.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'この契約書の有効期限が切れています。');
  end if;

  is_org := o.kind in ('customer','partner_ep1','partner_ep2');
  if is_org and og = '' then
    return jsonb_build_object('ok', false, 'error', '法人名（会社名）をご記入ください。');
  end if;
  if adr = '' then
    return jsonb_build_object('ok', false, 'error',
      case when is_org then '所在地（会社の住所）をご記入ください。' else 'ご住所をご記入ください。' end);
  end if;
  if char_length(adr) > 200 then
    return jsonb_build_object('ok', false, 'error', '住所が長すぎます（200文字まで）。');
  end if;
  if tel = '' then
    return jsonb_build_object('ok', false, 'error', '電話番号をご記入ください。');
  end if;
  if tel !~ '^[0-9+() -]+$' or char_length(tel) > 20 or char_length(regexp_replace(tel, '[^0-9]', '', 'g')) < 10 then
    return jsonb_build_object('ok', false, 'error', '電話番号は、数字10桁以上でご記入ください（ハイフンはあってもなくても構いません）。');
  end if;
  if cno <> '' and not public.tsugu_corp_no_ok(cno) then
    return jsonb_build_object('ok', false, 'error', '法人番号（13桁）をお確かめください。わからないときは空欄のままで構いません。');
  end if;

  if o.ep_id is not null then
    select name into hq from public.ep_orgs where id = o.ep_id;
  end if;

  final_body := public.contract_fill(o.body, o.email, o.monthly_fee, nm,
                                     (now() at time zone 'Asia/Tokyo')::date, og, hq);
  --  プランの名前。顧問契約以外や未指定なら「—」
  final_body := replace(final_body, '{{プラン}}',
    case when o.plan = 'seller' then '売り手プラン（譲渡準備）'
         when o.plan = 'buyer'  then '買い手プラン（成長）'
         else '—' end);

  --  控えに、所在地（住所）と法人番号を入れる。メールアドレスの行のすぐ下に。
  --  その行が無い書面（本文を直した版など）は、契約者の欄の終わりとして末尾に足す。
  --  電話番号は入れない（控えは URL で読めるため）
  extra := E'\n  ' || (case when is_org then '所在地' else 'ご住所' end) || '：' || adr
        || (case when cno <> '' then E'\n  法人番号：' || cno else '' end);
  mail_line := '  メールアドレス：' || o.email;
  if position(mail_line in final_body) > 0 then
    final_body := overlay(final_body placing mail_line || extra
                          from position(mail_line in final_body) for char_length(mail_line));
  else
    final_body := final_body || E'\n\n■ 契約者の所在地' || extra;
  end if;

  update public.contract_offers
     set status = 'agreed',
         agreed_at = now(),
         agreed_name = nm,
         agreed_org = nullif(og,''),
         agreed_body = final_body,
         agreed_ua = left(coalesce(p_ua,''), 400),
         agreed_address = adr,
         agreed_tel = tel,
         agreed_corp_no = nullif(cno,'')
   where id = o.id;

  begin
    perform public.contract_notify_agreed(o.id);
  exception when others then
    null;
  end;

  return jsonb_build_object('ok', true, 'agreed_at', now());
end;
$$;
revoke all on function public.contract_agree(text, text, text, text, text, text, text) from public;
grant execute on function public.contract_agree(text, text, text, text, text, text, text) to anon, authenticated;

-- ④ 受け取り：電話番号をプロフィールへ（空のときだけ）・EP-II 所属をパートナー契約として扱う
create or replace function public.contract_claim()
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  me       uuid := auth.uid();
  my_email text;
  o        public.contract_offers%rowtype;
  cur      uuid;
  sender_role text;
  cons     uuid;
begin
  if me is null then return 'error: ログインが必要です'; end if;
  select lower(coalesce(auth.jwt() ->> 'email','')) into my_email;
  if my_email = '' then return 'error: メールアドレスが取れません'; end if;

  select * into o from public.contract_offers c
   where lower(c.email) = my_email and c.status = 'agreed'
     and (c.claimed_user_id is null
          or c.claimed_user_id = me
          or (not exists (select 1 from auth.users u where u.id = c.claimed_user_id)
              --  解約の手続き（運営コンソールの「アカウントを削除する」）で消した方の契約は
              --  受け取らせない。登録し直したら新規のお客様（以前の担当・プランは付かない）
              and not exists (select 1 from public.account_deletions d
                               where d.deleted_user_id = c.claimed_user_id)))
   order by c.agreed_at desc nulls last
   limit 1;
  if not found then return 'none'; end if;

  if o.kind in ('partner','partner_ep1','partner_ep2','partner_ep2_member') then
    update public.profiles set role = 'consultant'
     where id = me and role = 'customer';
    update public.profiles
       set full_name = coalesce(nullif(btrim(full_name),''), nullif(btrim(o.agreed_name),'')),
           company_name = coalesce(nullif(btrim(company_name),''), nullif(btrim(o.agreed_org),'')),
           phone = coalesce(nullif(btrim(phone),''), nullif(btrim(o.agreed_tel),'')),
           onboarded = true
     where id = me;
  else
    --  担当：契約の記録 → 無ければ、送った人がパートナーならその方
    cons := o.consultant_id;
    if cons is null and o.offered_by is not null then
      select role into sender_role from public.profiles where id = o.offered_by;
      if sender_role = 'consultant' then cons := o.offered_by; end if;
    end if;
    select consultant_id into cur from public.profiles where id = me;
    if cur is null and cons is not null then
      update public.profiles set consultant_id = cons where id = me;
    end if;
    --  契約時のプランを引き継ぐ。最初から効く（plan_from は空）
    if o.plan in ('buyer','seller') then
      update public.profiles set plan = o.plan, plan_from = null, plan_prev = null
       where id = me and role = 'customer';
    end if;
    --  契約書に書いていただいた会社名・お名前・電話番号。はじめの設定はもう聞かない
    update public.profiles
       set company_name = coalesce(nullif(btrim(company_name),''), nullif(btrim(o.agreed_org),'')),
           contact_name = coalesce(nullif(btrim(contact_name),''), nullif(btrim(o.agreed_name),'')),
           phone = coalesce(nullif(btrim(phone),''), nullif(btrim(o.agreed_tel),'')),
           onboarded = true
     where id = me;
  end if;

  update public.contract_offers set claimed_user_id = me where id = o.id;
  return 'claimed:' || o.kind;
end;
$$;
revoke all on function public.contract_claim() from public, anon;
grant execute on function public.contract_claim() to authenticated;

-- 確かめ（4つとも 1 なら完了）
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'contract_offers' and column_name = 'agreed_tel')        as "電話番号の列",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'contract_agree' and p.pronargs = 7)                         as "同意（住所・電話・法人番号）",
  (select case when public.tsugu_corp_no_ok('7000012050002') and not public.tsugu_corp_no_ok('1000012050002')
               then 1 else 0 end)                                                                          as "法人番号の検査",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'contract_claim'
      and position('partner_ep2_member' in pg_get_functiondef(p.oid)) > 0)                                as "EP-II所属もパートナーに";
