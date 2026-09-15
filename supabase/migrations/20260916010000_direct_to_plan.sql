-- =============================================================
-- 顧問料を、2つのプランだけにする（運営直接担当の一律をやめる）
-- ---------------------------------------------------------------
--  これまで、運営が直接担当している顧客だけ「運営直接担当 30,000円／月」
--  という別の一律料金で請求していました。外注費の配分が無いぶん安く、
--  という考え方でした。
--
--  これをやめて、運営が担当していても
--
--      買い手プラン（成長）   45,000円／月（税別）
--      売り手プラン（譲渡準備）30,000円／月（税別）
--
--  の2つだけにします。値段が相手によって違うと、
--  「この値段で続けてもらえるのか」という本当の反応が読めなくなるためです。
--  同じ条件でなければ、比べる意味がありません。
--
--  ■ あわせて直す、もっと大きな食い違い
--
--    invoice_generate が二つありました。
--
--      invoice_generate(text, int)        … プランを見る（9/12 に足したほう）
--      invoice_generate(text, int, text)  … プランを見ない（もとからあるほう）
--
--    引数の数が違うので、あとから作ったほうは**古いほうを置き換えず、
--    別物として増えていました**。そして画面は集金方法（p_method）も
--    渡すので、呼ばれていたのは**プランを見ないほう**です。
--
--    つまり、このままでは
--
--        売り手プランの顧客にも 45,000円 で請求が立つ（15,000円 の過大請求）
--
--    という状態でした。画面が呼ぶほう（3つの引数）をプランで出し分ける形に
--    作り直し、呼ばれていないほう（2つの引数）は消します。同じ名前の関数を
--    二つ残しておくと、また同じことが起きます。
--
--  ■ 気をつけていただきたいこと
--
--    運営が直接担当している顧客のうち**買い手プランの方は、次にお立てに
--    なる月から 30,000円 → 45,000円 になります**。下の確かめの数字に
--    その件数が出ますので、実行前にご確認ください。
--    すでに立っている過去の請求は書き換えません。
--
--  ■ 種別（kind）について
--
--    これからは全員 'advisory'（顧問料）で立ちます。'direct' は過去の
--    請求のために残しますが、新しくは作りません。どの顧客を運営が直接
--    担当しているかは、顧客の「担当」から分かります。
--
--  確かめかた：invoice_generate=1、運営が直接担当=N、うち買い手=M
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になります。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 呼ばれていないほう（引数2つ）を消す
-- ---------------------------------------------------------------
--  画面は必ず3つの引数で呼びます。同じ名前が二つあると、どちらが
--  効いているのか読んでも分かりません。
drop function if exists public.invoice_generate(text, int);

-- ---------------------------------------------------------------
-- ② 画面が呼ぶほう（引数3つ）を、プランで出し分ける形に作り直す
-- ---------------------------------------------------------------
create or replace function public.invoice_generate(
  p_period text, p_due_day int default 27, p_method text default 'bank')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_start  date;
  v_end    date;
  v_due    date;
  v_made   int := 0;
  v_skip   int := 0;
  r        record;
  v_ex     integer;
  v_plan   text;
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

  --  担当が運営かパートナーかは、もう金額に関係しません。
  --  見るのはプランだけです。
  for r in
    select p.id
      from public.profiles p
     where p.role = 'customer'
       and p.created_at < v_end
       and not exists (select 1 from public.account_deletions d
                        where d.deleted_user_id = p.id)
  loop
    --  その月の1日に効いているプランの月額。切替は翌月1日から効く
    v_plan := public.plan_effective(r.id, v_start);
    v_ex   := public.plan_fee(v_plan);
    begin
      insert into public.invoices
        (customer_id, period, kind, title, amount_ex, tax, amount, due_on, method)
      values
        (r.id, p_period, 'advisory',
         case when v_plan = 'seller' then p_period || ' 顧問料（売り手プラン）'
              else p_period || ' 顧問料（買い手プラン）' end,
         v_ex, v_ex * 10 / 100, v_ex + v_ex * 10 / 100, v_due, v_method);
      v_made := v_made + 1;
    exception when unique_violation then
      v_skip := v_skip + 1;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'made', v_made, 'skipped', v_skip,
                            'due_on', v_due, 'period', p_period, 'method', v_method);
end $$;

comment on function public.invoice_generate(text, int, text) is
  'その月の顧問料を顧客ごとに立てる。金額はプラン（買い手／売り手）だけで決まる';

-- ---------------------------------------------------------------
-- ③ 料金表から、運営直接担当の額を外す
-- ---------------------------------------------------------------
--  もう誰も読みませんが、残っていると「まだ効いている」と読めてしまいます。
update public.app_settings
   set value = value - 'bl-direct'
 where key = 'billing_rates'
   and value ? 'bl-direct';

-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='invoice_generate')::text          as invoice_generate,
  (select count(*) from public.profiles p
     join public.profiles a on a.id = p.consultant_id and a.role='admin'
    where p.role='customer')::text                                           as 運営が直接担当,
  (select count(*) from public.profiles p
     join public.profiles a on a.id = p.consultant_id and a.role='admin'
    where p.role='customer' and coalesce(p.plan,'buyer') <> 'seller')::text   as うち買い手,
  (select (value ? 'bl-direct') from public.app_settings
    where key='billing_rates')::text                                         as 一律の設定が残っているか;
-- 期待：invoice_generate=1、一律の設定が残っているか=false または空
--       「うち買い手」の件数が、次の月から 30,000円 → 45,000円 になる方です
