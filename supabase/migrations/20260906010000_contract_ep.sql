-- =============================================================
-- EP-I / EP-II の実務に合わせる
-- ---------------------------------------------------------------
--  ① EP-II は二本立てにする
--      本部（法人）との契約と、所属営業（個人）との契約は別物。
--      本部だけ巻いても、実際に顧客と向き合う個人が何にも縛られない。
--      個人だけ巻いても、監督する本部の責任が定まらない。両方要る。
--        partner_ep2        … EP-II 本部（法人）
--        partner_ep2_member … EP-II 所属パートナー（個人）
--
--  ② EP-II だと、ひと目で分かるようにする
--      EP-I は法人が80%、EP-II は個人がLv料率で本部が一律。
--      取り違えて EP-II に80%を払うと、取り戻すのは難しい。
--      だから「どちらなのか」を人が見て分かる形にする。
--      ※ 課金の計算そのものには手を触れない。見え方だけを直す。
--
--  ③ EP-I の顧客契約は、法人が出す
--      EP-I は法人が顧客基盤を持ち、顧客との関係は法人が保持する。
--      担当者が個人の名前で契約を送ると、契約の相手が担当者になってしまう。
--      担当者（staff）からは送れないようにし、法人（manager）だけが送る。
--
--  ④ EP-I の解約は、法人にも届く
--      顧客との契約は法人が持っている。担当者だけが気づいて法人が知らない、
--      という形にはできない。法人の管理者にも見えるようにする。
--      担当者からも見えるままにしてある。知らされない担当者は動けない。
--
-- 先に実行しておく SQL:
--   20260905000000_contracts.sql → 20260906000000_contract_org.sql
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================

-- ---------------------------------------------------------------
-- ① 種別に「EP-II 所属パートナー」を足す
-- ---------------------------------------------------------------
alter table public.contract_templates drop constraint if exists contract_templates_kind_check;
alter table public.contract_templates add  constraint contract_templates_kind_check
  check (kind in ('partner','partner_ep1','partner_ep2','partner_ep2_member','customer'));

alter table public.contract_offers drop constraint if exists contract_offers_kind_check;
alter table public.contract_offers add  constraint contract_offers_kind_check
  check (kind in ('partner','partner_ep1','partner_ep2','partner_ep2_member','customer'));

--  どの法人にひもづく契約か。EP-II の所属パートナー契約で本部名を差し込み、
--  あとから「どの本部の所属だったか」を辿るために持つ
alter table public.contract_offers add column if not exists ep_id uuid;

comment on column public.contract_offers.ep_id is
  'ひもづく法人（ep_orgs）。EP-II 所属パートナー契約と、EP-I が出す顧客契約で使う';

-- ---------------------------------------------------------------
-- ② 差し込みに {{本部名}} を足す
-- ---------------------------------------------------------------
create or replace function public.contract_fill(
  p_body text, p_email text, p_fee numeric, p_name text, p_date date,
  p_org text default null, p_hq text default null)
returns text
language sql
immutable
as $$
  select replace(replace(replace(replace(replace(replace(
    coalesce(p_body,''),
    '{{メールアドレス}}', coalesce(p_email,'')),
    '{{月額}}', case when p_fee is null then '—'
                     else to_char(p_fee,'FM999,999,999') || '円（税別）' end),
    '{{本部名}}', coalesce(nullif(p_hq,''),'＿＿＿＿＿＿＿＿＿＿＿＿')),
    '{{法人名}}', coalesce(nullif(p_org,''),'＿＿＿＿＿＿＿＿＿＿＿＿')),
    '{{お名前}}', coalesce(nullif(p_name,''),'＿＿＿＿＿＿＿＿')),
    '{{契約日}}', case when p_date is null then '＿＿＿年＿＿月＿＿日'
                       else to_char(p_date,'YYYY"年"MM"月"DD"日"') end);
$$;
grant execute on function public.contract_fill(text, text, numeric, text, date, text, text) to authenticated;

-- ---------------------------------------------------------------
-- ③ EP の区分をひと目で分かるようにする
-- ---------------------------------------------------------------
--  「その人が EP-I なのか EP-II なのか」を答える。報酬の取り違えを防ぐため、
--  画面のあちこちで使う。
--  誰にでも答えると所属が漏れるので、運営・本人・同じ法人の管理者だけに返す。
create or replace function public.ep_badge(p_user uuid)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare k text; ok boolean;
begin
  if p_user is null then return null; end if;

  select o.kind into k
    from public.ep_members m
    join public.ep_orgs o on o.id = m.ep_id
   where m.user_id = p_user and m.status = 'active'
   limit 1;
  if k is null then return null; end if;

  --  見てよい人か
  select (
    p_user = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or exists (select 1 from public.ep_members me
                join public.ep_members them on them.ep_id = me.ep_id
               where me.user_id = auth.uid() and me.status = 'active'
                 and me.seat_role = 'manager'
                 and them.user_id = p_user and them.status = 'active')
  ) into ok;
  if not ok then return null; end if;

  return k;   -- 'EP1' または 'EP2'
end;
$$;
revoke all on function public.ep_badge(uuid) from public;
grant execute on function public.ep_badge(uuid) to authenticated;

comment on function public.ep_badge(uuid) is
  'その人の法人区分（EP1/EP2）。報酬の取り違えを防ぐため画面に出す。所属していなければ null';

-- ---------------------------------------------------------------
-- ④ EP-I の担当者（staff）からは顧客契約を送れないようにする
-- ---------------------------------------------------------------
--  EP-I は顧客との関係を法人が持つ。担当者が自分の名前で契約を送ると、
--  契約の相手が担当者個人になってしまう。法人（manager）だけが送る。
create or replace function public.ep_may_send_customer_contract()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  --  EP-I に所属していて、かつ管理者でない人だけを止める。
  --  個人の認定パートナーも、EP-II の所属パートナーも、EP-I の管理者も送れる
  select not exists (
    select 1
      from public.ep_members m
      join public.ep_orgs o on o.id = m.ep_id
     where m.user_id = auth.uid()
       and m.status = 'active'
       and o.kind = 'EP1'
       and m.seat_role <> 'manager'
  );
$$;
revoke all on function public.ep_may_send_customer_contract() from public;
grant execute on function public.ep_may_send_customer_contract() to authenticated;

drop policy if exists "contract_offers partner insert" on public.contract_offers;
create policy "contract_offers partner insert" on public.contract_offers
  for insert to authenticated
  with check (
    offered_by = auth.uid()
    and kind = 'customer'
    and exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'consultant')
    and public.ep_may_send_customer_contract()
  );

-- ---------------------------------------------------------------
-- ⑤ EP-I の解約は、法人の管理者にも届く
-- ---------------------------------------------------------------
--  顧客との契約は法人が持っている。担当者だけが気づいて法人が知らない、
--  という形にはできない。担当者からも見えるままにしてある——
--  知らされない担当者は動けない。
create or replace function public.cancel_partner_can_see(p_customer uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    --  これまでどおり、担当パートナー本人
    exists (
      select 1 from public.profiles
       where id = p_customer and consultant_id = auth.uid()
    )
    --  EP-I の管理者は、自法人の顧問先ぶんも
    or exists (
      select 1
        from public.ep_clients c
        join public.ep_orgs   o on o.id = c.ep_id
        join public.ep_members m on m.ep_id = c.ep_id
       where c.customer_id = p_customer
         and c.status = 'active'
         and o.kind = 'EP1'
         and m.user_id = auth.uid()
         and m.status = 'active'
         and m.seat_role = 'manager'
    );
$$;

comment on function public.cancel_partner_can_see(uuid) is
  '解約のご依頼を見てよいか。担当パートナー本人と、EP-I の法人管理者';

-- ---------------------------------------------------------------
-- ⑥ 開いたときに、本部名と種別も返す
-- ---------------------------------------------------------------
create or replace function public.contract_open(p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  o  public.contract_offers%rowtype;
  hq text;
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

  if o.ep_id is not null then
    select name into hq from public.ep_orgs where id = o.ep_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'kind', o.kind,
    'email', o.email,
    'title', o.title,
    'body', case when o.status = 'agreed' then o.agreed_body
                 else public.contract_fill(o.body, o.email, o.monthly_fee, null, null, null, hq) end,
    'monthly_fee', o.monthly_fee,
    'hq_name', hq,
    'org_required', (o.kind in ('customer','partner_ep1','partner_ep2')),
    'status', o.status,
    'agreed_at', o.agreed_at,
    'agreed_name', o.agreed_name,
    'agreed_org', o.agreed_org
  );
end;
$$;

-- ---------------------------------------------------------------
-- ⑦ 同意：本部名も差し込む
-- ---------------------------------------------------------------
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
  hq text;
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

  --  EP-II の所属パートナー（個人）は、法人名は要らない。
  --  本部名は契約に持っているので、こちらで差し込む
  if o.kind in ('customer','partner_ep1','partner_ep2') and og = '' then
    return jsonb_build_object('ok', false, 'error', '法人名（会社名）をご記入ください。');
  end if;

  if o.ep_id is not null then
    select name into hq from public.ep_orgs where id = o.ep_id;
  end if;

  final_body := public.contract_fill(o.body, o.email, o.monthly_fee, nm,
                                     (now() at time zone 'Asia/Tokyo')::date, og, hq);

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

-- ---------------------------------------------------------------
-- ⑧ EP-II 所属パートナーの雛形（※法的な確認は専門家へ）
-- ---------------------------------------------------------------
insert into public.contract_templates (kind, version, title, body, active)
select 'partner_ep2_member', 1, 'TsuguAi -継- 認定パートナー契約書［EP-II 所属］（仮）',
'本契約は、TsuguAi -継-（以下「当社」）と、下記の方（以下「所属パートナー」）との間の、
EP-II 所属の認定パートナーとしての業務委託に関する契約です。

■ 契約者
  所属本部：{{本部名}}
  お名前：{{お名前}}
  メールアドレス：{{メールアドレス}}
  契約日：{{契約日}}

第1条（目的・形態）
  所属パートナーは、上記の本部に所属したうえで、当社の提供するプラットフォームを
  用いて、中小企業の経営支援・事業承継支援を行います。顧客と直接向き合うのは
  所属パートナーです。

第2条（本部との関係）
  所属パートナーは、本部の監督のもとで業務を行います。本部との間の取り決めは、
  本契約とは別に、本部と所属パートナーの間で定めるものとします。

第3条（報酬）
  所属パートナーが受け取る割合、および支払方法は、別途当社が定める報酬規程に
  よります。<<EP-II の区分であるため、EP-I（顧客基盤型）とは異なる料率が
  適用されます。>>

第4条（禁止事項）
  所属パートナーは、法令および当社の理念に反する行為を行ってはなりません。
  違反があった場合、当社は警告・契約解除・報酬の不支給等の措置を行うことがあります。

第5条（成果の非保証）
  当社および所属パートナーは、業績の改善、融資の可否、補助金の採択を保証しません。

第6条（秘密保持）
  所属パートナーは、業務上知り得た顧客の情報を第三者に開示してはなりません。
  本条の義務は、契約終了後も存続します。

第7条（本部からの離脱）
  所属パートナーが本部から離れた場合、本契約は終了します。個人の認定パートナー
  として継続を希望される場合は、あらためて当社との契約が必要です。

第8条（契約期間）
  本契約は同意日より1年間とし、いずれからも申し出がない場合は同一条件で
  更新されます。

──────────────────────────────
※ この雛形は、仕組みを動かして確かめるための仮のものです。
   実際の運用前に、必ず専門家のご確認をお願いします。
   << >> で囲んだところは注意書きです。文面を整える際にご確認ください。', true
where not exists (select 1 from public.contract_templates where kind = 'partner_ep2_member');


-- ---------------------------------------------------------------
-- 確認（Run のあとに、これだけ見れば十分）
-- ---------------------------------------------------------------
select
  (select count(*) from public.contract_templates where active)             as 公開中の雛形,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='contract_offers'
      and column_name='ep_id')                                              as 法人の欄,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ep_badge')                      as 区分の判定,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ep_may_send_customer_contract') as 発行の判定;
--  期待値：公開中の雛形=5、法人の欄=1、区分の判定=1、発行の判定=1
-- =============================================================
