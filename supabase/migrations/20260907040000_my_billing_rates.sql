-- =============================================================
-- パートナーが「自分がいくら引かれるか」を確かめられるようにする
-- ---------------------------------------------------------------
--  運営の配分画面は、報酬から利用料を差し引いてお振込額を出しています。
--  ところがパートナー側の支払明細は「報酬 − 源泉徴収」のままでした。
--  二つの画面が違う金額を出していると、
--
--      明細を見て待っていた額より、少ない額が振り込まれる
--
--  ということが起きます。金額の食い違いは、説明しても納得しづらい。
--  同じ式で計算するには、パートナー側でも料率が読めないといけません。
--
--  ■ けれど app_settings ごと見せることはしない
--    あの表には顧問料や運営直接担当の額など、パートナーにお見せする
--    必要のない数字も入っています。だから表は触らせず、
--    **ご自身が負担する4つの額だけ**を返す関数を通します。
--
--      基本料 ／ AI利用料（1社あたり）／ 登録料（1人あたり）
--      まとめ登録の定額と人数
--
--    どれも「あなたに請求する額」なので、ご本人が知っていて当然のものです。
--
--  確かめかた：料率の関数=1、運営以外でも読める=t
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================

create or replace function public.my_billing_rates()
returns jsonb
language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    --  設定が空・未入力・数字でないときは、画面の初期値と同じ額に落とす。
    --  ここで落ちると明細そのものが出せなくなる
    'base',  coalesce(nullif(btrim(v->>'bl-pbase'),     '')::numeric,  3000),
    'per',   coalesce(nullif(btrim(v->>'bl-ai'),        '')::numeric,  2000),
    'seat',  coalesce(nullif(btrim(v->>'bl-seat'),      '')::numeric,  3000),
    'pack',  coalesce(nullif(btrim(v->>'bl-seatpack'),  '')::numeric, 15000),
    'packn', coalesce(nullif(btrim(v->>'bl-seatpackn'), '')::numeric,    10)
  )
  from (
    select coalesce(
      (select s.value from public.app_settings s where s.key = 'billing_rates'),
      '{}'::jsonb) as v
  ) t
  where auth.uid() is not null;
$$;

revoke all on function public.my_billing_rates() from public, anon;
grant execute on function public.my_billing_rates() to authenticated;

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='my_billing_rates')          as "料率の関数",
  --  ログインしていれば運営でなくても読める（自分の請求額なので）
  (select has_function_privilege('authenticated','public.my_billing_rates()','execute'))
                                                                        as "運営以外でも読める";
--  期待値：料率の関数=1、運営以外でも読める=true
-- =============================================================
