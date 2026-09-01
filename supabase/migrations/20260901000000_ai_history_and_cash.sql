-- =============================================================
-- 相談の記録を残し、社長が手元資金をひと言で伝えられるようにする
-- ---------------------------------------------------------------
--  これまで継ナビくんとの会話は、その端末のブラウザの中にだけ、しかも
--  最長30日しか残っていなかった。機種を替えれば消え、パソコンで話した
--  続きをスマホで読むこともできない。
--
--  いちばん惜しいのは、担当パートナーに何も伝わらないことだった。
--  社長が夜中に「資金繰りが不安だ」と打ち明けていても、翌週の面談で
--  パートナーはそれを知らない。毎晩生まれている、いちばん大事な材料が
--  そのまま捨てられていた。
--
--  そこで3つ作る。
--
--    ai_messages   … 相談そのもの。本人だけが読める
--    ai_shares     … 本人が「これは伝えたい」と押したぶんだけ、担当へ
--    cash_checkins … 社長がひと言で入れる、いまの手元資金
--
--  ■ ai_messages を本人だけにする理由
--    全部がパートナーに見えると分かった瞬間、社長は継ナビくんに本音を
--    書かなくなる。夜中に弱音を吐ける場所であることが、この機能の価値
--    そのものなので、運営も含めて誰にも読ませない。
--    伝えるかどうかは、そのつど本人が決める（それが ai_shares）。
--
--  ■ ai_shares を写しにする理由
--    共有したあとで本人が履歴を消すことがある。参照で持つと、そのとき
--    パートナーの手元から消える。「伝えた」という事実は残るべきなので、
--    そのときの文面をそのまま写して持つ。
--
--  ■ 添付の絵を持たない理由
--    画面の写しは一枚で数MBになる。名前と種類だけ残し、絵は残さない。
--    後から見返すのは「何を聞いたか」であって、絵そのものではない。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になる。
-- =============================================================


-- ---------------------------------------------------------------
-- 1. 相談の記録
-- ---------------------------------------------------------------
create table if not exists public.ai_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  --  同じ人でも、運営が経営者の画面を確かめているときは分けて残す
  portal     text not null default 'customer',
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  --  添付は名前と種類だけ。絵そのものは持たない
  att_name   text,
  att_type   text,
  --  「じっくり考えて回答」などの札。あとで読み返すときの手がかり
  model      text,
  created_at timestamptz not null default now()
);

--  「この人の、この画面の会話を、古い順に」がいちばん多い引き方
create index if not exists ai_messages_user_idx
  on public.ai_messages (user_id, portal, created_at);

alter table public.ai_messages enable row level security;

-- ---- 本人だけ。パートナーも運営も読めない ----
drop policy if exists "ai_messages own" on public.ai_messages;
create policy "ai_messages own" on public.ai_messages
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.ai_messages is
  '継ナビくんとの相談。本人以外は運営も含めて読めない。伝えたいぶんだけ ai_shares に写す';


-- ---------------------------------------------------------------
-- 2. 本人が担当パートナーに伝えると決めた相談
-- ---------------------------------------------------------------
create table if not exists public.ai_shares (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  --  そのときの問いと答えを、そのまま写して持つ
  question    text not null,
  answer      text not null,
  --  「ここが特に気になっています」など、本人からの添え書き
  note        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists ai_shares_cust_idx
  on public.ai_shares (customer_id, created_at desc);

alter table public.ai_shares enable row level security;

-- ---- 顧客本人：自分が伝えたぶんを読める。取り消しもできる ----
drop policy if exists "ai_shares own" on public.ai_shares;
create policy "ai_shares own" on public.ai_shares
  for all to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

-- ---- 担当パートナー・運営：読めて、既読を付けられる ----
--  ヘルパー関数に頼らず、この1本で完結させる。
drop policy if exists "ai_shares staff read" on public.ai_shares;
create policy "ai_shares staff read" on public.ai_shares
  for select to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.id = ai_shares.customer_id
               and p.consultant_id = auth.uid())
    or exists (select 1 from public.partner_assignments a
             where a.customer_id = ai_shares.customer_id
               and a.status = 'approved'
               and (a.main_id = auth.uid() or a.sub_id = auth.uid()))
    or exists (select 1 from public.profiles me
             where me.id = auth.uid() and me.role = 'admin')
  );

drop policy if exists "ai_shares staff mark read" on public.ai_shares;
create policy "ai_shares staff mark read" on public.ai_shares
  for update to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.id = ai_shares.customer_id
               and p.consultant_id = auth.uid())
    or exists (select 1 from public.partner_assignments a
             where a.customer_id = ai_shares.customer_id
               and a.status = 'approved'
               and (a.main_id = auth.uid() or a.sub_id = auth.uid()))
    or exists (select 1 from public.profiles me
             where me.id = auth.uid() and me.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p
             where p.id = ai_shares.customer_id
               and p.consultant_id = auth.uid())
    or exists (select 1 from public.partner_assignments a
             where a.customer_id = ai_shares.customer_id
               and a.status = 'approved'
               and (a.main_id = auth.uid() or a.sub_id = auth.uid()))
    or exists (select 1 from public.profiles me
             where me.id = auth.uid() and me.role = 'admin')
  );

--  担当が触ってよいのは「読んだ印」だけ。問いと答えは社長の言葉なので、
--  受け取った側が書き換えられてはならない。権限の設定だけで守ろうとすると、
--  列ごとの許可が別のところで広く与えられていたときにすり抜ける。
--  ここで止める。
create or replace function public.ai_shares_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is distinct from old.customer_id then
    if new.question is distinct from old.question
       or new.answer   is distinct from old.answer
       or new.note     is distinct from old.note
       or new.customer_id is distinct from old.customer_id
       or new.created_at  is distinct from old.created_at then
      raise exception '共有された相談の中身は、書いた本人以外は変えられません';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ai_shares_guard_trg on public.ai_shares;
create trigger ai_shares_guard_trg
  before update on public.ai_shares
  for each row execute function public.ai_shares_guard();

comment on table public.ai_shares is
  '顧客が「これは担当に伝えたい」と押した相談の写し。押されたぶんだけが担当に見える';


-- ---------------------------------------------------------------
-- 3. 手元資金のひと言（30秒入力）
-- ---------------------------------------------------------------
--  試算表は月に一度しか入らない。けれど社長が本当に不安なのは
--  「今月末、払えるか」で、これは週ごとに動く。数字ひとつだけを
--  そのつど入れてもらい、継ナビくんと担当パートナーの両方が
--  生きた数字を見られるようにする。
--
--  単位は万円。画面のほかの数字とそろえる。
create table if not exists public.cash_checkins (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  --  いまの手元資金（万円）。マイナスは無いが、0 はありうる
  balance     bigint not null check (balance >= 0),
  --  「来週に大きな支払いがある」など、ひと言だけ
  note        text,
  --  日本時間のその日。1日に何度直しても1行に保つ
  on_date     date not null default ((now() at time zone 'Asia/Tokyo')::date),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

--  同じ日に入れ直したら上書きになるように
create unique index if not exists cash_checkins_cust_date_uniq
  on public.cash_checkins (customer_id, on_date);

create index if not exists cash_checkins_cust_idx
  on public.cash_checkins (customer_id, on_date desc);

alter table public.cash_checkins enable row level security;

-- ---- 顧客本人：自分のぶんを読み書きできる ----
drop policy if exists "cash_checkins own" on public.cash_checkins;
create policy "cash_checkins own" on public.cash_checkins
  for all to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

-- ---- 担当パートナー・運営：読むだけ ----
--  書き換えられると、それは社長の申告ではなくなる。
drop policy if exists "cash_checkins staff read" on public.cash_checkins;
create policy "cash_checkins staff read" on public.cash_checkins
  for select to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.id = cash_checkins.customer_id
               and p.consultant_id = auth.uid())
    or exists (select 1 from public.partner_assignments a
             where a.customer_id = cash_checkins.customer_id
               and a.status = 'approved'
               and (a.main_id = auth.uid() or a.sub_id = auth.uid()))
    or exists (select 1 from public.profiles me
             where me.id = auth.uid() and me.role = 'admin')
  );

comment on table public.cash_checkins is
  '社長が自分で入れる、いまの手元資金（万円）。1日1行。書けるのは本人だけ';


-- =============================================================
-- 確認（Run したあとに、この select だけを実行してください）
-- =============================================================
-- select
--   (select count(*) from information_schema.tables
--     where table_schema='public'
--       and table_name in ('ai_messages','ai_shares','cash_checkins'))   as 表,
--   (select count(*) from pg_policies
--     where schemaname='public'
--       and tablename in ('ai_messages','ai_shares','cash_checkins'))    as 権限の本数,
--   (select count(*) from pg_indexes
--     where schemaname='public'
--       and indexname='cash_checkins_cust_date_uniq')                    as 1日1行の索引,
--   (select count(*) from pg_trigger
--     where tgname='ai_shares_guard_trg')                                as 書き換え止め;
--   -- 表=3、権限の本数=6、1日1行の索引=1、書き換え止め=1 なら成功です。
