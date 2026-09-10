-- =============================================================
-- 情報漏洩の穴を塞ぐ（ローンチ前の締め直し）
-- ---------------------------------------------------------------
--  顧問先の決算書・EBITDA・口座の話が乗る場所なので、
--  「入れる人なら誰でも見られる」という状態を残さない。
--
--  ■ 塞ぐもの①：添付ファイルが、ログインさえすれば誰でも読めた
--
--    chat-attach バケットの読み取りが、こう書かれていました。
--
--      using (bucket_id = 'chat-attach')
--
--    条件がバケット名だけです。**ログイン済みの全員**が通ります。
--    当時の狙いは「パスが推測できないから大丈夫」でしたが、
--    推測は要りません。storage.objects の select が通るということは、
--    一覧（list）も通るということです。バケットの根を一覧すれば
--    顧客IDのフォルダが並び、その中を一覧すればファイル名が並び、
--    署名付きURLは自分で発行できます。
--
--    このプラットフォームは誰でも登録できます。つまり、
--    **登録した人が、全社の決算書を落とせる状態でした。**
--
--    直し方：フォルダの先頭（＝顧客ID）を見て、その会社に
--    関わりのある人だけに絞ります。書き込みも同じ条件にします。
--    いまの置き方は「顧客ID/時刻_乱数.拡張子」なので、
--    既にあるファイルはそのまま読めます。
--
--  ■ 塞ぐもの②：パートナーが自分で「パートナー契約」を作れた
--
--    契約の更新ポリシーが、取り消し（status）のためのものでしたが、
--    with check が offered_by と status しか見ていませんでした。
--    列を絞っていないので、こういう手が通ります。
--
--      1. 顧客契約（kind='customer'）として作る（挿入は許可されている）
--      2. その行を kind='partner' に書き換える（status は 'sent' のまま）
--      3. 受け取った人が同意すると contract_claim が role を
--         'consultant' に上げる
--
--    つまり、パートナーが運営を通さずにパートナーを増やせました。
--    画面は status しか書き換えないので、**列の権限を status だけに
--    絞れば、動きは変わらないまま塞げます。**
--
--  ■ ついでに直すもの③：契約本文も書き換えられた
--
--    ②と同じ穴です。送ったあと、相手が同意する前に本文や金額を
--    差し替えられました。列を絞ると、これも同時に塞がります。
--
--  確かめかた：添付の見張り=1、添付の書き込み=1、契約の列権限=1、
--              契約の全列権限=0
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 「その会社の添付を触ってよい人か」を一箇所で決める
-- ---------------------------------------------------------------
--  本人・担当パートナー・承認済みの2人目・EPの管理者・運営。
--  chat_messages の見え方と揃えてあります。ここだけ緩いと、
--  本文は見えないのに添付は見える、という妙な穴になります。
--
--  表がまだ無い環境でも落ちないよう、to_regclass で確かめてから見ます。
--  security definer なので、この関数の中では RLS を通さずに読めます。
create or replace function public.chat_att_may(p_customer uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  me uuid := auth.uid();
  hit boolean;
begin
  if me is null or p_customer is null then return false; end if;

  --  本人
  if me = p_customer then return true; end if;

  --  運営
  select exists (select 1 from public.profiles
                  where id = me and role = 'admin') into hit;
  if hit then return true; end if;

  --  担当パートナー
  select exists (select 1 from public.profiles
                  where id = p_customer and consultant_id = me) into hit;
  if hit then return true; end if;

  --  承認済みの2名体制（主担当・副担当）
  if to_regclass('public.partner_assignments') is not null then
    execute
      'select exists (select 1 from public.partner_assignments
                       where customer_id = $1 and status = ''approved''
                         and (main_id = $2 or sub_id = $2))'
      into hit using p_customer, me;
    if hit then return true; end if;
  end if;

  --  EP-I の管理者は、自法人の顧問先ぶんも
  if to_regclass('public.ep_clients') is not null then
    execute
      'select exists (
         select 1
           from public.ep_clients c
           join public.ep_orgs    o on o.id = c.ep_id
           join public.ep_members m on m.ep_id = c.ep_id
          where c.customer_id = $1
            and c.status = ''active''
            and o.kind = ''EP1''
            and m.user_id = $2
            and m.status = ''active''
            and m.seat_role = ''manager'')'
      into hit using p_customer, me;
    if hit then return true; end if;
  end if;

  --  個別に配られた閲覧権（EP-II など）
  if to_regclass('public.ep_grants') is not null then
    execute
      'select exists (select 1 from public.ep_grants
                       where customer_id = $1 and member_id = $2
                         and revoked_at is null)'
      into hit using p_customer, me;
    if hit then return true; end if;
  end if;

  return false;
end;
$$;

revoke all on function public.chat_att_may(uuid) from public, anon;
grant execute on function public.chat_att_may(uuid) to authenticated;

--  パスの先頭が顧客IDのUUIDかを見て、UUIDに直す。
--  形が違うファイル（もしあれば）は null を返し、下のポリシーで弾かれます。
create or replace function public.chat_att_owner(p_name text)
returns uuid
language sql
immutable
as $$
  select case
           when split_part(coalesce(p_name,''), '/', 1)
                ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then split_part(p_name, '/', 1)::uuid
           else null
         end;
$$;

-- ---------------------------------------------------------------
-- ② 添付の読み書きを、その会社に関わる人だけに絞る
-- ---------------------------------------------------------------
drop policy if exists "chat attach read" on storage.objects;
create policy "chat attach read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attach'
    and public.chat_att_may(public.chat_att_owner(name))
  );

--  書き込みも同じ条件に。ここを緩いままにすると、他人のフォルダに
--  ファイルを置けます。置いたものを相手の画面に出すことはできませんが、
--  容量を食い潰す嫌がらせと、置き場所の悪用ができてしまいます。
drop policy if exists "chat attach upload" on storage.objects;
create policy "chat attach upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attach'
    and public.chat_att_may(public.chat_att_owner(name))
  );

--  差し替えと削除は誰にも許していません（ポリシーが無ければ通りません）。
--  送った添付を後から中身だけ入れ替えられると、記録として使えなくなります。

-- ---------------------------------------------------------------
-- ③ 契約は「取り消し」だけできるようにする（列で縛る）
-- ---------------------------------------------------------------
--  ポリシーの with check では「どの列が変わったか」を見られません。
--  列そのものの権限で縛るのが確実です。画面は status しか書き換えて
--  いないので、動きは変わりません。
revoke update on public.contract_offers from authenticated;
grant  update (status) on public.contract_offers to authenticated;

--  service_role（Edge Function）はこれまでどおり全部できます
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.contract_offers to service_role';
  end if;
end $do$;

-- ---------------------------------------------------------------
-- ④ 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='chat attach read'
      and qual like '%chat_att_may%')                       as "添付の見張り",
  (select count(*) from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='chat attach upload'
      and with_check like '%chat_att_may%')                 as "添付の書き込み",
  (select count(*) from information_schema.column_privileges
    where table_schema='public' and table_name='contract_offers'
      and grantee='authenticated' and privilege_type='UPDATE'
      and column_name='status')                             as "契約の列権限",
  --  status 以外に UPDATE が残っていたら 0 にならない
  (select count(*) from information_schema.column_privileges
    where table_schema='public' and table_name='contract_offers'
      and grantee='authenticated' and privilege_type='UPDATE'
      and column_name <> 'status')                          as "契約の全列権限",
  --  読めなくなる添付が無いこと。0 でないなら、そのファイルは
  --  置き方が違うので、運営で個別に確かめること
  (select count(*) from storage.objects
    where bucket_id='chat-attach'
      and public.chat_att_owner(name) is null)              as "形の違う添付";
--  期待値：添付の見張り=1、添付の書き込み=1、契約の列権限=1、
--          契約の全列権限=0、形の違う添付=0
-- =============================================================
