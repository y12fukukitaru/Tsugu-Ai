-- =============================================================
-- 継ナビくんのカレンダー（本人だけの予定）
--
--  Googleカレンダーを読みに行くのではなく、TsuguAi の中に予定の置き場所を
--  持つ。外部サービスの審査に公開日を左右されず、顧客の私的な予定が
--  外に出ることもない。
--
--  面談（meetings_scheduled）はここに複製しない。パートナーが登録した
--  ものが正なので、画面と継ナビくんの回答では読むときに重ねて見せる。
--
--  RLS：本人の行だけ。運営もパートナーも他人の予定は読めない。
--       （面談は従来どおり meetings_scheduled 側の権限で共有される）
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================

create table if not exists public.agenda_events (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  all_day    boolean not null default false,
  place      text,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agenda_events_owner_starts
  on public.agenda_events (owner_id, starts_at);

alter table public.agenda_events enable row level security;

-- 本人だけが読み書きできる
drop policy if exists "agenda own select" on public.agenda_events;
create policy "agenda own select" on public.agenda_events
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists "agenda own insert" on public.agenda_events;
create policy "agenda own insert" on public.agenda_events
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "agenda own update" on public.agenda_events;
create policy "agenda own update" on public.agenda_events
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "agenda own delete" on public.agenda_events;
create policy "agenda own delete" on public.agenda_events
  for delete to authenticated using (owner_id = auth.uid());

-- 更新日時を自動で持たせる
create or replace function public.agenda_events_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agenda_events_touch on public.agenda_events;
create trigger agenda_events_touch
  before update on public.agenda_events
  for each row execute function public.agenda_events_touch();
