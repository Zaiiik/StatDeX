-- LEVELING-APP · essai manuel 14 jours + catalogue de thèmes par rareté.

create or replace function public.activate_trial_v2141()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_confirmed timestamptz;
  v_started timestamptz;
  v_expires timestamptz;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select email_confirmed_at into v_confirmed from auth.users where id = v_uid;
  if v_confirmed is null then raise exception 'EMAIL_NOT_VERIFIED'; end if;

  perform public.ensure_user_access_v214(v_uid);
  select trial_started_at, trial_expires_at into v_started, v_expires
  from public.user_access_entitlements
  where user_id = v_uid
  for update;

  if v_started is not null then
    if v_expires is not null and v_expires > now() then
      return jsonb_build_object('ok', true, 'already_active', true, 'trial_started_at', v_started, 'trial_expires_at', v_expires);
    end if;
    raise exception 'TRIAL_ALREADY_USED';
  end if;

  v_started := now();
  v_expires := v_started + interval '14 days';
  update public.user_access_entitlements
  set trial_started_at = v_started,
      trial_expires_at = v_expires,
      updated_at = now()
  where user_id = v_uid;

  return jsonb_build_object('ok', true, 'already_active', false, 'trial_started_at', v_started, 'trial_expires_at', v_expires);
end;
$$;

revoke all on function public.activate_trial_v2141() from public, anon;
grant execute on function public.activate_trial_v2141() to authenticated;

alter table public.crystal_theme_catalog
  add column if not exists rarity text not null default 'rare';

alter table public.crystal_theme_catalog
  drop constraint if exists crystal_theme_catalog_rarity_check;
alter table public.crystal_theme_catalog
  add constraint crystal_theme_catalog_rarity_check
  check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary'));

insert into public.crystal_theme_catalog(code, theme_id, label, description, crystal_cost, rarity, active, sort_order)
values
  ('theme_void', 'void', 'VOID', 'Noir absolu et interface minimale.', 120, 'common', true, 5),
  ('theme_shadow', 'shadow', 'SHADOW', 'Abysses et aura violette vivante.', 180, 'uncommon', true, 8),
  ('theme_sakura', 'sakura', 'SAKURA', 'Floraison nocturne, pétales et brume rose.', 250, 'rare', true, 10),
  ('theme_electric', 'electric', 'ELECTRIC', 'Charge bleue, éclairs et pulsations.', 280, 'rare', true, 15),
  ('theme_bloodmoon', 'bloodmoon', 'BLOOD MOON', 'Nuit écarlate, brume rouge et cendres.', 350, 'epic', true, 20),
  ('theme_winter', 'winter', 'WINTER ARC', 'Givre, fissures et neige SYSTEM.', 450, 'legendary', true, 30),
  ('theme_monarch', 'monarch', 'MONARCH', 'Obsidienne, or, argent et prestige.', 650, 'legendary', true, 40)
on conflict (code) do update set
  theme_id = excluded.theme_id,
  label = excluded.label,
  description = excluded.description,
  crystal_cost = excluded.crystal_cost,
  rarity = excluded.rarity,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();

create or replace function public.get_my_crystal_shop_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_balance integer := 0;
  v_themes jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  perform public.ensure_user_access_v214(v_uid);

  select coalesce(balance, 0) into v_balance
  from public.user_crystal_wallets where user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', c.code,
    'theme_id', c.theme_id,
    'label', c.label,
    'description', c.description,
    'crystal_cost', c.crystal_cost,
    'rarity', upper(c.rarity),
    'owned', (o.user_id is not null),
    'acquired_at', o.acquired_at
  ) order by c.sort_order, c.code), '[]'::jsonb)
  into v_themes
  from public.crystal_theme_catalog c
  left join public.user_owned_themes o
    on o.user_id = v_uid and o.theme_id = c.theme_id
  where c.active = true;

  return jsonb_build_object('balance', v_balance, 'themes', v_themes);
end;
$$;

revoke all on function public.get_my_crystal_shop_v1() from public, anon;
grant execute on function public.get_my_crystal_shop_v1() to authenticated;

notify pgrst, 'reload schema';
