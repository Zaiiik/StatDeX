-- Preserve every validated session key within the same cycle/program.
-- Counting alone is insufficient because an obsolete client could replace
-- two valid keys with two different stale keys.

create or replace function public.leveling_prevent_validation_key_regression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_cycle integer := 1;
  new_cycle integer := 1;
  old_top jsonb := '{}'::jsonb;
  new_top jsonb := '{}'::jsonb;
  old_user jsonb := '{}'::jsonb;
  new_user jsonb := '{}'::jsonb;
begin
  if coalesce(old.app_data ->> 'cycleNumber', '1') ~ '^\d+$' then
    old_cycle := (old.app_data ->> 'cycleNumber')::integer;
  end if;
  if coalesce(new.app_data ->> 'cycleNumber', '1') ~ '^\d+$' then
    new_cycle := (new.app_data ->> 'cycleNumber')::integer;
  end if;

  if old_cycle <> new_cycle
     or coalesce(old.app_data ->> 'activeProgramKey', '') <> coalesce(new.app_data ->> 'activeProgramKey', '') then
    return new;
  end if;

  if jsonb_typeof(old.app_data -> 'validatedSessions') = 'object' then old_top := old.app_data -> 'validatedSessions'; end if;
  if jsonb_typeof(new.app_data -> 'validatedSessions') = 'object' then new_top := new.app_data -> 'validatedSessions'; end if;
  if jsonb_typeof(old.app_data #> '{userData,validatedSessions}') = 'object' then old_user := old.app_data #> '{userData,validatedSessions}'; end if;
  if jsonb_typeof(new.app_data #> '{userData,validatedSessions}') = 'object' then new_user := new.app_data #> '{userData,validatedSessions}'; end if;

  if exists (select 1 from jsonb_object_keys(old_top) as old_key(key) where not (new_top ? old_key.key))
     or exists (select 1 from jsonb_object_keys(old_user) as old_key(key) where not (new_user ? old_key.key)) then
    raise exception 'leveling_progress_regression: a validated session key cannot be removed inside a cycle'
      using errcode = '22000';
  end if;

  return new;
end;
$$;

revoke all on function public.leveling_prevent_validation_key_regression() from public, anon, authenticated;

drop trigger if exists leveling_profiles_keep_validation_keys on public.profiles;
create trigger leveling_profiles_keep_validation_keys
before update of app_data on public.profiles
for each row
execute function public.leveling_prevent_validation_key_regression();
