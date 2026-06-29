-- ============================================================
-- Academy: real game scores + a team-safe leaderboard function.
--  • add academy_progress.score (best correct-answer count per game)
--  • academy_leaderboard(): SECURITY DEFINER so any approved employee can read the
--    RANKED, AGGREGATED board (name + points + %) — never anyone's raw rows.
-- Run in the SQL Editor; confirm the "destructive operations" / "Run query" modal.
-- ============================================================

alter table public.academy_progress add column if not exists score int not null default 0;

create or replace function public.academy_leaderboard()
returns table (
  user_id          uuid,
  name             text,
  terms_mastered   int,
  games_completed  int,
  game_score       int,
  max_game_score   int,
  points           int,
  overall_pct      int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_approved_employee() or public.is_admin()) then
    raise exception 'not authorized';
  end if;
  return query
  with agg as (
    select
      p.user_id as uid,
      max(p.user_name) as nm,
      coalesce(sum(case when p.scope = 'level' then jsonb_array_length(p.mastered) else 0 end), 0)::int as terms,
      coalesce(sum(case when p.scope = 'game' and p.completed then 1 else 0 end), 0)::int as games,
      coalesce(sum(case when p.scope = 'game' then p.score else 0 end), 0)::int as gscore,
      coalesce(sum(case when p.scope = 'game' then p.total else 0 end), 0)::int as gmax
    from public.academy_progress p
    group by p.user_id
  )
  select
    a.uid, a.nm, a.terms, a.games, a.gscore, a.gmax,
    (a.terms + a.gscore * 5)::int as points,
    least(100, round(a.terms::numeric / 400 * 100))::int as overall
  from agg a
  order by (a.terms + a.gscore * 5) desc, a.terms desc, a.nm asc;
end;
$$;

revoke all on function public.academy_leaderboard() from public, anon;
grant execute on function public.academy_leaderboard() to authenticated;
