-- =============================================================
-- EP-I の「主担当」を、顧客管理に出る担当と同じ人にする
-- ---------------------------------------------------------------
--  これまで、EP-I の法人が「担当の割当」で主担当を決めても、
--  その担当者の「顧客管理」には顧問先が出てきませんでした。
--  画面のどこにも書いていないのに、運営が profiles.consultant_id を
--  手で入れ直すまで何も起きない——法人からは、割り当てたのに
--  動いていないようにしか見えません。
--
--  原因は、担当の置き場所が二つあることです。
--    ep_grants.grant_role='main' … 法人が決めた主担当
--    profiles.consultant_id      … 顧客管理・カルテ・配分が見る担当
--  後者が正ですが、法人の管理者は profiles を書けません（書けてよい
--  ものでもありません）。そこで、この関数だけに書き込みを許します。
--
--  守っていること：
--    ・EP-I の管理者か運営だけが呼べる
--    ・自分の法人の、いま生きている顧問先だけ
--    ・入れられるのは、同じ法人の活きている席の人だけ
--    ・外すとき（p_user が null）は、いま入っている担当が
--      同じ法人の人のときだけ消す。運営が別の方を当てていた場合に、
--      法人の操作でその紐づきを消してしまわないため
--
--  確かめかた：関数=1、実行できる人=authenticated のみ、
--             主担当を付け替えると profiles.consultant_id が追う
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になります。
-- =============================================================

create or replace function public.ep_sync_client_consultant(
  p_ep       uuid,
  p_customer uuid,
  p_user     uuid
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_cur  uuid;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'ログインが必要です');
  end if;

  if not (public.ep_is_manager(p_ep) or public.ep_is_admin()) then
    return json_build_object('ok', false, 'error', 'この法人の管理者だけが担当を決められます');
  end if;

  select kind into v_kind from public.ep_orgs where id = p_ep;
  if v_kind is null then
    return json_build_object('ok', false, 'error', 'その法人が見つかりません');
  end if;
  --  EP-II は顧客が継に帰属し、担当は継が決めます。本部からは動かしません
  if v_kind <> 'EP1' then
    return json_build_object('ok', false, 'error', 'EP-II では、担当は継が設定します');
  end if;

  if not exists (
    select 1 from public.ep_clients c
     where c.ep_id = p_ep and c.customer_id = p_customer and c.status = 'active'
  ) then
    return json_build_object('ok', false, 'error', 'その顧問先は、この法人の（稼働中の）顧問先ではありません');
  end if;

  select consultant_id into v_cur from public.profiles where id = p_customer;

  if p_user is not null then
    if not exists (
      select 1 from public.ep_members m
       where m.ep_id = p_ep and m.user_id = p_user and m.status = 'active'
    ) then
      return json_build_object('ok', false, 'error', 'その担当者は、この法人の活きている席ではありません');
    end if;
    update public.profiles set consultant_id = p_user where id = p_customer;
  else
    --  外すとき。いま入っている担当が同じ法人の方でなければ、触らない
    if v_cur is not null and exists (
      select 1 from public.ep_members m
       where m.ep_id = p_ep and m.user_id = v_cur and m.status = 'active'
    ) then
      update public.profiles set consultant_id = null where id = p_customer;
    else
      return json_build_object('ok', true, 'changed', false, 'kept', v_cur);
    end if;
  end if;

  insert into public.ep_audit (ep_id, action, detail, actor)
  values (p_ep, 'grant_sync',
          jsonb_build_object('customer_id', p_customer, 'from', v_cur, 'to', p_user),
          auth.uid());

  return json_build_object('ok', true, 'changed', true, 'to', p_user);
end;
$$;

comment on function public.ep_sync_client_consultant(uuid, uuid, uuid) is
  'EP-I の主担当を profiles.consultant_id に映す。法人の管理者と運営だけ';

revoke all on function public.ep_sync_client_consultant(uuid, uuid, uuid) from public, anon;
grant execute on function public.ep_sync_client_consultant(uuid, uuid, uuid) to authenticated;


-- ---------------------------------------------------------------
-- すでに付いている主担当を、いちど揃える
-- ---------------------------------------------------------------
--  この移行より前に割り当てた顧問先は、担当が入っていないままです。
--  いま空欄のものだけ埋めます（運営が別の方を当てているものは触りません）。
update public.profiles p
   set consultant_id = m.user_id
  from public.ep_grants  g
  join public.ep_members m on m.id = g.member_id and m.status = 'active'
  join public.ep_orgs    o on o.id = g.ep_id and o.kind = 'EP1'
  join public.ep_clients c on c.ep_id = g.ep_id and c.customer_id = g.customer_id and c.status = 'active'
 where g.customer_id = p.id
   and g.revoked_at is null
   and g.grant_role = 'main'
   and p.consultant_id is null;


-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from pg_proc
    where proname = 'ep_sync_client_consultant')::text                        as 関数,
  (select has_function_privilege('anon',
     'public.ep_sync_client_consultant(uuid,uuid,uuid)', 'execute'))::text    as anonが実行,
  (select count(*) from public.ep_grants g
     join public.ep_orgs o on o.id = g.ep_id and o.kind = 'EP1'
     join public.ep_members m on m.id = g.member_id and m.status = 'active'
     join public.profiles p on p.id = g.customer_id
    where g.revoked_at is null and g.grant_role = 'main'
      and p.consultant_id is distinct from m.user_id)::text                   as まだ食い違う件数;
-- 期待：関数=1、anonが実行=false、まだ食い違う件数=0
--       （運営が意図して別の方を当てている場合は、そのぶんだけ残ります）
