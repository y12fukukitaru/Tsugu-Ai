-- =============================================================
-- 別の Google アカウントにつなぎ替えたら、前の札を捨てる
-- ---------------------------------------------------------------
--  会社のアカウントから個人のアカウントへつなぎ替えたところ、
--  「同期はできたのに、予定が一件も入らない」という状態になりました。
--
--  Google は「前回からの差分だけ」をくれる札（syncToken）を返します。
--  つなぎ替えのとき google_link_save は同じ行を上書きするので、
--  **前のアカウントの札が残ったまま**でした。別のアカウントに他人の
--  札を出すようなもので、Google は「その札はもう無効」と返します。
--
--  Edge Function 側には、それを受けて取り直す道を書いてありましたが、
--  そちらにも書き方の誤りがあって働いていませんでした（google-sync を
--  貼り直していただく必要があります）。
--
--  ここでは、そもそも**古い札を残さない**ようにします。つなぐ相手が
--  変わったら、札も、前のアカウントから取り込んだ予定も捨てます。
--  取り直しの仕組みに頼らず、入口で正しくしておくほうが確かです。
--
--  確かめかた：関数=1、いまの札=（空）
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度実行しても同じ結果になります。
-- =============================================================

create or replace function public.google_link_save(
  p_user uuid, p_email text, p_refresh text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_before text;
begin
  select google_email into v_before
    from public.google_cal_links where user_id = p_user;

  --  つなぐ相手が変わったなら、前のアカウントのものを片付ける。
  --  ・札（syncToken）… 別のアカウントでは通じない
  --  ・取り込んだ予定 … 前のアカウントのもので、もう更新されない
  if v_before is not null and coalesce(p_email,'') <> coalesce(v_before,'') then
    delete from public.agenda_events
     where owner_id = p_user and source = 'google';
    update public.agenda_events
       set google_id = null, google_etag = null, synced_at = null
     where owner_id = p_user and google_id is not null;
  end if;

  insert into public.google_cal_links (user_id, google_email, refresh_enc, updated_at)
  values (p_user, p_email,
          case when coalesce(p_refresh,'') = '' then null
               else pgp_sym_encrypt(p_refresh, public.google_key()) end,
          now())
  on conflict (user_id) do update
    set google_email = excluded.google_email,
        --  つなぎ直しのとき、Google は更新用の鍵を返さないことがあります。
        --  そのときは前のものを残します（消すとつながらなくなる）
        refresh_enc  = coalesce(excluded.refresh_enc, public.google_cal_links.refresh_enc),
        --  相手が変わったら札を捨てる。同じ相手なら、そのまま差分で続ける
        sync_token   = case
                         when coalesce(excluded.google_email,'') <> coalesce(public.google_cal_links.google_email,'')
                           then null
                         else public.google_cal_links.sync_token
                       end,
        --  短いほうの鍵も、相手が変われば通じない
        access_token = case
                         when coalesce(excluded.google_email,'') <> coalesce(public.google_cal_links.google_email,'')
                           then null
                         else public.google_cal_links.access_token
                       end,
        last_error   = null,
        updated_at   = now();
end $$;

revoke all on function public.google_link_save(uuid, text, text) from public, anon, authenticated;

comment on function public.google_link_save(uuid, text, text) is
  'Googleとのつながりを保存する。つなぐ相手が変わったら、前の札と取り込んだ予定を捨てる';


-- ---------------------------------------------------------------
-- いま残っている札を、一度だけ捨てる
-- ---------------------------------------------------------------
--  すでに古い札が入っている行があります。次の同期で日付を区切った
--  取り方から始まるよう、ここで空にします。
update public.google_cal_links
   set sync_token = null, access_token = null, last_error = null
 where sync_token is not null or access_token is not null;


-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='google_link_save')::text        as 関数,
  (select count(*) from public.google_cal_links
    where sync_token is not null)::text                                     as 札が残っている行,
  (select count(*) from public.google_cal_links)::text                       as つながり,
  public.crypto_ok()::text                                                   as 暗号化できるか;
-- 期待：関数=1、札が残っている行=0、暗号化できるか=true
