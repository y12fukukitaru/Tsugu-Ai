-- =============================================================
-- 初期診断レポート：下書きを顧客から隠す
--
--  画面には「下書き（顧客に非表示）」と書いてあり、顧客側の読み取りも
--  status='published' で絞っている。しかし権限（RLS）の側には status の
--  条件が無く、開発者ツールから直接取りに行けば下書きも読めてしまう。
--
--    onbr_customer_read : auth.uid() = customer_id      ← 条件なし
--    mem_obr            : is_company_member(customer_id) ← 条件なし
--
--  読めるのは自社の情報なので他社への漏えいではないが、パートナーが
--  書きかけの診断（企業価値の試算・所見・ロードマップ）を、確定前に
--  経営者が見てしまう。画面上の約束が守られていない状態なので直す。
--
--  パートナー・運営向けの onbr_staff_all（ALL）はそのまま。作る側には
--  下書きが見えて当然。
--
--  ※ ポリシーは足すと「OR」で緩くなる。新しく足すのではなく、
--    いまあるものの条件を狭める。
--
--  ※ drop → create ではなく alter policy を使う。drop して作り直すと、
--    もとの対象（for all だったのか for select だったのか、書き込みの
--    条件があったのか）を取り違えたときに、権限を静かに広げたり
--    狭めたりしてしまう。alter policy なら「読める条件」だけが変わる。
--    まだ無い環境のために、無いときは作る形にしてある。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になる。
-- =============================================================

do $$
begin
  -- 顧客本人：公開されたものだけ
  if exists (select 1 from pg_policies
             where schemaname='public' and tablename='onboarding_reports'
               and policyname='onbr_customer_read') then
    alter policy "onbr_customer_read" on public.onboarding_reports
      using (auth.uid() = customer_id and status = 'published');
  else
    create policy "onbr_customer_read" on public.onboarding_reports
      for select to public
      using (auth.uid() = customer_id and status = 'published');
  end if;

  -- 会社のメンバー：同上
  if exists (select 1 from pg_policies
             where schemaname='public' and tablename='onboarding_reports'
               and policyname='mem_obr') then
    alter policy "mem_obr" on public.onboarding_reports
      using (is_company_member(customer_id) and status = 'published');
  else
    create policy "mem_obr" on public.onboarding_reports
      for select to public
      using (is_company_member(customer_id) and status = 'published');
  end if;
end $$;


-- =============================================================
-- 確認 その1（Run したあとに、この select だけを実行）
--   「読める条件」に status = 'published' が入っていれば成功です。
--   あわせて「操作」が select のままか、作る側（onbr_staff_all）が
--   ALL のまま残っているかも見てください。
-- =============================================================
-- select policyname as 名前, cmd as 操作,
--        array_to_string(roles,',') as 対象,
--        qual as 読める条件, with_check as 書ける条件
--   from pg_policies
--  where schemaname='public' and tablename='onboarding_reports'
--  order by cmd, policyname;

-- =============================================================
-- 確認 その2（次に塞ぐ場所を決めるため）
--   月次レポート（monthly_reports）にも同じ「下書き／公開」があります。
--   パートナーの承認前のレポートが顧客に読めていないか、同じやり方で
--   確かめます。結果を報告してください。
-- =============================================================
-- select policyname as 名前, cmd as 操作,
--        array_to_string(roles,',') as 対象,
--        qual as 読める条件, with_check as 書ける条件
--   from pg_policies
--  where schemaname='public' and tablename='monthly_reports'
--  order by cmd, policyname;
