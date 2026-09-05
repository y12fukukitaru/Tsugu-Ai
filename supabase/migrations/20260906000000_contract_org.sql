-- =============================================================
-- 契約に「法人名」を足し、パートナー契約を個人と法人に分ける
-- ---------------------------------------------------------------
--  最初の版は記名が個人名だけだった。だが実際に契約するのは、
--  顧客なら会社、パートナーも法人のことがある。個人名しか残らないと、
--  「誰と契約したのか」が書面から分からない。
--
--  ■ 何を必須にするか
--    顧客           … 法人名・個人名の両方（会社と契約するので法人名は要る）
--    法人パートナー … 両方
--    認定パートナー … 個人名だけ（個人で活動する方なので、屋号は任意）
--
--    「入れないと進めない」で縛る。あとから「どの会社だったか」を
--    探し回るより、その場で一度入れてもらうほうがずっと早い。
--
--  ■ パートナー契約を三つに分ける
--    partner       … 認定パートナー（個人）
--    partner_ep1   … 法人パートナー EP-I（顧客基盤型）
--    partner_ep2   … 法人パートナー EP-II（所属営業型）
--
--    法人をひとくくりにできない。EP-I は法人が顧客基盤を持ち、担当者を
--    配置して、法人が報酬を受け取る。EP-II は所属する個人が顧客と向き合い、
--    本部（法人）は一律の割合を受け取る。誰が顧客に責任を負うのかが
--    そもそも違うので、同じ書面を送っては話が合わない。
--
--    役割はいずれも consultant。契約の種別としてだけ分ける。
--
--  ■ 報酬の率は書面に焼き込まない
--    率は報酬規程と課金の仕組みが持っている。書面に数字を写すと、
--    どちらかを直したときに食い違い、しかも気づけない。
--    書面には「誰がどう受け取る形か」だけを書き、額は規程に委ねる。
--    数字を入れたくなったら、運営画面の編集から足せる。
--
-- 先に実行しておく SQL: 20260905000000_contracts.sql
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           一度だけ。二度流しても壊れない。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 種別に「法人パートナー」を足す
-- ---------------------------------------------------------------
alter table public.contract_templates drop constraint if exists contract_templates_kind_check;
alter table public.contract_templates add  constraint contract_templates_kind_check
  check (kind in ('partner','partner_ep1','partner_ep2','customer'));

alter table public.contract_offers drop constraint if exists contract_offers_kind_check;
alter table public.contract_offers add  constraint contract_offers_kind_check
  check (kind in ('partner','partner_ep1','partner_ep2','customer'));

-- ---------------------------------------------------------------
-- ② 法人名を残せるようにする
-- ---------------------------------------------------------------
alter table public.contract_offers add column if not exists agreed_org text;

comment on column public.contract_offers.agreed_org is
  '同意した法人名。顧客と法人パートナーは必須、認定パートナー（個人）は任意';

-- ---------------------------------------------------------------
-- ③ 差し込みに {{法人名}} を足す
-- ---------------------------------------------------------------
create or replace function public.contract_fill(
  p_body text, p_email text, p_fee numeric, p_name text, p_date date,
  p_org text default null)
returns text
language sql
immutable
as $$
  select replace(replace(replace(replace(replace(
    coalesce(p_body,''),
    '{{メールアドレス}}', coalesce(p_email,'')),
    '{{月額}}', case when p_fee is null then '—'
                     else to_char(p_fee,'FM999,999,999') || '円（税別）' end),
    '{{法人名}}', coalesce(nullif(p_org,''),'＿＿＿＿＿＿＿＿＿＿＿＿')),
    '{{お名前}}', coalesce(nullif(p_name,''),'＿＿＿＿＿＿＿＿')),
    '{{契約日}}', case when p_date is null then '＿＿＿年＿＿月＿＿日'
                       else to_char(p_date,'YYYY"年"MM"月"DD"日"') end);
$$;
grant execute on function public.contract_fill(text, text, numeric, text, date, text) to authenticated;

-- ---------------------------------------------------------------
-- ④ 開いたときに、法人名が要るかどうかも返す
-- ---------------------------------------------------------------
create or replace function public.contract_open(p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare o public.contract_offers%rowtype;
begin
  select * into o from public.contract_offers where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'この契約書は見つかりませんでした。URLをご確認ください。');
  end if;
  if o.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'この契約は取り消されています。送り主にお問い合わせください。');
  end if;
  if o.status = 'sent' and o.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'この契約書の有効期限が切れています。送り主に再発行をご依頼ください。');
  end if;
  return jsonb_build_object(
    'ok', true,
    'kind', o.kind,
    'email', o.email,
    'title', o.title,
    'body', case when o.status = 'agreed' then o.agreed_body
                 else public.contract_fill(o.body, o.email, o.monthly_fee, null, null, null) end,
    'monthly_fee', o.monthly_fee,
    --  会社として契約するものかどうか。画面はこれを見て、法人名の欄を
    --  必須にする。判断を画面側に持たせると、種別が増えたときに片方だけ
    --  直し忘れる
    'org_required', (o.kind in ('customer','partner_ep1','partner_ep2')),
    'status', o.status,
    'agreed_at', o.agreed_at,
    'agreed_name', o.agreed_name,
    'agreed_org', o.agreed_org
  );
end;
$$;

-- ---------------------------------------------------------------
-- ⑤ 同意：法人名も受け取る
-- ---------------------------------------------------------------
--  引数が増えるので、古いものは落とす。残しておくと、画面が古いほうを
--  呼び続けても気づけず、法人名が入らないまま契約が成立してしまう
drop function if exists public.contract_agree(text, text, text);

create or replace function public.contract_agree(
  p_token text, p_name text, p_org text default null, p_ua text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.contract_offers%rowtype;
  final_body text;
  nm text := btrim(coalesce(p_name,''));
  og text := btrim(coalesce(p_org,''));
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

  --  会社として契約するものは、法人名が無いと成立させない。
  --  画面側でも止めているが、ここでも止める。画面だけの縛りは、
  --  画面を書き換えれば素通りできる
  if o.kind in ('customer','partner_ep1','partner_ep2') and og = '' then
    return jsonb_build_object('ok', false, 'error', '法人名（会社名）をご記入ください。');
  end if;

  final_body := public.contract_fill(o.body, o.email, o.monthly_fee, nm,
                                     (now() at time zone 'Asia/Tokyo')::date, og);

  update public.contract_offers
     set status = 'agreed',
         agreed_at = now(),
         agreed_name = nm,
         agreed_org = nullif(og,''),
         agreed_body = final_body,
         agreed_ua = left(coalesce(p_ua,''), 400)
   where id = o.id;

  return jsonb_build_object('ok', true, 'agreed_at', now());
end;
$$;

revoke all on function public.contract_agree(text, text, text, text) from public;
grant execute on function public.contract_agree(text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------
-- ⑥ 登録後の紐づけ：法人パートナーもパートナーにし、法人名を引き継ぐ
-- ---------------------------------------------------------------
create or replace function public.contract_claim()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  my_email text;
  o        public.contract_offers%rowtype;
  cur      uuid;
begin
  if me is null then return 'error: ログインが必要です'; end if;
  select lower(coalesce(auth.jwt() ->> 'email','')) into my_email;
  if my_email = '' then return 'error: メールアドレスが取れません'; end if;

  select * into o from public.contract_offers
   where lower(email) = my_email and status = 'agreed' and claimed_user_id is null
   order by agreed_at asc limit 1;
  if not found then return 'none'; end if;

  if o.kind in ('partner','partner_ep1','partner_ep2') then
    update public.profiles set role = 'consultant'
     where id = me and role = 'customer';
  else
    select consultant_id into cur from public.profiles where id = me;
    if cur is null and o.consultant_id is not null then
      update public.profiles set consultant_id = o.consultant_id where id = me;
    end if;
  end if;

  --  契約で記名いただいた法人名を、まだ空なら会社名として引き継ぐ。
  --  もう一度入力していただく必要はない。すでに入っていれば触らない
  if o.agreed_org is not null and o.agreed_org <> '' then
    update public.profiles
       set company_name = o.agreed_org
     where id = me and coalesce(company_name,'') = '';
  end if;

  update public.contract_offers set claimed_user_id = me where id = o.id;
  return 'claimed:' || o.kind;
end;
$$;

-- ---------------------------------------------------------------
-- ⑦ 法人パートナーの雛形（EP-I / EP-II。※法的な確認は専門家へ）
-- ---------------------------------------------------------------
insert into public.contract_templates (kind, version, title, body, active)
select 'partner_ep1', 1, 'TsuguAi -継- 法人パートナー契約書［EP-I・顧客基盤型］（仮）',
'本契約は、TsuguAi -継-（以下「当社」）と、下記の法人（以下「パートナー」）との間の、
法人パートナー［EP-I・顧客基盤型］としての業務委託に関する契約です。

■ 契約者
  法人名：{{法人名}}
  ご担当者名：{{お名前}}
  メールアドレス：{{メールアドレス}}
  契約日：{{契約日}}

第1条（目的・形態）
  パートナーは、自らの顧客基盤に対し、当社の提供するプラットフォームを用いた
  経営支援・事業承継支援を行います。顧客との関係はパートナーが保持します。

第2条（担当者の配置）
  パートナーは、顧客ごとに主担当者を定め、当社に届け出るものとします。
  副担当者を置くこともできます。担当者の行為について、パートナーは
  自らの行為と同様の責任を負います。

第3条（報酬）
  顧問料のうちパートナーが受け取る割合、および支払方法は、別途当社が定める
  報酬規程によります。担当者への配分はパートナーの責任において行います。

第4条（禁止事項）
  パートナーおよびその担当者は、法令および当社の理念に反する行為を行っては
  なりません。違反があった場合、当社は警告・契約解除・報酬の不支給等の措置を
  行うことがあります。

第5条（成果の非保証）
  当社およびパートナーは、業績の改善、融資の可否、補助金の採択を保証しません。

第6条（秘密保持）
  パートナーおよびその担当者は、業務上知り得た顧客の情報を第三者に開示して
  はなりません。本条の義務は、契約終了後も存続します。

第7条（契約期間）
  本契約は同意日より1年間とし、いずれからも申し出がない場合は同一条件で
  更新されます。

──────────────────────────────
※ この雛形は、仕組みを動かして確かめるための仮のものです。
   実際の運用前に、必ず専門家のご確認をお願いします。
   報酬の割合は報酬規程に委ねてあります。書面に明記される場合は、
   運営画面の編集から追記してください。', true
where not exists (select 1 from public.contract_templates where kind = 'partner_ep1');

insert into public.contract_templates (kind, version, title, body, active)
select 'partner_ep2', 1, 'TsuguAi -継- 法人パートナー契約書［EP-II・所属営業型］（仮）',
'本契約は、TsuguAi -継-（以下「当社」）と、下記の法人（以下「本部」）との間の、
法人パートナー［EP-II・所属営業型］としての業務委託に関する契約です。

■ 契約者
  法人名：{{法人名}}
  ご担当者名：{{お名前}}
  メールアドレス：{{メールアドレス}}
  契約日：{{契約日}}

第1条（目的・形態）
  本部に所属する認定パートナー（以下「所属パートナー」）が、当社の提供する
  プラットフォームを用いて、中小企業の経営支援・事業承継支援を行います。
  顧客と直接向き合うのは所属パートナーです。

第2条（所属パートナーの届け出）
  本部は、所属パートナーを当社に届け出るものとします。所属パートナーは、
  当社の認定パートナーとしての要件を満たす必要があります。

第3条（報酬）
  所属パートナーが受け取る割合、および本部が受け取る割合と支払方法は、
  別途当社が定める報酬規程によります。

第4条（本部の責任）
  本部は、所属パートナーの業務品質および法令遵守について、監督の責任を
  負います。所属パートナーの行為について、本部は当社に対し責任を負います。

第5条（禁止事項）
  本部および所属パートナーは、法令および当社の理念に反する行為を行っては
  なりません。違反があった場合、当社は警告・契約解除・報酬の不支給等の
  措置を行うことがあります。

第6条（成果の非保証）
  当社、本部および所属パートナーは、業績の改善、融資の可否、補助金の採択を
  保証しません。

第7条（秘密保持）
  本部および所属パートナーは、業務上知り得た顧客の情報を第三者に開示して
  はなりません。本条の義務は、契約終了後も存続します。

第8条（契約期間）
  本契約は同意日より1年間とし、いずれからも申し出がない場合は同一条件で
  更新されます。

──────────────────────────────
※ この雛形は、仕組みを動かして確かめるための仮のものです。
   実際の運用前に、必ず専門家のご確認をお願いします。
   報酬の割合は報酬規程に委ねてあります。書面に明記される場合は、
   運営画面の編集から追記してください。', true
where not exists (select 1 from public.contract_templates where kind = 'partner_ep2');

-- ---------------------------------------------------------------
-- ⑧ すでにある雛形にも、法人名の差し込みを入れておく
-- ---------------------------------------------------------------
--  顧客の雛形には法人名の行が無い。必須にするのに書面に出ないのは、
--  記入していただく意味が薄い
update public.contract_templates
   set body = replace(body,
       '■ 契約者' || chr(10) || '  メールアドレス：{{メールアドレス}}',
       '■ 契約者' || chr(10) || '  法人名：{{法人名}}' || chr(10) || '  メールアドレス：{{メールアドレス}}')
 where kind = 'customer' and body like '%■ 契約者%' and body not like '%{{法人名}}%';

--  認定パートナー（個人）は屋号を任意で。空なら空欄のまま出る
update public.contract_templates
   set body = replace(body,
       '■ 契約者' || chr(10) || '  メールアドレス：{{メールアドレス}}',
       '■ 契約者' || chr(10) || '  屋号・法人名（ある場合）：{{法人名}}' || chr(10) || '  メールアドレス：{{メールアドレス}}')
 where kind = 'partner' and body like '%■ 契約者%' and body not like '%{{法人名}}%';


-- ---------------------------------------------------------------
-- 確認（Run のあとに、これだけ見れば十分）
-- ---------------------------------------------------------------
select
  (select count(*) from public.contract_templates where active)             as 公開中の雛形,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='contract_offers'
      and column_name='agreed_org')                                         as 法人名の欄,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='contract_agree')                as 同意の関数,
  (select count(*) from public.contract_templates
    where active and body like '%{{法人名}}%')                              as 法人名を差し込む雛形;
--  期待値：公開中の雛形=4、法人名の欄=1、同意の関数=1、法人名を差し込む雛形=4
--  「同意の関数=1」が大事。2 だと古い関数が残っていて、画面が古いほうを
--  呼ぶと法人名が入らないまま契約が成立してしまう
-- =============================================================
