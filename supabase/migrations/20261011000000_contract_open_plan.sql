-- =============================================================
-- 契約書を開いたときにも、プランの名前を本文に入れる（2026-10-11）
-- ---------------------------------------------------------------
--  これまで：本文の {{プラン}} は「同意したとき」にだけ埋めていた。
--  そのため、同意する前の契約書に「プラン：{{プラン}}」と記号のまま出ていた。
--  今回：開いたときも、同意のとき（contract_agree）と同じ言い方で埋め、
--        プラン（buyer / seller）も返す（画面の「ご契約の条件」の枠に出す）。
--  ほかは 20260906010000_contract_ep.sql の contract_open と同じ。
--  同意したあとの控え（agreed_body）は、同意のときに埋めたものをそのまま返す。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--   何度流しても同じ結果になります。
-- =============================================================

create or replace function public.contract_open(p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  o  public.contract_offers%rowtype;
  hq text;
  b  text;
begin
  select * into o from public.contract_offers where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'この契約書は見つかりませんでした。URLをご確認ください。');
  end if;
  if o.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'この契約は取り消されています。送り主にお問い合わせください。');
  end if;
  if o.status = 'sent' and o.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'この契約書の有効期限が切れています。送り主に再発行をご依頼ください。');
  end if;

  if o.ep_id is not null then
    select name into hq from public.ep_orgs where id = o.ep_id;
  end if;

  if o.status = 'agreed' then
    b := o.agreed_body;
  else
    b := public.contract_fill(o.body, o.email, o.monthly_fee, null, null, null, hq);
    --  同意のとき（contract_agree）と同じ言い方。顧問契約以外や未指定なら「—」
    b := replace(b, '{{プラン}}',
      case when o.plan = 'seller' then '売り手プラン（譲渡準備）'
           when o.plan = 'buyer'  then '買い手プラン（成長）'
           else '—' end);
  end if;

  return jsonb_build_object(
    'ok', true,
    'kind', o.kind,
    'email', o.email,
    'title', o.title,
    'body', b,
    'monthly_fee', o.monthly_fee,
    'plan', o.plan,
    'hq_name', hq,
    'org_required', (o.kind in ('customer','partner_ep1','partner_ep2')),
    'status', o.status,
    'agreed_at', o.agreed_at,
    'agreed_name', o.agreed_name,
    'agreed_org', o.agreed_org
  );
end;
$$;

revoke all on function public.contract_open(text) from public;
grant execute on function public.contract_open(text) to anon, authenticated;

-- 確かめ（1 なら完了）
select count(*) as "開いたときにプランを埋める"
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'contract_open'
   and position('{{プラン}}' in pg_get_functiondef(p.oid)) > 0;
