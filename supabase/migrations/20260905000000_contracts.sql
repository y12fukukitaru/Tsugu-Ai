-- =============================================================
-- Web上での契約締結：URLを送る → 読む → 記名して同意 → そのまま登録
-- ---------------------------------------------------------------
--  いまは signup_codes（役割の付与）と customer_invites（担当の紐づけ）が
--  あるだけで、「合意した記録」がどこにも残らない。ここを埋める。
--
--  トークン付きのURLが「誰宛で・どの役割で・誰が担当で・どの契約か」を
--  全部持つ。受け取った人は、URLを開いて読んで、記名して同意するだけ。
--  そのまま登録に進むと、役割も担当も自動で付く。
--
--  ■ 証拠として何を残すか
--    あとから要るのは「誰が・いつ・どの書面に同意したか」。だから
--    同意した瞬間の本文を、置換まで済ませた形で丸ごと写し取って保存する
--    （agreed_body）。テンプレートをあとで直しても、過去の同意は当時の
--    書面を指したまま動かない。版番号だけを持つやり方では、本文が
--    書き換わったときに「何に同意したのか」を示せなくなる。
--
--  ■ ログインしていない人が読む
--    同意は登録の前に行う。つまり anon（未ログイン）が本文を読める必要が
--    ある。表にはさわらせず、SECURITY DEFINER の関数だけを通す。
--    トークンは推測できない長さにしてある。
--
--  ※ 契約書の本文と、それが法的に有効かどうかは専門家にご確認ください。
--    ここで用意している雛形は、動かして確かめるための仮のものです。
--    運営画面から差し替えられます。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           一度だけ。二度流しても壊れない。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 契約書のひな型（版で管理する）
-- ---------------------------------------------------------------
create table if not exists public.contract_templates (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('partner','customer')),
  version     int  not null,
  title       text not null,
  body        text not null,
  --  公開中の版。ここが true のものが、これから送る契約に使われる
  active      boolean not null default false,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (kind, version)
);

--  公開中は種類ごとに一つ。二つあると、どちらで送られたか分からなくなる
create unique index if not exists contract_templates_active_uniq
  on public.contract_templates (kind) where active;

alter table public.contract_templates enable row level security;

grant select, insert, update on public.contract_templates to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.contract_templates to service_role';
  end if;
end $do$;

--  運営だけが書ける。パートナーは自分が送るときの本文を読む必要があるので、
--  公開中のものだけ読める
drop policy if exists "contract_templates admin" on public.contract_templates;
create policy "contract_templates admin" on public.contract_templates
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "contract_templates read active" on public.contract_templates;
create policy "contract_templates read active" on public.contract_templates
  for select to authenticated using (active);


-- ---------------------------------------------------------------
-- ② 送った契約（トークン付きURLの実体）
-- ---------------------------------------------------------------
create table if not exists public.contract_offers (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('partner','customer')),
  --  URLに載る合言葉。推測できない長さにする
  token         text not null unique check (length(token) >= 32),
  email         text not null,

  --  送った時点のひな型を写し取る。あとで直されても、送った書面は動かない
  template_id      uuid references public.contract_templates(id),
  template_version int,
  title            text not null,
  body             text not null,

  --  顧客契約の条件。月額は選ばないと送れない（画面側でも縛る）
  monthly_fee   numeric,
  --  顧客契約のとき、同意した人の担当になるパートナー
  consultant_id uuid,

  offered_by    uuid not null,
  status        text not null default 'sent'
                check (status in ('sent','agreed','cancelled')),
  sent_at       timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '30 days'),

  --  同意の記録。ここが証拠になる
  agreed_at     timestamptz,
  agreed_name   text,
  agreed_body   text,          --  置換まで済ませた、同意した書面そのもの
  agreed_ua     text,
  claimed_user_id uuid,        --  登録して結びついた利用者

  created_at    timestamptz not null default now()
);

create index if not exists contract_offers_email_idx
  on public.contract_offers (lower(email), status);
create index if not exists contract_offers_by_idx
  on public.contract_offers (offered_by, created_at desc);

alter table public.contract_offers enable row level security;

grant select, insert, update on public.contract_offers to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.contract_offers to service_role';
  end if;
end $do$;

--  運営はすべて見える（ご要望の「契約は運営で確認できるように」）
drop policy if exists "contract_offers admin" on public.contract_offers;
create policy "contract_offers admin" on public.contract_offers
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

--  パートナーは自分が送ったものだけ
drop policy if exists "contract_offers own sent" on public.contract_offers;
create policy "contract_offers own sent" on public.contract_offers
  for select to authenticated using (offered_by = auth.uid());

--  パートナーが顧客契約を送る。パートナー契約（kind='partner'）は運営だけ
drop policy if exists "contract_offers partner insert" on public.contract_offers;
create policy "contract_offers partner insert" on public.contract_offers
  for insert to authenticated
  with check (
    offered_by = auth.uid()
    and kind = 'customer'
    and exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'consultant')
  );

--  送ったあとに取り消せる（相手が同意する前だけ。画面側でも縛る）
drop policy if exists "contract_offers own cancel" on public.contract_offers;
create policy "contract_offers own cancel" on public.contract_offers
  for update to authenticated
  using (offered_by = auth.uid() and status = 'sent')
  with check (offered_by = auth.uid() and status in ('sent','cancelled'));

--  同意した本人も、自分の契約書をあとから読み返せる
drop policy if exists "contract_offers mine read" on public.contract_offers;
create policy "contract_offers mine read" on public.contract_offers
  for select to authenticated using (claimed_user_id = auth.uid());


-- ---------------------------------------------------------------
-- ③ 未ログインの人が読む・同意する（関数だけを通す）
-- ---------------------------------------------------------------
--  差し込み。運営が本文に {{月額}} などと書いておけば、そこに入る。
--  書かなくても、画面には条件の枠として別に出す
create or replace function public.contract_fill(
  p_body text, p_email text, p_fee numeric, p_name text, p_date date)
returns text
language sql
immutable
as $$
  select replace(replace(replace(replace(
    coalesce(p_body,''),
    '{{メールアドレス}}', coalesce(p_email,'')),
    '{{月額}}', case when p_fee is null then '—'
                     else to_char(p_fee,'FM999,999,999') || '円（税別）' end),
    '{{お名前}}', coalesce(nullif(p_name,''),'＿＿＿＿＿＿＿＿')),
    '{{契約日}}', case when p_date is null then '＿＿＿年＿＿月＿＿日'
                       else to_char(p_date,'YYYY"年"MM"月"DD"日"') end);
$$;

--  URLを開いたときに見えるもの。トークンを知っている人だけが読める
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
  --  期限切れでも、すでに同意済みなら読み返せる。読めなくなるほうが困る
  if o.status = 'sent' and o.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'この契約書の有効期限が切れています。送り主に再発行をご依頼ください。');
  end if;
  return jsonb_build_object(
    'ok', true,
    'kind', o.kind,
    'email', o.email,
    'title', o.title,
    'body', case when o.status = 'agreed' then o.agreed_body
                 else public.contract_fill(o.body, o.email, o.monthly_fee, null, null) end,
    'monthly_fee', o.monthly_fee,
    'status', o.status,
    'agreed_at', o.agreed_at,
    'agreed_name', o.agreed_name
  );
end;
$$;

--  同意する。ここで契約が成立し、書面が確定する
create or replace function public.contract_agree(p_token text, p_name text, p_ua text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.contract_offers%rowtype;
  final_body text;
begin
  if coalesce(btrim(p_name),'') = '' then
    return jsonb_build_object('ok', false, 'error', 'お名前をご記入ください。');
  end if;

  --  同時に二度押されても一度だけ通す
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

  --  契約日は同意した日。入力させない（打ち間違いも、遡っての記入も防ぐ）
  final_body := public.contract_fill(o.body, o.email, o.monthly_fee,
                                     btrim(p_name), (now() at time zone 'Asia/Tokyo')::date);

  update public.contract_offers
     set status = 'agreed',
         agreed_at = now(),
         agreed_name = btrim(p_name),
         agreed_body = final_body,
         agreed_ua = left(coalesce(p_ua,''), 400)
   where id = o.id;

  return jsonb_build_object('ok', true, 'agreed_at', now());
end;
$$;

--  登録したあとに呼ぶ。同意済みの契約を自分に結びつけ、役割と担当を付ける。
--  claim_my_invite と同じ考え方（自分宛のものだけ、まだ担当がいないときだけ）
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

  --  自分宛の、同意済みで、まだ誰にも結びついていないもの。古いものから
  select * into o from public.contract_offers
   where lower(email) = my_email and status = 'agreed' and claimed_user_id is null
   order by agreed_at asc limit 1;
  if not found then return 'none'; end if;

  if o.kind = 'partner' then
    --  パートナー契約に同意した人を、認定パートナーにする。
    --  すでに運営や別の役割になっている人は触らない（降格させない）
    update public.profiles set role = 'consultant'
     where id = me and role = 'customer';
  else
    --  顧客契約。すでに担当がいるなら触らない
    select consultant_id into cur from public.profiles where id = me;
    if cur is null and o.consultant_id is not null then
      update public.profiles set consultant_id = o.consultant_id where id = me;
    end if;
  end if;

  update public.contract_offers set claimed_user_id = me where id = o.id;
  return 'claimed:' || o.kind;
end;
$$;

revoke all on function public.contract_open(text) from public;
revoke all on function public.contract_agree(text, text, text) from public;
revoke all on function public.contract_claim() from public;
--  同意は登録の前に行う。だから未ログイン（anon）でも呼べる必要がある
grant execute on function public.contract_open(text)  to anon, authenticated;
grant execute on function public.contract_agree(text, text, text) to anon, authenticated;
grant execute on function public.contract_claim() to authenticated;
grant execute on function public.contract_fill(text, text, numeric, text, date) to authenticated;

comment on table public.contract_templates is '契約書のひな型。版で管理し、公開中のものが送信に使われる';
comment on table public.contract_offers   is '送った契約。同意した書面そのものを写し取って残す';


-- ---------------------------------------------------------------
-- ④ 動かして確かめるための雛形（※法的な確認は専門家へ）
-- ---------------------------------------------------------------
insert into public.contract_templates (kind, version, title, body, active)
select 'partner', 1, 'TsuguAi -継- 認定パートナー契約書（仮）',
'本契約は、TsuguAi -継-（以下「当社」）と、下記の方（以下「パートナー」）との間の、
認定パートナーとしての業務委託に関する契約です。

■ 契約者
  メールアドレス：{{メールアドレス}}
  お名前：{{お名前}}
  契約日：{{契約日}}

第1条（目的）
  パートナーは、当社の提供するプラットフォームを用いて、中小企業の経営者に対する
  経営支援・事業承継支援を行います。

第2条（報酬）
  報酬の額および支払方法は、別途当社が定める報酬規程によります。

第3条（禁止事項）
  パートナーは、法令および当社の理念に反する行為を行ってはなりません。
  違反があった場合、当社は警告・契約解除・報酬の不支給等の措置を行うことがあります。

第4条（成果の非保証）
  当社およびパートナーは、業績の改善、融資の可否、補助金の採択を保証しません。

第5条（秘密保持）
  パートナーは、業務上知り得た顧客の情報を第三者に開示してはなりません。
  本条の義務は、契約終了後も存続します。

第6条（契約期間）
  本契約は同意日より1年間とし、いずれからも申し出がない場合は同一条件で更新されます。

──────────────────────────────
※ この雛形は、仕組みを動かして確かめるための仮のものです。
   実際の運用前に、必ず専門家のご確認をお願いします。
   運営画面から差し替えられます。', true
where not exists (select 1 from public.contract_templates where kind = 'partner');

insert into public.contract_templates (kind, version, title, body, active)
select 'customer', 1, 'TsuguAi -継- 顧問契約書（仮）',
'本契約は、TsuguAi -継- の認定パートナー（以下「甲」）と、下記の会社（以下「乙」）との間の、
経営支援に関する顧問契約です。

■ 契約者
  メールアドレス：{{メールアドレス}}
  お名前：{{お名前}}
  契約日：{{契約日}}
  顧問料：月額 {{月額}}

第1条（目的）
  甲は乙に対し、財務・資金繰りの見える化、経営課題の整理、事業承継の準備等の
  支援を行います。

第2条（顧問料）
  乙は甲に対し、前記の顧問料を毎月お支払いいただきます。
  お支払いの方法および期日は、別途ご案内します。

第3条（成果の非保証）
  甲は、業績の改善、融資の可否、補助金の採択を保証しません。

第4条（秘密保持）
  甲は、業務上知り得た乙の情報を第三者に開示しません。
  本条の義務は、契約終了後も存続します。

第5条（契約期間・解約）
  本契約は同意日より1年間とし、いずれからも申し出がない場合は同一条件で更新されます。
  乙は、画面の「解約を依頼する」からいつでもお申し出いただけます。

──────────────────────────────
※ この雛形は、仕組みを動かして確かめるための仮のものです。
   実際の運用前に、必ず専門家のご確認をお願いします。
   運営画面から差し替えられます。', true
where not exists (select 1 from public.contract_templates where kind = 'customer');


-- ---------------------------------------------------------------
-- 確認（Run のあとに、これだけ見れば十分）
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='contract_offers')          as 契約の表,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='contract_offers')             as 権限の本数,
  (select count(*) from public.contract_templates where active)            as 公開中の雛形,
  (select count(*) from information_schema.role_routine_grants
    where routine_schema='public' and routine_name='contract_open'
      and grantee='anon')                                                  as 未ログインで読める;
--  期待値：契約の表=1、権限の本数=5、公開中の雛形=2、未ログインで読める=1
-- =============================================================
