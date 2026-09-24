-- LEVELING-APP V22.1.4
-- Last line of defence against an outdated client replacing newer progression.
-- The client still performs merge + compare-and-swap; this trigger rejects a
-- monotonic regression even when an old build writes directly to profiles.

create or replace function public.leveling_prevent_progress_regression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_cycle_text text;
  new_cycle_text text;
  old_xp_text text;
  new_xp_text text;
  old_workouts_text text;
  new_workouts_text text;
  old_block_text text;
  new_block_text text;
  old_day_text text;
  new_day_text text;
  old_cycle numeric := 1;
  new_cycle numeric := 1;
  old_xp numeric := 0;
  new_xp numeric := 0;
  old_workouts numeric := 0;
  new_workouts numeric := 0;
  old_block numeric := 0;
  new_block numeric := 0;
  old_day numeric := 0;
  new_day numeric := 0;
  old_sessions integer := 0;
  new_sessions integer := 0;
  old_validations integer := 0;
  new_validations integer := 0;
begin
  if old.app_data is null or old.app_data = '{}'::jsonb then
    return new;
  end if;

  if new.app_data is null or jsonb_typeof(new.app_data) <> 'object' then
    raise exception 'leveling_progress_regression: app_data cannot replace a populated profile with an empty payload'
      using errcode = '22000';
  end if;

  old_cycle_text := coalesce(old.app_data ->> 'cycleNumber', '1');
  new_cycle_text := coalesce(new.app_data ->> 'cycleNumber', '1');
  old_xp_text := coalesce(old.app_data #>> '{v10,totalXp}', old.app_data #>> '{v10,xp}', '0');
  new_xp_text := coalesce(new.app_data #>> '{v10,totalXp}', new.app_data #>> '{v10,xp}', '0');
  old_workouts_text := coalesce(old.app_data #>> '{userData,workoutsCompleted}', '0');
  new_workouts_text := coalesce(new.app_data #>> '{userData,workoutsCompleted}', '0');
  old_block_text := coalesce(old.app_data ->> 'currentBlockIndex', '0');
  new_block_text := coalesce(new.app_data ->> 'currentBlockIndex', '0');
  old_day_text := coalesce(old.app_data ->> 'currentDayIndex', '0');
  new_day_text := coalesce(new.app_data ->> 'currentDayIndex', '0');

  if old_cycle_text ~ '^\d+(\.\d+)?$' then old_cycle := old_cycle_text::numeric; end if;
  if new_cycle_text ~ '^\d+(\.\d+)?$' then new_cycle := new_cycle_text::numeric; end if;
  if old_xp_text ~ '^\d+(\.\d+)?$' then old_xp := old_xp_text::numeric; end if;
  if new_xp_text ~ '^\d+(\.\d+)?$' then new_xp := new_xp_text::numeric; end if;
  if old_workouts_text ~ '^\d+(\.\d+)?$' then old_workouts := old_workouts_text::numeric; end if;
  if new_workouts_text ~ '^\d+(\.\d+)?$' then new_workouts := new_workouts_text::numeric; end if;
  if old_block_text ~ '^\d+(\.\d+)?$' then old_block := old_block_text::numeric; end if;
  if new_block_text ~ '^\d+(\.\d+)?$' then new_block := new_block_text::numeric; end if;
  if old_day_text ~ '^\d+(\.\d+)?$' then old_day := old_day_text::numeric; end if;
  if new_day_text ~ '^\d+(\.\d+)?$' then new_day := new_day_text::numeric; end if;

  if jsonb_typeof(old.app_data #> '{v10,sessions}') = 'array' then
    old_sessions := jsonb_array_length(old.app_data #> '{v10,sessions}');
  end if;
  if jsonb_typeof(new.app_data #> '{v10,sessions}') = 'array' then
    new_sessions := jsonb_array_length(new.app_data #> '{v10,sessions}');
  end if;

  if jsonb_typeof(old.app_data -> 'validatedSessions') = 'object' then
    old_validations := greatest(old_validations, (select count(*)::integer from jsonb_object_keys(old.app_data -> 'validatedSessions')));
  end if;
  if jsonb_typeof(new.app_data -> 'validatedSessions') = 'object' then
    new_validations := greatest(new_validations, (select count(*)::integer from jsonb_object_keys(new.app_data -> 'validatedSessions')));
  end if;
  if jsonb_typeof(old.app_data #> '{userData,validatedSessions}') = 'object' then
    old_validations := greatest(old_validations, (select count(*)::integer from jsonb_object_keys(old.app_data #> '{userData,validatedSessions}')));
  end if;
  if jsonb_typeof(new.app_data #> '{userData,validatedSessions}') = 'object' then
    new_validations := greatest(new_validations, (select count(*)::integer from jsonb_object_keys(new.app_data #> '{userData,validatedSessions}')));
  end if;

  if new_cycle < old_cycle
     or new_xp < old_xp
     or new_workouts < old_workouts
     or new_sessions < old_sessions then
    raise exception 'leveling_progress_regression: cycle, XP, workouts or sessions cannot decrease'
      using errcode = '22000';
  end if;

  if new_cycle = old_cycle
     and coalesce(new.app_data ->> 'activeProgramKey', '') = coalesce(old.app_data ->> 'activeProgramKey', '')
     and (
       new_validations < old_validations
       or new_block < old_block
       or (new_block = old_block and new_day < old_day)
     ) then
    raise exception 'leveling_progress_regression: block, day or validations cannot decrease inside a cycle'
      using errcode = '22000';
  end if;

  return new;
end;
$$;

revoke all on function public.leveling_prevent_progress_regression() from public, anon, authenticated;

drop trigger if exists leveling_profiles_no_progress_regression on public.profiles;
create trigger leveling_profiles_no_progress_regression
before update of app_data on public.profiles
for each row
execute function public.leveling_prevent_progress_regression();
