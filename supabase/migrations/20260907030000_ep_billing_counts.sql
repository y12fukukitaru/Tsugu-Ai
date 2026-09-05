-- =============================================================
-- EP（法人）の利用料を計算するための人数と顧客数
-- ---------------------------------------------------------------
--  EP-I の利用料は、法人がまとめてお支払いになります。
--
--    担当者ぶん … 3,000円/人  または  10人まで定額 15,000円（お得なほう）
--    顧問先加算 … 顧客数 × 2,000円
--    （いずれも税別）
--
--  この計算には「いま在籍している担当者の数」と「いま担当している
--  顧客の数」が要ります。どちらも配分画面（運営）でしか使いません。
--
--  ■ 数える範囲をここで固定しておく
--    担当者は status='active' のみ。抜けた方まで数えると、法人に
--    払っていない人数ぶんのご請求が立ちます。顧客も同じく 'active'。
--    画面側で数えると、画面ごとに数え方がずれます。ずれた数字は
--    そのままご請求額になるので、数えるのは一か所にします。
--
--  確かめかた：数える関数=1
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================

create or replace function public.ep_billing_counts(p_eps uuid[])
returns table (ep_id uuid, ep_name text, ep_kind text,
               members int, clients int)
language sql security definer stable set search_path = public as $$
  select o.id, o.name, o.kind,
         (select count(*)::int from public.ep_members m
           where m.ep_id = o.id and m.status = 'active'),
         (select count(*)::int from public.ep_clients c
           where c.ep_id = o.id and c.status = 'active')
    from public.ep_orgs o
   where o.id = any(p_eps)
     --  ご請求の材料なので、運営だけに返す
     and exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin');
$$;

revoke all on function public.ep_billing_counts(uuid[]) from public, anon;
grant execute on function public.ep_billing_counts(uuid[]) to authenticated;

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='ep_billing_counts') as "数える関数";
--  期待値：数える関数=1
-- =============================================================
