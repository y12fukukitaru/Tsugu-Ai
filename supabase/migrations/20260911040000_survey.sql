-- =============================================================
-- 四半期アンケート（匿名）と、初期導入費の定義を契約書ひな形に足す
-- ---------------------------------------------------------------
--  ① アンケート
--   3か月に一度、経営者とパートナーに「3分アンケート」をお願いする。
--   問いは相手ごとに分け、答えは匿名で持つ。
--
--   匿名のしくみ：
--     survey_responses … 答え（誰が答えたかは持たない。日付も日単位に丸める）
--     survey_done      … 「この期は答えた」の印（誰が・いつ。答えとは結ばない）
--   二つを別の表に分け、書き込みは survey_submit（security definer）だけが
--   同じトランザクションで行う。運営が読めるのは答えの表だけで、印の表は
--   「何人が答えたか」を数えるのにしか使えない。
--
--   受付期間（survey_window）：
--     四半期の最初の月の 1〜21 日に、前の四半期について聞く
--     （10/1〜21 に 2026-Q3、1/1〜21 に 2026-Q4 …）。
--     運営が app_settings.survey_open に {period, until} を置けば、その日まで
--     期間外でも開く（ローンチ直後に一度聞きたいときなど）。
--
--  ② 初期導入費の定義（顧問契約書ひな形）
--   「初期導入費は、はじめの90日（土台づくり）で担当パートナーと運営が動く
--   ぶんの費用」を条文として足した新しい版を公開する。
--   いま公開中の本文に「初期導入費」の語が無いときだけ。手で直してあれば触らない。
--
--  確かめかた：表=2、関数=3、契約書に初期導入費=1
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。
--   このあと Edge Function を配り直す：
--   supabase functions deploy agent-heartbeat --no-verify-jwt
--   supabase functions deploy line-webhook --no-verify-jwt
-- =============================================================

-- ---------------------------------------------------------------
-- ① 表
-- ---------------------------------------------------------------
create table if not exists public.survey_responses (
  id          uuid primary key default gen_random_uuid(),
  audience    text not null check (audience in ('customer','consultant')),
  period      text not null,                        -- 例 2026-Q3
  answers     jsonb not null,                       -- {"q1":4,"q2":5,...} 1〜5
  comment     text,
  answered_on date not null default (now() at time zone 'Asia/Tokyo')::date
);
comment on table public.survey_responses is
  '四半期アンケートの答え（匿名）。誰が答えたかは持たない。書き込みは survey_submit だけ';

create table if not exists public.survey_done (
  user_id  uuid not null references auth.users(id) on delete cascade,
  period   text not null,
  done_at  timestamptz not null default now(),
  primary key (user_id, period)
);
comment on table public.survey_done is
  '「この期は答えた」の印。答えとは結ばない。二度お願いしないためだけに使う';

alter table public.survey_responses enable row level security;
alter table public.survey_done      enable row level security;

drop policy if exists "survey responses admin read" on public.survey_responses;
create policy "survey responses admin read" on public.survey_responses
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "survey done own read" on public.survey_done;
create policy "survey done own read" on public.survey_done
  for select to authenticated
  using (user_id = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ---------------------------------------------------------------
-- ② 受付期間
-- ---------------------------------------------------------------
create or replace function public.survey_window()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d      date := (now() at time zone 'Asia/Tokyo')::date;
  q1     date := date_trunc('quarter', d)::date;        -- この四半期の初日
  prevq  date := (q1 - interval '3 months')::date;      -- 前の四半期の初日
  ov     jsonb;
  ovu    date;
begin
  --  運営の手動オープンが生きていれば、それが勝つ
  select value into ov from public.app_settings where key = 'survey_open';
  if ov is not null and coalesce(ov->>'period','') <> '' then
    begin ovu := (ov->>'until')::date; exception when others then ovu := null; end;
    if ovu is not null and ovu >= d then
      return jsonb_build_object('open', true, 'period', ov->>'period', 'until', ovu::text, 'manual', true);
    end if;
  end if;
  --  四半期の最初の月の 1〜21 日
  if d - q1 < 21 then
    return jsonb_build_object('open', true,
      'period', to_char(prevq, 'YYYY') || '-Q' || extract(quarter from prevq)::int,
      'until', (q1 + 20)::text, 'manual', false);
  end if;
  return jsonb_build_object('open', false,
    'period', to_char(q1, 'YYYY') || '-Q' || extract(quarter from q1)::int,
    'next', (q1 + interval '3 months')::date::text, 'manual', false);
end;
$$;

-- ---------------------------------------------------------------
-- ③ 答える（本人用と、LINE から service_role が代わりに呼ぶ内部用）
-- ---------------------------------------------------------------
create or replace function public.survey_submit_for(
  p_user uuid, p_period text, p_answers jsonb, p_comment text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r     text;
  w     jsonb;
  k     text;
  v     numeric;
begin
  if p_user is null then return 'error: ログインが必要です'; end if;
  select role into r from public.profiles where id = p_user;
  if r not in ('customer','consultant') then
    return 'error: アンケートは経営者とパートナーにお願いしています';
  end if;
  w := public.survey_window();
  if not coalesce((w->>'open')::boolean, false) or (w->>'period') <> coalesce(p_period,'') then
    return 'error: いまは受付期間ではありません';
  end if;
  if exists (select 1 from public.survey_done where user_id = p_user and period = p_period) then
    return 'error: この期の回答は受け付け済みです。ありがとうございました';
  end if;
  --  q1〜q5 がそろって 1〜5 であること
  if jsonb_typeof(p_answers) <> 'object' then return 'error: 答えの形が違います'; end if;
  foreach k in array array['q1','q2','q3','q4','q5'] loop
    begin v := (p_answers->>k)::numeric; exception when others then v := null; end;
    if v is null or v < 1 or v > 5 or v <> floor(v) then
      return 'error: 5つの問いすべてに 1〜5 でお答えください';
    end if;
  end loop;
  --  答えと印は別の表。ここが匿名の要
  insert into public.survey_responses (audience, period, answers, comment)
  values (r, p_period,
          jsonb_build_object('q1',(p_answers->>'q1')::int,'q2',(p_answers->>'q2')::int,
                             'q3',(p_answers->>'q3')::int,'q4',(p_answers->>'q4')::int,
                             'q5',(p_answers->>'q5')::int),
          nullif(left(btrim(coalesce(p_comment,'')), 1000), ''));
  insert into public.survey_done (user_id, period) values (p_user, p_period);
  return 'ok';
end;
$$;

create or replace function public.survey_submit(p_period text, p_answers jsonb, p_comment text default null)
returns text
language sql
security definer
set search_path = public
as $$
  select public.survey_submit_for(auth.uid(), p_period, p_answers, p_comment);
$$;

revoke all on function public.survey_window()                             from public, anon;
revoke all on function public.survey_submit(text, jsonb, text)            from public, anon;
revoke all on function public.survey_submit_for(uuid, text, jsonb, text)  from public, anon, authenticated;
grant execute on function public.survey_window()                          to authenticated;
grant execute on function public.survey_submit(text, jsonb, text)         to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.survey_submit_for(uuid, text, jsonb, text) to service_role';
    execute 'grant execute on function public.survey_window() to service_role';
  end if;
end $do$;

-- ---------------------------------------------------------------
-- ④ 初期導入費の定義を、顧問契約書ひな形の新しい版として公開
-- ---------------------------------------------------------------
do $do$
declare
  cur  public.contract_templates%rowtype;
  nb   text;
  nv   int;
begin
  select * into cur from public.contract_templates
   where kind = 'customer' and active = true
   order by version desc limit 1;
  if not found then return; end if;
  if position('初期導入費' in cur.body) > 0 then return; end if;   -- もう書いてある

  nb := cur.body;
  if position('第3条（成果の非保証）' in nb) > 0 then
    nb := replace(nb, '第3条（成果の非保証）',
      '第2条の2（初期導入費）' || E'\n' ||
      '  乙は甲に対し、初期導入費（初回のみ・金額は別途ご案内）をお支払いいただきます。' || E'\n' ||
      '  初期導入費は、契約後のはじめの90日（土台づくり）において、甲および運営が' || E'\n' ||
      '  乙の試算表・保険証券・借入一覧等をお預かりし、数字が見える状態まで整える' || E'\n' ||
      '  作業に要する費用であり、月額の顧問料には含まれません。' || E'\n\n' ||
      '第3条（成果の非保証）');
  else
    nb := nb || E'\n\n' ||
      '（初期導入費）' || E'\n' ||
      '  初期導入費（初回のみ）は、契約後のはじめの90日（土台づくり）において、' || E'\n' ||
      '  担当パートナーおよび運営が試算表・保険証券・借入一覧等をお預かりし、' || E'\n' ||
      '  数字が見える状態まで整える作業に要する費用であり、月額の顧問料には含まれません。';
  end if;

  select coalesce(max(version),0) + 1 into nv from public.contract_templates where kind = 'customer';
  update public.contract_templates set active = false where kind = 'customer' and active = true;
  insert into public.contract_templates (kind, version, title, body, active, created_by)
  values ('customer', nv, cur.title, nb, true, cur.created_by);
end $do$;

-- ---------------------------------------------------------------
-- ⑤ 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name in ('survey_responses','survey_done'))      as "表",
  (select count(*) from information_schema.routines
    where routine_schema='public' and routine_name in ('survey_window','survey_submit','survey_submit_for')) as "関数",
  (select count(*) from public.contract_templates
    where kind='customer' and active and position('初期導入費' in body) > 0)                as "契約書に初期導入費";
--  期待値：表=2、関数=3、契約書に初期導入費=1
-- =============================================================
