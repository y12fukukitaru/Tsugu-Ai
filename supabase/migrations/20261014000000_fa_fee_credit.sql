-- =============================================================
-- 顧問契約書ひな形：M&A の優遇を「顧問料の控除」に改める（2026-10-14）
-- ---------------------------------------------------------------
--  これまで（第2条の3）
--    本契約が1年以上継続している乙については、本契約の継続年数1年につき10%（最大50%）を
--    FA報酬から割り引く。
--
--  これから
--    FA契約を結ぶ時点で本契約が継続していれば、それまでに乙が支払った本契約の顧問料
--    （税別。初期導入費と未払いの月は除く）を、直近36か月分を上限として FA報酬から差し引く。
--    差し引いた後の FA報酬は0円を下回らない。最低報酬は、これまでどおりどなたにも設けない。
--    控除の額は FA契約の締結時に確定する（締結時限り。あとから足したり減らしたりしない）。
--    プランを変更しても、月数は通算する。
--
--  ■ 直すところ：公開中の顧問契約（customer）の本文の「第2条の3」の段落と、
--    第3条が無い本文に足した一行（M&Aの報酬と優遇）。新しい版として公開し、古い版は記録に残す。
--    締結済みの契約の本文は変えない（2026-10-14 時点で、締結済みの顧問契約はありません）。
--  ■ 公開中の本文に「継続年数1年につき10%」が無ければ何もしない（もう直っている／手で直した本文）。
--
--  確かめかた：最後の select で「顧問料の控除（36か月分まで）」=1、「年10%の割引が残る」=0
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。Edge Function の変更はありません。
-- =============================================================

do $do$
declare
  cur  public.contract_templates%rowtype;
  nb   text;
  nv   int;
  i0   int;
  i1   int;
begin
  select * into cur from public.contract_templates
   where kind = 'customer' and active = true
   order by version desc limit 1;
  if not found then return; end if;
  if position('継続年数1年につき10%' in cur.body) = 0 then return; end if;   -- もう直っている

  nb := cur.body;

  -- 第2条の3：見出しから「同一の案件で…」の前までを、新しい文に入れ替える
  i0 := position('第2条の3（M&Aの報酬と、顧問先の優遇）' in nb);
  if i0 > 0 then
    i1 := position('同一の案件で相手方も' in substr(nb, i0));
    if i1 > 0 then
      i1 := i0 + i1 - 1;
      -- 行頭の字下げ（2文字）を残すため、直前の改行までさかのぼる
      while i1 > i0 and substr(nb, i1 - 1, 1) <> E'\n' loop i1 := i1 - 1; end loop;
      nb := substr(nb, 1, i0 - 1) ||
        '第2条の3（M&Aの報酬と、顧問先の優遇）' || E'\n' ||
        '  乙が会社・事業の譲渡または譲受を行う際に、甲または運営がファイナンシャル・アドバイザー' || E'\n' ||
        '  として関与するときの報酬（以下「FA報酬」）は、別途のFA契約によります。FA報酬に最低報酬額は' || E'\n' ||
        '  設けません。' || E'\n' ||
        '  FA契約の締結日において本契約が継続している乙については、同日までに乙が支払った本契約の' || E'\n' ||
        '  顧問料（消費税を除く。初期導入費および未払いの顧問料を除く）を、直近36か月分を上限として、' || E'\n' ||
        '  FA報酬から控除します。控除の額はFA契約の締結日に確定し、控除後のFA報酬は0円を下回りません。' || E'\n' ||
        '  本契約のプランを変更した場合も、月数は通算します。' || E'\n' ||
        substr(nb, i1);
    end if;
  end if;

  -- 第3条が無い本文に足した一行
  nb := replace(nb,
    '最低報酬はありません。1年以上の顧問先は継続年数1年につき10%（最大50%）を割り引きます。',
    '最低報酬はありません。FA契約の締結時に本契約が継続していれば、それまでに支払った顧問料（税別・初期導入費と未払いを除く）を直近36か月分までFA報酬から控除します（控除後は0円を下回りません）。');
  nb := replace(nb,
    '1年以上の顧問先は最低報酬なし、継続年数1年につき10%（最大50%）を割り引きます。',
    '最低報酬はありません。FA契約の締結時に本契約が継続していれば、それまでに支払った顧問料（税別・初期導入費と未払いを除く）を直近36か月分までFA報酬から控除します（控除後は0円を下回りません）。');

  if nb = cur.body or position('継続年数1年につき10%' in nb) > 0 then
    raise notice '古い言い回しを見つけられませんでした（手で直した本文の可能性）。何も変えていません';
    return;
  end if;

  select coalesce(max(version),0) + 1 into nv from public.contract_templates where kind = 'customer';
  update public.contract_templates set active = false where kind = 'customer' and active = true;
  insert into public.contract_templates (kind, version, title, body, active, created_by)
  values ('customer', nv, cur.title, nb, true, cur.created_by);
end $do$;

-- 確かめ
select
  (select count(*) from public.contract_templates
    where kind = 'customer' and active = true
      and position('直近36か月分' in body) > 0)                       as "顧問料の控除（36か月分まで）",
  (select count(*) from public.contract_templates
    where kind = 'customer' and active = true
      and position('継続年数1年につき10%' in body) > 0)               as "年10%の割引が残る（0なら完了）";
