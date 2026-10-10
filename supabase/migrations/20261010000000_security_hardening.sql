-- =============================================================
-- 情報の守りを、いちばん固い形に（2026-10-10）
-- ---------------------------------------------------------------
--  お預かりしている試算表・入力・計算の結果・M&A の情報は、
--  「見てよい人」以外には、どの道を通っても届かないようにする。
--  外部の点検（アプリ・データベース・関数の3方向）で見つかった道を、ここで塞ぎます。
--
--  ■ この SQL がすること
--    ① スマホ通知・メール・LINE に「中身を出すか」の設定（既定は出さない）
--    ② 権限の列（役割・担当・プラン・ランク・メール）を、画面から書き換えさせない
--       ・新規登録は必ず「顧客」として作る（パートナーへは登録コード・契約からだけ）
--       ・関数（運営が用意した手続き）を通したときだけ、担当やプランが変わる
--    ③ 法人（エンタープライズ）の管理者が、よその顧客を自分の法人に入れられない
--       ・顧問先・席の「追加」は関数からだけ。関数は、法人の担当者の顧客か、運営かを確かめる
--       ・割当は、その法人の稼働中の顧問先と席どうしでしか作れない
--       ・添付ファイルの閲覧判定の誤り（席のIDと本人のIDの取り違え）を直す
--    ④ 閲覧メンバー・副担当の「枠」は、指名されたメールの本人しか受け取れない
--       2名体制の申請は、自分の担当顧客についてだけ。承認は運営だけ
--    ⑤ 担当が替わったら、前の担当の2名体制を自動で終える（前の担当が見え続けない）
--    ⑥ ログインしていない人（anon）からは、持ち主の権限で動く手続き（関数）を呼べないようにする
--    ⑦ 添付の置き場に、大きさ（10MB）と種類（PDF・画像・Office・CSV・テキスト）の上限
--       （HTML や SVG を置かせない＝置き場のURLから画面を開かせない）
--
--  ■ 考え方
--    画面のボタンを隠しても、ブラウザの開発者ツールからは直接データベースに書けます。
--    だから「誰が・何を・どこまで」は、すべてデータベースの側で決めます。
--    書き換えを止めるときは、エラーにせず「元の値のまま」に戻します（今の画面を壊さないため）。
--
--  何度実行しても同じ結果になります。
--  確かめかた（いちばん下）：すべての列が「1」なら完了
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================


-- ---------------------------------------------------------------
-- ① 通知に中身を出すか（ご本人だけが変えられる。既定は出さない）
-- ---------------------------------------------------------------
alter table public.notify_prefs add column if not exists preview_on boolean not null default false;
alter table public.notify_prefs add column if not exists ext_full   boolean not null default false;
comment on column public.notify_prefs.preview_on is 'スマホ通知（ロック画面）に中身を出すか。既定は出さない（届いたことだけ）';
comment on column public.notify_prefs.ext_full   is 'メール・LINE に本文を載せるか。既定は載せない（外部のサービスを通るため）';


-- ---------------------------------------------------------------
-- 共通：いまの書き込みが「信頼できる道」から来ているか
-- ---------------------------------------------------------------
--  ・SQL Editor／サーバーの鍵（service_role）からの操作 → 役割が authenticated・anon でない
--  ・運営が用意した関数（security definer）の中から → その関数の持ち主（postgres）の権限で動く
--  画面（ブラウザ）から直接書いたときだけ、役割が authenticated になる。
--  この関数自体は security invoker（呼んだ人の役割のまま見る）にしておくこと。
create or replace function public.tsugu_trusted_write()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select current_user not in ('authenticated', 'anon')
      or coalesce(current_setting('tsugu.allow_role_change', true), '') = 'on';
$$;

--  運営か（profiles.role = 'admin'）。中で profiles を読むので definer
create or replace function public.tsugu_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.tsugu_is_admin() from public, anon;
grant execute on function public.tsugu_is_admin() to authenticated;

--  行（jsonb）の、指定した列だけを元の値に戻す。列が無い環境でも落ちない
create or replace function public.tsugu_keep_cols(n jsonb, o jsonb, cols text[])
returns jsonb
language plpgsql
immutable
as $$
declare c text;
begin
  foreach c in array cols loop
    if o ? c then n := jsonb_set(n, array[c], o -> c, true); end if;
  end loop;
  return n;
end;
$$;


-- ---------------------------------------------------------------
-- ② 権限の列を、画面から書き換えさせない（profiles）
-- ---------------------------------------------------------------
--  これまで：役割・運営の権限・担当（consultant_id）だけを守っていた。
--  今回足すもの：
--    ・プラン（plan・plan_from・plan_prev）……切り替えは運営だけ（請求に効く）
--    ・ランク（fde_rank）……報酬率に効く。運営だけ
--    ・メール……招待や法人の追加で「本人の照合」に使う。ログインしたメールに合わせる
--    ・新規登録はいつも「顧客」。パートナーになるのは登録コード・契約の手続きからだけ
--  そして、運営が用意した関数（招待の受け取り・契約・担当の割当）からの変更は通す。
--  これまでは関数の中の変更まで元に戻してしまい、担当が付かない・外れない、が起こり得た。
create or replace function public.profiles_freeze_privileged()
returns trigger
language plpgsql
security invoker          -- 呼んだ人の役割のまま判定する（definer にすると全部が信頼扱いになる）
set search_path = public
as $$
declare
  owner_ok boolean := false;
  admin_ok boolean := false;
  n jsonb; o jsonb; my_email text;
begin
  if public.tsugu_trusted_write() then return new; end if;

  begin owner_ok := coalesce(public.is_owner(), false); exception when others then owner_ok := false; end;
  if owner_ok then return new; end if;
  admin_ok := public.tsugu_is_admin();
  my_email := nullif(auth.jwt() ->> 'email', '');

  n := to_jsonb(new);
  if TG_OP = 'UPDATE' then
    o := to_jsonb(old);
    --  代表だけが変えられる列
    n := public.tsugu_keep_cols(n, o, array['role','admin_role','admin_perms','consultant_id']);
    --  運営なら変えられる列
    if not admin_ok then
      n := public.tsugu_keep_cols(n, o, array['plan','plan_from','plan_prev','fde_rank']);
    end if;
    --  メールは、本人の行ならログインしているメールに。ほかの人の行は元のまま
    if (n ->> 'email') is distinct from (o ->> 'email') then
      if new.id = auth.uid() and my_email is not null then
        n := jsonb_set(n, '{email}', to_jsonb(my_email), true);
      else
        n := public.tsugu_keep_cols(n, o, array['email']);
      end if;
    end if;
  else
    --  新規。画面から作るときは、いつも顧客として作る
    n := jsonb_set(n, '{role}', '"customer"', true);
    if n ? 'admin_role'    then n := jsonb_set(n, '{admin_role}',    'null', true); end if;
    if n ? 'admin_perms'   then n := jsonb_set(n, '{admin_perms}',   'null', true); end if;
    if n ? 'consultant_id' then n := jsonb_set(n, '{consultant_id}', 'null', true); end if;
    if n ? 'fde_rank'      then n := jsonb_set(n, '{fde_rank}',      'null', true); end if;
    if n ? 'plan_from'     then n := jsonb_set(n, '{plan_from}',     'null', true); end if;
    if n ? 'plan_prev'     then n := jsonb_set(n, '{plan_prev}',     'null', true); end if;
    if new.id = auth.uid() and my_email is not null then
      n := jsonb_set(n, '{email}', to_jsonb(my_email), true);
    end if;
  end if;
  new := jsonb_populate_record(new, n);
  return new;
end;
$$;

drop trigger if exists profiles_freeze_privileged on public.profiles;
create trigger profiles_freeze_privileged
  before insert or update on public.profiles
  for each row execute function public.profiles_freeze_privileged();


-- ---------------------------------------------------------------
-- ③ 法人（エンタープライズ）の管理者の権限を、決めた範囲だけに
-- ---------------------------------------------------------------
--  これまで：管理者のポリシーが「何でもできる（for all）」だったため、
--  画面を通さずに、よその顧客を自分の法人の顧問先に入れられた。
--  入れると、その顧客の添付・出口の設計・買いたい条件などが見えてしまう。
--  直したあと：
--    顧問先（ep_clients）……管理者は「読む」と「状態・初期導入費の更新」だけ。追加は関数から
--    席（ep_members）……管理者は「読む」と「外す／戻す・認定日の更新」だけ。追加は関数から
--    割当（ep_grants）……同じ法人の、稼働中の顧問先と席どうしでしか作れない
--  割当を作ってよい組み合わせか（同じ法人の、稼働中の顧問先と稼働中の席）。
--  ポリシーの中で ep_clients を直接読むと、ep_clients のポリシーが ep_grants を読み返して
--  堂々めぐりになるので、関数（definer）の中で確かめる
do $do$ begin
  if to_regclass('public.ep_clients') is null then return; end if;
  execute $f$
create or replace function public.ep_grant_ok(p_ep uuid, p_member uuid, p_customer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.ep_clients c
                  where c.ep_id = p_ep and c.customer_id = p_customer and c.status = 'active')
     and exists (select 1 from public.ep_members m
                  where m.id = p_member and m.ep_id = p_ep and m.status = 'active');
$$;
$f$;
  execute 'revoke all on function public.ep_grant_ok(uuid, uuid, uuid) from public, anon';
  execute 'grant execute on function public.ep_grant_ok(uuid, uuid, uuid) to authenticated';
end $do$;

do $do$ begin
  if to_regclass('public.ep_clients') is null then
    raise notice '法人の表がありません（エンタープライズ未導入）。③は飛ばします';
    return;
  end if;

  execute 'drop policy if exists "ep_clients manager" on public.ep_clients';
  execute 'drop policy if exists "ep_clients manager read" on public.ep_clients';
  execute 'drop policy if exists "ep_clients manager update" on public.ep_clients';
  execute 'create policy "ep_clients manager read" on public.ep_clients for select to authenticated using (public.ep_is_manager(ep_id))';
  execute 'create policy "ep_clients manager update" on public.ep_clients for update to authenticated using (public.ep_is_manager(ep_id)) with check (public.ep_is_manager(ep_id))';

  execute 'drop policy if exists "ep_members manager" on public.ep_members';
  execute 'drop policy if exists "ep_members manager update" on public.ep_members';
  execute 'create policy "ep_members manager update" on public.ep_members for update to authenticated using (public.ep_is_manager(ep_id)) with check (public.ep_is_manager(ep_id))';

  execute 'drop policy if exists "ep_grants manager" on public.ep_grants';
  execute 'drop policy if exists "ep_grants manager read" on public.ep_grants';
  execute 'drop policy if exists "ep_grants manager insert" on public.ep_grants';
  execute 'drop policy if exists "ep_grants manager update" on public.ep_grants';
  execute 'create policy "ep_grants manager read" on public.ep_grants for select to authenticated using (public.ep_is_manager(ep_id))';
  execute $p$create policy "ep_grants manager insert" on public.ep_grants for insert to authenticated with check (
      public.ep_is_manager(ep_id) and public.ep_grant_ok(ep_id, member_id, customer_id))$p$;
  execute 'create policy "ep_grants manager update" on public.ep_grants for update to authenticated using (public.ep_is_manager(ep_id)) with check (public.ep_is_manager(ep_id))';
end $do$;

--  更新で変えてよい列を絞る（法人・顧客・人の付け替えはさせない）
create or replace function public.ep_rows_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare n jsonb;
begin
  if public.tsugu_trusted_write() or public.tsugu_is_admin() then return new; end if;
  n := public.tsugu_keep_cols(to_jsonb(new), to_jsonb(old),
         case TG_TABLE_NAME
           when 'ep_clients' then array['id','ep_id','customer_id']
           when 'ep_members' then array['id','ep_id','user_id','seat_role','granted_by']
           when 'ep_grants'  then array['id','ep_id','member_id','customer_id','grant_role','granted_by']
           else array[]::text[] end);
  new := jsonb_populate_record(new, n);
  return new;
end;
$$;

do $do$
declare t text;
begin
  foreach t in array array['ep_clients','ep_members','ep_grants'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_guard', t);
      execute format('create trigger %I before update on public.%I for each row execute function public.ep_rows_guard()', t || '_guard', t);
    end if;
  end loop;
end $do$;

--  顧問先の追加：管理者が入れられるのは「自分の法人の担当者が、いま担当している顧客」だけ。
--  それ以外（担当のいない顧客・よそのパートナーの顧客）は運営が入れる。
--  メールを知っているだけで、よその会社を自分の法人に入れられないようにする。
do $do$ begin
  if to_regclass('public.ep_clients') is null then return; end if;
  execute $f$
create or replace function public.ep_add_client(p_ep uuid, p_email text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
  v_cons uuid;
begin
  if not (public.ep_is_manager(p_ep) or public.ep_is_admin()) then
    return json_build_object('ok', false, 'error', 'この法人の管理者だけが追加できます');
  end if;

  select p.id, coalesce(p.company_name, p.email), p.consultant_id
    into v_id, v_name, v_cons
    from public.profiles p
   where lower(p.email) = lower(btrim(p_email)) and p.role = 'customer'
   limit 1;

  if v_id is null then
    return json_build_object('ok', false, 'error', 'そのメールの顧客が見つかりません。先に顧客登録をお願いします');
  end if;

  --  2026-10-10 情報の守り：管理者が入れられるのは、自法人の稼働中の担当者が担当している顧客だけ
  if not public.ep_is_admin() and not exists (
    select 1 from public.ep_members m
     where m.ep_id = p_ep and m.user_id = v_cons and m.status = 'active'
  ) then
    return json_build_object('ok', false, 'error', 'この顧客は、御社の担当者の担当になっていません。顧問先への追加は運営にご依頼ください（お客様の情報を守るため、運営が確認してから追加します）');
  end if;

  if exists (select 1 from public.ep_clients c
              where c.ep_id = p_ep and c.customer_id = v_id and c.status = 'active') then
    return json_build_object('ok', false, 'error', 'すでに顧問先に入っています');
  end if;

  insert into public.ep_clients (ep_id, customer_id)
  values (p_ep, v_id)
  on conflict (ep_id, customer_id)
  do update set status = 'active', ended_on = null;

  insert into public.ep_audit (ep_id, action, detail, actor)
  values (p_ep, 'client_add', jsonb_build_object('customer_id', v_id), auth.uid());

  return json_build_object('ok', true, 'customer_id', v_id, 'name', v_name);
end;
$$;
$f$;
end $do$;

--  席の追加：管理者が入れられるのは、ほかに担当顧客を持っていない（＝御社の外に
--  顧客がいない）パートナーだけ。入れると、法人の担当表にその人の顧客が並ぶため、
--  よそで活動しているパートナーを勝手に入れて顧客一覧を見る、ができないようにする。
do $do$
declare src text;
begin
  if to_regprocedure('public.ep_add_member(uuid,text,text)') is null then return; end if;
  src := pg_get_functiondef('public.ep_add_member(uuid,text,text)'::regprocedure);
  if position('2026-10-10 情報の守り' in src) > 0 then return; end if;   -- もう入っている
  --  「見つかりません」の判定の直後に、確かめを1つ差し込む
  src := replace(src,
    $a$    return json_build_object('ok', false, 'error', 'そのメールの認定パートナーが見つかりません');
  end if;$a$,
    $a$    return json_build_object('ok', false, 'error', 'そのメールの認定パートナーが見つかりません');
  end if;

  --  2026-10-10 情報の守り：御社の外に担当顧客がいるパートナーは、運営が確認してから
  if not public.ep_is_admin() and exists (
    select 1 from public.profiles c
     where c.consultant_id = v_id and c.role = 'customer'
       and not exists (select 1 from public.ep_clients e
                        where e.ep_id = p_ep and e.customer_id = c.id and e.status = 'active')
  ) then
    return json_build_object('ok', false, 'error', 'この方は、御社の顧問先以外にも担当している顧客がいます。席への追加は運営にご依頼ください（お客様の情報を守るため、運営が確認してから追加します）');
  end if;$a$);
  if position('2026-10-10 情報の守り' in src) = 0 then
    --  止めずに知らせる（ほかの直しは進める）。いちばん下の「席の追加」が 0 になる
    raise notice 'ep_add_member の中身が想定と違うため、確かめを差し込めませんでした。開発に連絡してください';
    return;
  end if;
  execute src;
end $do$;

--  添付ファイルを見てよいか（chat_att_may）。割当の判定で「席のID」と「本人のID」を
--  取り違えていたのを直す。あわせて、割当は稼働中の顧問先・稼働中の席のときだけ効く。
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

  --  承認済みの2名体制（主担当・副担当）。主担当は、いまの担当であるときだけ
  if to_regclass('public.partner_assignments') is not null then
    execute
      'select exists (select 1 from public.partner_assignments a
                        join public.profiles p on p.id = a.customer_id
                       where a.customer_id = $1 and a.status = ''approved''
                         and ((a.main_id = $2 and p.consultant_id = $2) or a.sub_id = $2))'
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

  --  個別に配られた閲覧権（EP-II など）。席（ep_members.id）を通して本人に結ぶ
  if to_regclass('public.ep_grants') is not null then
    execute
      'select exists (select 1 from public.ep_grants g
                        join public.ep_members m on m.id = g.member_id and m.ep_id = g.ep_id
                        join public.ep_clients c on c.ep_id = g.ep_id and c.customer_id = g.customer_id
                       where g.customer_id = $1 and m.user_id = $2
                         and m.status = ''active'' and c.status = ''active''
                         and g.revoked_at is null)'
      into hit using p_customer, me;
    if hit then return true; end if;
  end if;

  return false;
end;
$$;

revoke all on function public.chat_att_may(uuid) from public, anon;
grant execute on function public.chat_att_may(uuid) to authenticated;


-- ---------------------------------------------------------------
-- ④ 閲覧メンバー・副担当の枠は、指名されたメールの本人だけが受け取れる
-- ---------------------------------------------------------------
--  画面はログインのたびに「自分のメールで指名されている空き枠」を自分に結びつける。
--  データベースの側でも、メールが一致する本人にしか結びつけないようにする。
--  （画面を通さずに、メールの条件を外して空き枠を全部取る、をさせない）
create or replace function public.member_links_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  my_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  n jsonb; o jsonb;
  id_col text; mail_col text;
  is_mine boolean;
begin
  if public.tsugu_trusted_write() or public.tsugu_is_admin() then return new; end if;

  if TG_TABLE_NAME = 'company_members' then id_col := 'member_id'; mail_col := 'member_email';
  else id_col := 'sub_id'; mail_col := 'sub_email'; end if;

  n := to_jsonb(new);

  if TG_OP = 'INSERT' then
    --  作るときは空き枠として作る（受け取るのは指名された本人）
    if n ? id_col then n := jsonb_set(n, array[id_col], 'null', true); end if;
    if TG_TABLE_NAME = 'partner_assignments' then
      --  2名体制の申請は、自分が担当している顧客についてだけ。承認は運営
      if (n ->> 'main_id') is distinct from auth.uid()::text
         or not exists (select 1 from public.profiles p
                         where p.id = (n ->> 'customer_id')::uuid and p.consultant_id = auth.uid()) then
        raise exception '2名体制の申請は、ご自身が担当している顧客についてだけできます';
      end if;
      n := jsonb_set(n, '{status}', '"pending"', true);
      if n ? 'decided_at' then n := jsonb_set(n, '{decided_at}', 'null', true); end if;
      if n ? 'admin_note' then n := jsonb_set(n, '{admin_note}', 'null', true); end if;
    end if;
    new := jsonb_populate_record(new, n);
    return new;
  end if;

  o := to_jsonb(old);
  --  枠そのもの（どの会社の・誰あての）は変えさせない
  n := public.tsugu_keep_cols(n, o, array['customer_id', mail_col]);
  if TG_TABLE_NAME = 'partner_assignments' then
    n := public.tsugu_keep_cols(n, o, array['main_id','main_share','sub_share']);
    --  状態は「終える」だけ（承認・却下は運営）
    if (n ->> 'status') is distinct from (o ->> 'status') and (n ->> 'status') <> 'ended' then
      n := public.tsugu_keep_cols(n, o, array['status','decided_at','admin_note']);
    end if;
  end if;
  --  空き枠を受け取れるのは、指名されたメールの本人だけ
  if (n ->> id_col) is distinct from (o ->> id_col) then
    is_mine := (o ->> id_col) is null
           and (n ->> id_col) = auth.uid()::text
           and my_email <> ''
           and lower(coalesce(o ->> mail_col, '')) = my_email;
    if not is_mine then n := public.tsugu_keep_cols(n, o, array[id_col]); end if;
  end if;
  new := jsonb_populate_record(new, n);
  return new;
end;
$$;

do $do$
declare t text;
begin
  foreach t in array array['company_members','partner_assignments'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_links_guard', t);
      execute format('create trigger %I before insert or update on public.%I for each row execute function public.member_links_guard()', t || '_links_guard', t);
    end if;
  end loop;
end $do$;


-- ---------------------------------------------------------------
-- ⑤ 担当が替わったら、前の担当の2名体制を終える
-- ---------------------------------------------------------------
--  ほとんどの読み取りの権限は「2名体制の主担当なら見てよい」を含む。
--  担当を付け替えたときに2名体制が残っていると、前の担当がその会社を見続けてしまう。
create or replace function public.end_stale_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.consultant_id is distinct from old.consultant_id
     and old.consultant_id is not null
     and to_regclass('public.partner_assignments') is not null then
    execute 'update public.partner_assignments set status = ''ended'', decided_at = now()
              where customer_id = $1 and status in (''approved'',''pending'') and main_id = $2'
      using new.id, old.consultant_id;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_end_stale on public.profiles;
create trigger profiles_end_stale
  after update of consultant_id on public.profiles
  for each row execute function public.end_stale_assignments();

--  すでに残っているぶんも、いま片づける
do $do$ begin
  if to_regclass('public.partner_assignments') is not null then
    update public.partner_assignments a
       set status = 'ended', decided_at = now()
      from public.profiles p
     where p.id = a.customer_id
       and a.status in ('approved','pending')
       and a.main_id is distinct from p.consultant_id;
  end if;
end $do$;


-- ---------------------------------------------------------------
-- ⑥ ログインしていない人からは、手続き（関数）を呼べないように
-- ---------------------------------------------------------------
--  Supabase は新しく作った関数を、既定でログイン前（anon）にも呼べるようにしている。
--  中で「ログインしているか」を見ている関数がほとんどだが、二重に閉じておく。
--  対象は、持ち主の権限で動く関数（security definer）。ただし
--    ・ログイン前に使う手続き（契約書を開く・同意する）
--    ・権限の判定（ポリシー）の中で使われている関数（閉じると、読めないではなくエラーになる）
--  は残す。
do $do$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
       and p.proname not in ('contract_open', 'contract_agree')
       and has_function_privilege('anon', p.oid, 'execute')
       and not exists (select 1 from pg_policies pol
                        where position(p.proname || '(' in coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) > 0)
  loop
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('revoke execute on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $do$;


-- ---------------------------------------------------------------
-- ⑦ 添付の置き場に、大きさと種類の上限
-- ---------------------------------------------------------------
do $do$ begin
  if exists (select 1 from storage.buckets where id = 'chat-attach') then
    update storage.buckets
       set public = false,
           file_size_limit = 10485760,   -- 10MB（画面の上限と同じ）
           allowed_mime_types = array[
             'application/pdf',
             'image/png','image/jpeg','image/webp','image/gif','image/heic','image/heif',
             'text/csv','text/plain',
             'application/vnd.ms-excel',
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             'application/msword',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/vnd.ms-powerpoint',
             'application/vnd.openxmlformats-officedocument.presentationml.presentation',
             'application/octet-stream'
           ]
     where id = 'chat-attach';
  end if;
  if exists (select 1 from storage.buckets where id = 'license-docs') then
    update storage.buckets
       set public = false,
           file_size_limit = 10485760,
           allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp','image/heic','image/heif']
     where id = 'license-docs';
  end if;
end $do$;


-- 確かめる -----------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'notify_prefs' and column_name in ('preview_on','ext_full')) / 2 as "通知の中身",
  (select count(*) from pg_trigger where tgname = 'profiles_freeze_privileged' and not tgisinternal)          as "権限の列",
  (select case when to_regclass('public.ep_clients') is null then 1
               when exists (select 1 from pg_policies where tablename = 'ep_clients' and policyname = 'ep_clients manager') then 0
               else 1 end)                                                                                    as "法人の権限",
  (select case when to_regprocedure('public.ep_add_member(uuid,text,text)') is null then 1
               when position('2026-10-10 情報の守り' in pg_get_functiondef('public.ep_add_member(uuid,text,text)'::regprocedure)) > 0 then 1
               else 0 end)                                                                                    as "席の追加",
  (select case when to_regclass('public.company_members') is null then 1
               else (select count(*) from pg_trigger where tgname = 'company_members_links_guard') end)    as "枠の受け取り",
  (select count(*) from pg_trigger where tgname = 'profiles_end_stale')                                       as "担当替え",
  (select case when to_regprocedure('public.claim_client(text)') is null then 1
               when has_function_privilege('anon', 'public.claim_client(text)', 'execute') then 0 else 1 end) as "ログイン前",
  (select case when not exists (select 1 from storage.buckets where id = 'chat-attach') then 1
               else (select count(*) from storage.buckets where id = 'chat-attach' and file_size_limit = 10485760) end) as "添付の上限";
