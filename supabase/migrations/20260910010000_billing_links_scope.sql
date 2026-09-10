-- =============================================================
-- 決済リンクとお知らせの見える範囲を絞る
-- ---------------------------------------------------------------
--  点検の結果、残っていた5件を見ました。うち3件を直します。
--
--  ■ 直す①：決済リンクが、登録した人全員に見えていた（重要）
--
--    billing_links の読み取りの決まりが true でした。条件がありません。
--    けれど画面のほうは、こう絞っています。
--
--      .or('customer_id.is.null,customer_id.eq.'+uid)
--
--    **絞っているのはブラウザの中だけです。**決まりが true なので、
--    ログインした人が billing_links を素直に読めば、
--    **全社ぶんの決済リンクが返ってきます。**
--
--    中身は Stripe の決済リンク（https://buy.stripe.com/…）で、
--    顧客ごとに分けて持てる作りになっています。つまり
--    「どこの会社に、いくら請求しているか」が一覧で見えていました。
--
--    画面がすでに正しく絞っているので、**同じ条件を決まりにも書けば、
--    動きは変わらないまま塞がります。**
--
--  ■ 直す②：お知らせが、相手を問わず読めていた
--
--    announcements も true でした。画面は audience で
--    「みんな・顧客・パートナー」を出し分けていますが、
--    決まりが無いので、パートナー向けのお知らせを顧客が読めます。
--    中身は運営からの連絡なので実害は小さいものの、出し分けている
--    以上、そのとおりに閉じておきます。
--
--  ■ 直す③：契約のひな形を、送る人だけに
--
--    contract_templates は active というだけで全員が読めました。
--    読む必要があるのは、契約を送る運営とパートナーだけです。
--    経営者が契約書を読むのは contract_open を通るので、
--    ここを絞っても影響しません。
--
--  ■ 直さないもの（このままが正しい）
--
--    ai_calls と payout_keys は「決まりが1つも無い」と出ましたが、
--    **わざとです。**AIの利用回数は Edge Function が service_role で
--    書きます。payout_keys は口座を暗号化する鍵そのもので、
--    payout_key() を通す以外に読ませてはいけません。
--    どちらも画面からは触れない状態が正解なので、触りません。
--
--  確かめかた：決済リンクの見張り=1、お知らせの見張り=1、
--              素通しの決まり=0
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 決済リンク：自分あてと、みんなあてだけ
-- ---------------------------------------------------------------
--  customer_id の列がまだ無い環境でも壊れないよう、あるときだけ
--  その条件を足します。無ければ「active なものだけ」になります
do $do$
declare
  has_cust boolean;
  has_act  boolean;
  cond     text;
begin
  if to_regclass('public.billing_links') is null then
    raise notice 'billing_links がありません。①はとばします';
    return;
  end if;

  select count(*) > 0 into has_cust from information_schema.columns
   where table_schema='public' and table_name='billing_links' and column_name='customer_id';
  select count(*) > 0 into has_act  from information_schema.columns
   where table_schema='public' and table_name='billing_links' and column_name='active';

  cond := 'true';
  if has_act  then cond := cond || ' and active'; end if;
  if has_cust then
    cond := cond || ' and (customer_id is null or customer_id = auth.uid())';
  end if;

  execute 'alter table public.billing_links enable row level security';

  --  これまでの読み取りの決まりを外す。名前は点検で見えたもの
  execute 'drop policy if exists "billing_links_read" on public.billing_links';
  execute 'drop policy if exists "billing_links read" on public.billing_links';

  --  運営はぜんぶ。管理画面で一覧と登録と削除をするため
  execute 'drop policy if exists "billing_links admin" on public.billing_links';
  execute $p$
    create policy "billing_links admin" on public.billing_links
      for all to authenticated
      using (exists (select 1 from public.profiles p
                      where p.id = auth.uid() and p.role = 'admin'))
      with check (exists (select 1 from public.profiles p
                           where p.id = auth.uid() and p.role = 'admin'))
  $p$;

  --  それ以外は、自分あてか、みんなあてのものだけ
  execute
    'create policy "billing_links_read" on public.billing_links'
    || ' for select to authenticated using (' || cond || ')';

  raise notice '決済リンクの条件：%', cond;
end $do$;

-- ---------------------------------------------------------------
-- ② お知らせ：自分の立場あてと、みんなあてだけ
-- ---------------------------------------------------------------
do $do$ begin
  if to_regclass('public.announcements') is null then
    raise notice 'announcements がありません。②はとばします';
    return;
  end if;

  execute 'alter table public.announcements enable row level security';
  execute 'drop policy if exists "announcements_select" on public.announcements';
  execute 'drop policy if exists "announcements select" on public.announcements';

  execute 'drop policy if exists "announcements admin" on public.announcements';
  execute $p$
    create policy "announcements admin" on public.announcements
      for all to authenticated
      using (exists (select 1 from public.profiles p
                      where p.id = auth.uid() and p.role = 'admin'))
      with check (exists (select 1 from public.profiles p
                           where p.id = auth.uid() and p.role = 'admin'))
  $p$;

  --  画面と同じ出し分け。パートナーは all と consultant、
  --  それ以外は all と customer。役割が読めないときは all だけ見えます
  execute $p$
    create policy "announcements_select" on public.announcements
      for select to authenticated
      using (
        coalesce(audience,'all') = 'all'
        or coalesce(audience,'all') = case
             when (select p.role from public.profiles p where p.id = auth.uid())
                  = 'consultant' then 'consultant'
             else 'customer' end
      )
  $p$;
end $do$;

-- ---------------------------------------------------------------
-- ③ 契約のひな形：送る人だけ
-- ---------------------------------------------------------------
do $do$ begin
  if to_regclass('public.contract_templates') is null then return; end if;
  execute 'drop policy if exists "contract_templates read active" on public.contract_templates';
  execute $p$
    create policy "contract_templates read active" on public.contract_templates
      for select to authenticated
      using (
        active
        and exists (select 1 from public.profiles p
                     where p.id = auth.uid() and p.role in ('admin','consultant'))
      )
  $p$;
end $do$;

-- ---------------------------------------------------------------
-- ④ 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from pg_policies
    where schemaname='public' and tablename='billing_links'
      and policyname='billing_links_read'
      and qual like '%auth.uid()%')                       as "決済リンクの見張り",
  (select count(*) from pg_policies
    where schemaname='public' and tablename='announcements'
      and policyname='announcements_select'
      and qual like '%auth.uid()%')                       as "お知らせの見張り",
  --  条件がそのまま true の決まりが、public と storage に残っていないこと
  (select count(*) from pg_policies
    where schemaname in ('public','storage')
      and btrim(coalesce(qual, with_check), '() ') = 'true') as "素通しの決まり";
--  期待値：決済リンクの見張り=1、お知らせの見張り=1、素通しの決まり=0
-- =============================================================
