-- =============================================================
-- claim_client：ほかのパートナーの顧客を横取りできてしまう穴をふさぐ
-- ---------------------------------------------------------------
--  いまの claim_client は、最後にこう書くだけになっている。
--
--      update public.profiles set consultant_id = auth.uid() where id = target
--
--  「その方にすでに担当がいるか」を見ていない。つまり、顧客のメールアドレスを
--  知っているパートナーなら誰でも「＋ 顧客を追加」に入れるだけで、
--  ほかのパートナーが担当している顧客を自分に付け替えられてしまう。
--  前の担当には何の通知も残らない。
--
--  顧問料の配分は担当パートナーを見て決まる。付け替えが黙って通るということは、
--  報酬の付け替えが黙って通るということでもある。ローンチ前に必ず閉じる。
--
--  直しかた：担当が「いない」か「自分」のときだけ書き込む。
--  すでにほかの方が担当していれば、断って理由を返す。
--
--  運営（admin）だけは付け替えられる。担当を移す手立てがどこにも無くなると、
--  パートナーが退会したときに顧客が宙に浮くため。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           一度だけ。二度流しても壊れない。
-- =============================================================

create or replace function public.claim_client(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me      uuid := auth.uid();
  me_role text;
  target  uuid;
  cur     uuid;
begin
  if me is null then
    return 'error: ログインが必要です';
  end if;

  --  ① 呼んだ人が、パートナーか運営であること（ここは元のままの考え方）
  select role into me_role from public.profiles where id = me;
  if me_role is null or me_role not in ('consultant','admin') then
    return 'error: 認定パートナーまたは運営のみご利用いただけます';
  end if;

  --  ② その顧客を探す。担当が誰かも一緒に取る
  select id, consultant_id into target, cur
    from public.profiles
   where lower(email) = lower(p_email)
     and role = 'customer';

  --  ③ 見つからない
  --     この文言は画面側が見ている。「見つかりません」が含まれるときだけ、
  --     パートナーの画面は招待（customer_invites）に切り替える。
  --     ここを書き換えるときは index.html の claimClient も一緒に直すこと。
  if target is null then
    return 'error: 該当する顧客アカウントが見つかりません（先に顧客としてご登録ください）';
  end if;

  --  ④ すでに自分が担当。何度押しても同じ結果になるように、成功として返す
  if cur = me then
    return 'ok';
  end if;

  --  ⑤ ここが今回の要。ほかの方が担当しているなら、パートナーには断る
  if cur is not null and me_role <> 'admin' then
    return 'error: この方は、すでにほかのパートナーが担当しています。担当の変更は運営までご連絡ください';
  end if;

  update public.profiles set consultant_id = me where id = target;
  return 'ok';
end;
$$;

revoke all on function public.claim_client(text) from public;
grant execute on function public.claim_client(text) to authenticated;

comment on function public.claim_client(text) is
  '登録済みの顧客を自分の担当にする。すでに担当がいる方は運営のみ付け替えられる';


-- ---------------------------------------------------------------
-- 確認（Run のあとに、これだけ見れば十分）
-- ---------------------------------------------------------------
select
  prosrc like '%すでにほかのパートナー%'  as 横取り防止あり,
  prosrc like '%見つかりません%'          as 招待への切替が効く
from pg_proc where proname = 'claim_client';
--  期待値：どちらも true

-- ---------------------------------------------------------------
-- すでに起きていないかの確認（任意）
-- ---------------------------------------------------------------
--  同じ顧客の担当が短い間に入れ替わっていないかは、監査ログで追えます。
--  いま担当が付いている顧客の一覧は、これで見られます。
--
--    select p.email as 顧客, c.email as 担当パートナー, p.updated_at
--      from public.profiles p
--      left join public.profiles c on c.id = p.consultant_id
--     where p.role = 'customer'
--     order by p.updated_at desc nulls last;
-- =============================================================
