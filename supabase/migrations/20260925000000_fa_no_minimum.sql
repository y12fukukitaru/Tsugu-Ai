-- =============================================================
-- 顧問契約書ひな形：FA 報酬の最低報酬は、どなたにもありません
-- ---------------------------------------------------------------
--  M&A の FA 報酬（成功報酬・レーマン方式）には、もともと最低報酬
--  （最低手数料）がありません。LP と特定商取引法の表示のとおりです。
--  顧問先の優遇は「顧問契約が1年以上なら、継続年数1年につき10%
--  （最大50%）の割引」だけです。
--
--  ところが 20260912000000_plan_exit.sql で公開した第2条の3は
--
--      本契約が1年以上継続している乙については、FA報酬の最低報酬額を設けず、…
--
--  と書いていて、1年未満の顧問先には最低報酬があるように読めました。
--
--  ■ 直すところ（文言だけ。報酬の計算は変わりません）
--
--    第2条の3
--      前：本契約が1年以上継続している乙については、FA報酬の最低報酬額を設けず、本契約の継続年数
--          1年につき10%（最大50%）をFA報酬から割り引きます。
--      後：FA報酬に最低報酬額は設けません。本契約が1年以上継続している乙については、
--          本契約の継続年数1年につき10%（最大50%）をFA報酬から割り引きます。
--
--    （第3条が無い本文に足した一行）
--      前：1年以上の顧問先は最低報酬なし、継続年数1年につき10%（最大50%）を割り引きます。
--      後：最低報酬はありません。1年以上の顧問先は継続年数1年につき10%（最大50%）を割り引きます。
--
--  公開中の本文に「最低報酬」の古い言い回しが残っているときだけ、新しい版を
--  公開します。もう直っていれば何もしません。締結済みの契約の本文は変えません。
--
--  確かめかた：公開中の customer の本文に「FA報酬に最低報酬額は設けません」=1
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。Edge Function の変更はありません。
-- =============================================================

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
  if position('最低報酬' in cur.body) = 0 then return; end if;   -- 最低報酬の話が無い
  if position('最低報酬額を設けず' in cur.body) = 0
     and position('最低報酬なし' in cur.body) = 0 then return; end if;   -- もう直っている

  nb := cur.body;
  nb := replace(nb,
    '本契約が1年以上継続している乙については、FA報酬の最低報酬額を設けず、本契約の継続年数' || E'\n' ||
    '  1年につき10%（最大50%）をFA報酬から割り引きます。',
    'FA報酬に最低報酬額は設けません。本契約が1年以上継続している乙については、' || E'\n' ||
    '  本契約の継続年数1年につき10%（最大50%）をFA報酬から割り引きます。');
  nb := replace(nb,
    '1年以上の顧問先は最低報酬なし、継続年数1年につき10%（最大50%）を割り引きます。',
    '最低報酬はありません。1年以上の顧問先は継続年数1年につき10%（最大50%）を割り引きます。');
  if nb = cur.body then return; end if;   -- 古い言い回しが見つからない（手で直した本文）

  select coalesce(max(version),0) + 1 into nv from public.contract_templates where kind = 'customer';
  update public.contract_templates set active = false where kind = 'customer' and active = true;
  insert into public.contract_templates (kind, version, title, body, active, created_by)
  values ('customer', nv, cur.title, nb, true, cur.created_by);
end $do$;
