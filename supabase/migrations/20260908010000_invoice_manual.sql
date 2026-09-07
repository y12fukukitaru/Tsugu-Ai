-- =============================================================
-- 単発の請求（M&AのFA手数料など）と、お支払い方法
-- ---------------------------------------------------------------
--  集金の道が三本に分かれました。
--
--    顧問料        … 口座振替（リコーリース）
--    パートナーへの支払い … 振込（GMOあおぞら）※これは出金なので別
--    FA手数料など  … 取り急ぎ 銀行振込
--
--  ところが請求台帳は、いま**月次の顧問料しか立てられません**。
--  invoice_generate が顧客全員に一律で立てるだけで、
--  「この会社に、今回のFA手数料 ◯◯円」を立てる手段がない。
--  立てられなければ台帳に載らず、載らなければ未収一覧にも出ません。
--  先週わざわざ塞いだ「入ってこなかったお金が見えない」穴が、
--  いちばん金額の大きいFA手数料のところだけ開いたままになります。
--
--  ■ 単発の請求を入れると、いまの消込が壊れる
--    invoice_reconcile は「その顧客のその月の入金を全部足して、
--    請求額以上なら入金済み」という作りでした。顧客ごとに請求が
--    一本しか無い前提です。ここにFA手数料が加わると、
--
--      FA手数料 330万円が入金 → その月の顧問料 49,500円も
--      合計額が上回るので「入金済み」になってしまう
--
--    払っていない顧問料が消えます。**静かに消えるので気づけません。**
--    そこで、入金を区分ごとに束ね、請求の区分に合うものから
--    順に割り当てる形に作り直します。
--
--      顧問料・運営直接担当 ← revenue_entries の advisory
--      FA手数料             ← ma
--      初期導入費・その他    ← other
--
--    ma（M&A成約フィー）の入金は、顧問料には回りません。
--
--  ■ 区分をつけ忘れた入金（other）は、迷ったら充てない
--    その顧客のその月の請求が**一本しか無いとき**だけ、other の入金を
--    充てます。二本以上あると、どちらに入ったお金なのか決められません。
--    決められないものを推測で消すと、また静かに間違えます。
--    充てなければ未収として残るので、運営が見て「入金済みにする」を
--    押せばよい。見えているうちは、取り返しがつきます。
--
--  ■ お支払い方法を、請求ごとに持つ
--    11月に口座振替へ載せ替えると、しばらく
--    「口座振替の顧客」と「まだ振込の顧客」が混ざります。
--    引き落とすのに「下記へお振込ください」と書いた請求書を送ると、
--    二重にお支払いいただくことになります。返金は手間ですし、
--    何より信用に関わる。だから請求の側に方法を持たせ、
--    画面の文言もそこから出します。
--
--  確かめかた：単発の請求=1、FAの区分=1、自動ぶんだけの二重止め=1、関数=10
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           20260908000000_invoices.sql のあとに流してください。
--           何度流しても同じ結果になります。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 区分に「FA手数料」を足す
-- ---------------------------------------------------------------
alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices add constraint invoices_kind_check
  check (kind in ('advisory','direct','setup','fa','other'));
comment on column public.invoices.kind is
  'advisory＝顧問料／direct＝運営直接担当／fa＝M&AのFA手数料／setup＝初期導入費／other';

--  お支払い方法。null は「未定（振込として扱う）」
alter table public.invoices drop constraint if exists invoices_method_check;
alter table public.invoices add constraint invoices_method_check
  check (method is null or method in ('transfer','bank','card','other'));
comment on column public.invoices.method is
  'transfer＝口座振替（引き落とし）／bank＝銀行振込／card＝カード／other';

-- ---------------------------------------------------------------
-- ② 二重請求止めは「自動で立てるぶん」だけにする
-- ---------------------------------------------------------------
--  もとの索引は (顧客, 年月, 区分) に張ってありました。押し間違いで
--  顧問料が二本立つのを止めるための制約です。そこは残したい。
--
--  けれど単発の請求は、同じ月に二本立つことがあります。中間金と
--  成功報酬、別件のFA手数料。索引をそのままにすると二本目が
--  入りません。そこで**自動で立てる区分だけ**に絞ります。
--
--  手で立てるぶんの押し間違いは、索引ではなく invoice_add の中で
--  「同じ内容がすでにあります」と止めます。中身まで見て判断できる
--  ぶん、こちらのほうが正確です。
drop index if exists public.invoices_uniq;
create unique index if not exists invoices_uniq
  on public.invoices (customer_id, period, kind)
  where kind in ('advisory','direct');

-- ---------------------------------------------------------------
-- ③ 単発の請求を立てる
-- ---------------------------------------------------------------
create or replace function public.invoice_add(
  p_customer  uuid,
  p_kind      text,
  p_title     text,
  p_amount_ex integer,
  p_due_on    date,
  p_period    text default null,
  p_method    text default 'bank',
  p_note      text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_period text;
  v_title  text;
  v_tax    integer;
  v_id     uuid;
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;

  --  顧問料と運営直接担当は月次生成にまかせる。手でも立てられると、
  --  生成ぶんと合わせて二本になり、二重にご請求してしまう
  if coalesce(p_kind,'') not in ('fa','setup','other') then
    return jsonb_build_object('ok', false, 'error',
      '単発で立てられるのは FA手数料・初期導入費・その他です。顧問料は「この月の請求を立てる」からどうぞ');
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_customer) then
    return jsonb_build_object('ok', false, 'error', '請求先が見つかりません');
  end if;
  if exists (select 1 from public.account_deletions d where d.deleted_user_id = p_customer) then
    return jsonb_build_object('ok', false, 'error', '解約済みの方には請求を立てられません');
  end if;

  v_title := btrim(coalesce(p_title,''));
  if v_title = '' then
    return jsonb_build_object('ok', false, 'error', '件名をご記入ください（請求書にそのまま出ます）');
  end if;
  if coalesce(p_amount_ex,0) <= 0 then
    return jsonb_build_object('ok', false, 'error', '金額（税別）をご入力ください');
  end if;
  if p_due_on is null then
    return jsonb_build_object('ok', false, 'error', 'お支払期日をご指定ください');
  end if;
  if coalesce(p_method,'bank') not in ('transfer','bank','card','other') then
    return jsonb_build_object('ok', false, 'error', 'お支払い方法が正しくありません');
  end if;

  --  年月の指定が無ければ、期日の月として扱う
  v_period := coalesce(nullif(btrim(coalesce(p_period,'')),''), to_char(p_due_on, 'YYYY-MM'));
  if v_period !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', '年月は YYYY-MM の形でご指定ください');
  end if;

  --  押し間違いを止める。金額まで同じものが残っているなら、
  --  それは二度目に押したとみるのが自然
  if exists (
    select 1 from public.invoices i
     where i.customer_id = p_customer and i.period = v_period
       and i.kind = p_kind and i.title = v_title
       and i.amount_ex = p_amount_ex and i.status <> 'void'
  ) then
    return jsonb_build_object('ok', false, 'error',
      '同じ内容の請求がすでにあります（' || v_period || '／' || v_title || '）');
  end if;

  v_tax := p_amount_ex * 10 / 100;

  insert into public.invoices
    (customer_id, period, kind, title, amount_ex, tax, amount,
     due_on, method, note)
  values
    (p_customer, v_period, p_kind, v_title, p_amount_ex, v_tax, p_amount_ex + v_tax,
     p_due_on, coalesce(p_method,'bank'), nullif(btrim(coalesce(p_note,'')),''))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'period', v_period,
                            'amount', p_amount_ex + v_tax);
end $$;

-- ---------------------------------------------------------------
-- ④ 月次の請求に、お支払い方法を持たせる
-- ---------------------------------------------------------------
--  引数が増えるので古いものは消す。残すと、古い画面が2引数のほうを
--  呼び、方法が入らないまま請求が立ちます
drop function if exists public.invoice_generate(text, int);

create or replace function public.invoice_generate(
  p_period text, p_due_day int default 27, p_method text default 'bank')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rates  jsonb;
  v_adv    integer;
  v_direct integer;
  v_start  date;
  v_end    date;
  v_due    date;
  v_made   int := 0;
  v_skip   int := 0;
  r        record;
  v_ex     integer;
  v_method text;
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;
  if coalesce(p_period,'') !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', '年月は YYYY-MM の形でご指定ください');
  end if;
  v_method := coalesce(p_method,'bank');
  if v_method not in ('transfer','bank','card','other') then
    return jsonb_build_object('ok', false, 'error', 'お支払い方法が正しくありません');
  end if;

  v_start := (p_period || '-01')::date;
  v_end   := (v_start + interval '1 month')::date;
  v_due   := least((v_start + interval '1 month' - interval '1 day')::date,
                   (v_start + make_interval(days => greatest(p_due_day,1) - 1))::date);

  select coalesce((select value from public.app_settings where key='billing_rates'), '{}'::jsonb)
    into v_rates;
  v_adv    := coalesce(nullif(btrim(v_rates->>'bl-adv'),    '')::numeric, 45000)::integer;
  v_direct := coalesce(nullif(btrim(v_rates->>'bl-direct'), '')::numeric, 30000)::integer;

  for r in
    select p.id,
           (a.id is not null) as is_direct
      from public.profiles p
      left join public.profiles a
        on a.id = p.consultant_id and a.role = 'admin'
     where p.role = 'customer'
       and p.created_at < v_end
       and not exists (select 1 from public.account_deletions d
                        where d.deleted_user_id = p.id)
  loop
    v_ex := case when r.is_direct then v_direct else v_adv end;
    begin
      insert into public.invoices
        (customer_id, period, kind, title, amount_ex, tax, amount, due_on, method)
      values
        (r.id, p_period,
         case when r.is_direct then 'direct' else 'advisory' end,
         case when r.is_direct then p_period || ' 顧問料（運営直接担当）'
              else p_period || ' 顧問料' end,
         v_ex, v_ex * 10 / 100, v_ex + v_ex * 10 / 100, v_due, v_method);
      v_made := v_made + 1;
    exception when unique_violation then
      v_skip := v_skip + 1;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'made', v_made, 'skipped', v_skip,
                            'due_on', v_due, 'period', p_period, 'method', v_method);
end $$;

--  一部の顧客だけ口座振替に切り替わる時期があるので、あとから変えられる
create or replace function public.invoice_set_method(p_id uuid, p_method text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;
  if coalesce(p_method,'') not in ('transfer','bank','card','other') then
    return jsonb_build_object('ok', false, 'error', 'お支払い方法が正しくありません');
  end if;
  update public.invoices set method = p_method, updated_at = now()
   where id = p_id and status <> 'void';
  if not found then return jsonb_build_object('ok', false, 'error', '見つかりません'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------
-- ⑤ 消込を、区分ごとの割り当てに作り直す
-- ---------------------------------------------------------------
--  もとの作りは「その月の入金の合計 ≧ 請求額なら入金済み」でした。
--  顧客ごとに請求が一本なら正しく動きます。二本になった瞬間、
--  片方の入金でもう片方まで消えます。
--
--  ここでは、入金を区分ごとの財布に分けて、請求の区分に合う財布から
--  順に引きます。引いたぶんは財布から減るので、同じお金が二つの請求に
--  使われることはありません。
create or replace function public.invoice_reconcile(p_period text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date;
  v_paid int := 0; v_part int := 0;
  c record; r record;
  v_pool jsonb;      -- {"advisory": 円, "ma": 円, "other": 円, …}
  v_on   date;
  v_keys text[]; v_key text;
  v_take integer; v_have integer; v_use integer; v_cnt int;
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;
  if coalesce(p_period,'') !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', '年月は YYYY-MM の形でご指定ください');
  end if;
  v_start := (p_period || '-01')::date;
  --  入金は翌月にずれ込むことがある。ひと月ぶん余裕を見る
  v_end   := (v_start + interval '2 month')::date;

  for c in
    select distinct i.customer_id
      from public.invoices i
     where i.period = p_period and i.status in ('open','partial')
  loop
    --  この顧客の入金を、区分ごとに束ねる
    select coalesce(jsonb_object_agg(t.k, t.s), '{}'::jsonb), max(t.mx)
      into v_pool, v_on
      from (
        select coalesce(nullif(btrim(e.category), ''), 'other') as k,
               sum(e.amount)::integer                            as s,
               max(e.occurred_on)                                as mx
          from public.revenue_entries e
         where e.customer_id = c.customer_id
           and e.occurred_on >= v_start and e.occurred_on < v_end
           and e.amount > 0
         group by 1
      ) t;

    --  この顧客に、この月の請求が何本あるか。一本なら区分のつけ忘れも
    --  拾えるが、二本以上あるとどちらのお金か決められない
    select count(*) into v_cnt
      from public.invoices
     where period = p_period and customer_id = c.customer_id
       and status in ('open','partial');

    for r in
      select * from public.invoices
       where period = p_period and customer_id = c.customer_id
         and status in ('open','partial')
       order by due_on, created_at
    loop
      --  どの財布から引いてよいか。前のものから使う
      v_keys := case r.kind
                  when 'fa'    then array['ma']
                  when 'setup' then array['other']
                  when 'other' then array['other']
                  else              array['advisory']
                end;
      --  請求が一本しか無いなら、区分のつけ忘れ（other）も拾ってよい。
      --  取り違えようがないので
      if v_cnt = 1 and r.kind not in ('setup','other') then
        v_keys := array_append(v_keys, 'other');
      end if;

      v_take := 0;
      foreach v_key in array v_keys loop
        exit when v_take >= r.amount;
        v_have := coalesce((v_pool->>v_key)::integer, 0);
        if v_have > 0 then
          v_use  := least(v_have, r.amount - v_take);
          v_take := v_take + v_use;
          v_pool := jsonb_set(v_pool, array[v_key], to_jsonb(v_have - v_use));
        end if;
      end loop;

      --  入金なし。未収のまま残す。ここで status を触らないのが肝心で、
      --  残ったものがそのまま未収一覧に出る
      if v_take <= 0 then continue; end if;
      --  手で入れた入金額を、突合で下げてしまわない
      if v_take < coalesce(r.paid_amount, 0) then continue; end if;

      if v_take >= r.amount then
        update public.invoices
           set status='paid', paid_amount=r.amount,
               paid_on=coalesce(v_on, paid_on), updated_at=now()
         where id = r.id;
        v_paid := v_paid + 1;
      else
        update public.invoices
           set status='partial', paid_amount=v_take,
               paid_on=coalesce(v_on, paid_on), updated_at=now()
         where id = r.id;
        v_part := v_part + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'paid', v_paid, 'partial', v_part);
end $$;

-- ---------------------------------------------------------------
-- ⑥ 手で入金済みにするとき、お支払い方法を書き換えない
-- ---------------------------------------------------------------
--  既定が 'transfer' だったので、振込でいただいた顧問料を
--  「入金済みにする」と押すだけで、方法が口座振替に化けていました。
--  指定が無ければ、請求に書いてある方法をそのまま残します。
create or replace function public.invoice_mark_paid(
  p_id uuid, p_amount integer default null,
  p_on date default null, p_method text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_inv record; v_amt integer;
begin
  if not public.invoice_is_admin() then
    return jsonb_build_object('ok', false, 'error', '運営のみが操作できます');
  end if;
  select * into v_inv from public.invoices where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', '見つかりません'); end if;
  if v_inv.status = 'void' then
    return jsonb_build_object('ok', false, 'error', '取り消した請求は入金済みにできません');
  end if;

  v_amt := coalesce(p_amount, v_inv.amount);
  if v_amt < 0 then return jsonb_build_object('ok', false, 'error', '金額が正しくありません'); end if;

  update public.invoices
     set paid_amount = v_amt,
         paid_on     = coalesce(p_on, (now() at time zone 'Asia/Tokyo')::date),
         method      = coalesce(p_method, method),
         status      = case when v_amt >= v_inv.amount then 'paid'
                            when v_amt > 0 then 'partial' else 'open' end,
         updated_at  = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------
-- ⑦ お振込先のご案内
-- ---------------------------------------------------------------
--  振込でお願いする以上、どこへ振り込むのかを画面に出さないと
--  お客様は担当パートナーに電話することになります。
--
--  ※ これは**当社が受け取る側の口座**です。請求書に必ず印字するもので、
--    「口座情報はプラットホームに置かない」と言っているのは
--    お客様・パートナーの口座のこと。別のものなので混ぜないでください。
create or replace function public.invoice_pay_info()
returns jsonb
language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'bank', coalesce(nullif(btrim(
      (select s.value->>'bl-bank' from public.app_settings s where s.key='billing_rates')
    ), ''), '')
  )
  where auth.uid() is not null;
$$;

-- ---------------------------------------------------------------
-- ⑧ 権限
-- ---------------------------------------------------------------
revoke all on function public.invoice_add(uuid,text,text,integer,date,text,text,text) from public, anon;
revoke all on function public.invoice_generate(text,int,text)                         from public, anon;
revoke all on function public.invoice_set_method(uuid,text)                           from public, anon;
revoke all on function public.invoice_reconcile(text)                                 from public, anon;
revoke all on function public.invoice_mark_paid(uuid,integer,date,text)               from public, anon;
revoke all on function public.invoice_pay_info()                                      from public, anon;

grant execute on function public.invoice_add(uuid,text,text,integer,date,text,text,text) to authenticated;
grant execute on function public.invoice_generate(text,int,text)                         to authenticated;
grant execute on function public.invoice_set_method(uuid,text)                           to authenticated;
grant execute on function public.invoice_reconcile(text)                                 to authenticated;
grant execute on function public.invoice_mark_paid(uuid,integer,date,text)               to authenticated;
grant execute on function public.invoice_pay_info()                                      to authenticated;

-- ---------------------------------------------------------------
-- ⑨ 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='invoice_add')            as "単発の請求",
  (select count(*) from pg_constraint
    where conrelid='public.invoices'::regclass
      and conname='invoices_kind_check'
      and pg_get_constraintdef(oid) like '%''fa''%')                 as "FAの区分",
  --  自動で立てるぶんだけに絞った索引（WHERE が付いていること）
  (select count(*) from pg_indexes
    where schemaname='public' and indexname='invoices_uniq'
      and indexdef ilike '%where%')                                  as "自動ぶんだけの二重止め",
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'invoice%')          as "関数";
--  期待値：単発の請求=1、FAの区分=1、自動ぶんだけの二重止め=1、関数=10
-- =============================================================
