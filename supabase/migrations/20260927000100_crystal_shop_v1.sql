-- LEVELING-APP · Boutique Cristaux V1
-- Catalogue serveur, propriété persistante des thèmes et achats transactionnels/idempotents.

create table if not exists public.crystal_theme_catalog (
  code text primary key,
  theme_id text not null unique,
  label text not null,
  description text not null default '',
  crystal_cost integer not null check (crystal_cost > 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crystal_theme_catalog_code_format check (code ~ '^theme_[a-z0-9_]+$'),
  constraint crystal_theme_catalog_theme_id_format check (theme_id ~ '^[a-z0-9]+$')
);

insert into public.crystal_theme_catalog(code, theme_id, label, description, crystal_cost, active, sort_order)
values
  ('theme_sakura', 'sakura', 'SAKURA', 'Floraison nocturne, pétales et brume rose.', 250, true, 10),
  ('theme_bloodmoon', 'bloodmoon', 'BLOOD MOON', 'Nuit écarlate, brume rouge et cendres.', 350, true, 20),
  ('theme_winter', 'winter', 'WINTER ARC', 'Givre, fissures et neige SYSTEM.', 400, true, 30)
on conflict (code) do update set
  theme_id = excluded.theme_id,
  label = excluded.label,
  description = excluded.description,
  crystal_cost = excluded.crystal_cost,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists public.user_owned_themes (
  user_id uuid not null references auth.users(id) on delete cascade,
  theme_id text not null references public.crystal_theme_catalog(theme_id),
  product_code text not null references public.crystal_theme_catalog(code),
  source text not null default 'crystal_purchase' check (source in ('crystal_purchase')),
  price_paid integer not null check (price_paid >= 0),
  acquired_at timestamptz not null default now(),
  primary key (user_id, theme_id)
);

create table if not exists public.crystal_purchase_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  product_kind text not null check (product_kind in ('theme', 'access_pass')),
  product_code text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

create index if not exists user_owned_themes_user_acquired_idx
  on public.user_owned_themes(user_id, acquired_at desc);
create index if not exists crystal_purchase_receipts_user_created_idx
  on public.crystal_purchase_receipts(user_id, created_at desc);

alter table public.crystal_theme_catalog enable row level security;
alter table public.user_owned_themes enable row level security;
alter table public.crystal_purchase_receipts enable row level security;

drop policy if exists crystal_theme_catalog_authenticated_read on public.crystal_theme_catalog;
create policy crystal_theme_catalog_authenticated_read
  on public.crystal_theme_catalog for select
  to authenticated
  using (active = true);

drop policy if exists user_owned_themes_own_read on public.user_owned_themes;
create policy user_owned_themes_own_read
  on public.user_owned_themes for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.crystal_theme_catalog from public, anon, authenticated;
revoke all on table public.user_owned_themes from public, anon, authenticated;
revoke all on table public.crystal_purchase_receipts from public, anon, authenticated;
grant select on table public.crystal_theme_catalog to authenticated;
grant select on table public.user_owned_themes to authenticated;

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

create or replace function public.purchase_crystal_theme_v1(p_theme_id text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.crystal_theme_catalog%rowtype;
  v_balance integer := 0;
  v_receipt public.crystal_purchase_receipts%rowtype;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text || ':theme:' || trim(p_theme_id), 0));

  select * into v_receipt from public.crystal_purchase_receipts
  where user_id = v_uid and request_id = p_request_id;
  if found then
    if v_receipt.product_kind <> 'theme' or v_receipt.product_code <> trim(p_theme_id) then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_receipt.result;
  end if;

  perform public.ensure_user_access_v214(v_uid);
  select * into v_item from public.crystal_theme_catalog
  where theme_id = trim(p_theme_id) and active = true;
  if not found then raise exception 'THEME_NOT_FOUND'; end if;

  select balance into v_balance from public.user_crystal_wallets
  where user_id = v_uid for update;

  if exists(select 1 from public.user_owned_themes where user_id = v_uid and theme_id = v_item.theme_id) then
    v_result := jsonb_build_object(
      'ok', true, 'already_owned', true, 'theme_id', v_item.theme_id,
      'crystals_spent', 0, 'balance', coalesce(v_balance, 0)
    );
  else
    if coalesce(v_balance, 0) < v_item.crystal_cost then raise exception 'INSUFFICIENT_CRYSTALS'; end if;

    update public.user_crystal_wallets
    set balance = balance - v_item.crystal_cost,
        lifetime_spent = lifetime_spent + v_item.crystal_cost,
        updated_at = now()
    where user_id = v_uid
    returning balance into v_balance;

    insert into public.user_owned_themes(user_id, theme_id, product_code, price_paid)
    values(v_uid, v_item.theme_id, v_item.code, v_item.crystal_cost);

    insert into public.crystal_transactions(user_id, amount, reason, metadata)
    values(v_uid, -v_item.crystal_cost, 'theme_purchase',
      jsonb_build_object('product_code', v_item.code, 'theme_id', v_item.theme_id));

    v_result := jsonb_build_object(
      'ok', true, 'already_owned', false, 'theme_id', v_item.theme_id,
      'crystals_spent', v_item.crystal_cost, 'balance', v_balance
    );
  end if;

  insert into public.crystal_purchase_receipts(user_id, request_id, product_kind, product_code, result)
  values(v_uid, p_request_id, 'theme', v_item.theme_id, v_result);
  return v_result;
end;
$$;

create or replace function public.redeem_crystal_access_v2(p_offer_code text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_confirmed timestamptz;
  v_offer public.crystal_access_offers%rowtype;
  v_ent public.user_access_entitlements%rowtype;
  v_wallet public.user_crystal_wallets%rowtype;
  v_receipt public.crystal_purchase_receipts%rowtype;
  v_sub_exists boolean := false;
  v_new_until timestamptz;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text || ':pass:' || p_request_id::text, 0));
  select * into v_receipt from public.crystal_purchase_receipts
  where user_id = v_uid and request_id = p_request_id;
  if found then
    if v_receipt.product_kind <> 'access_pass' or v_receipt.product_code <> trim(p_offer_code) then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_receipt.result;
  end if;

  select email_confirmed_at into v_confirmed from auth.users where id = v_uid;
  if v_confirmed is null then raise exception 'EMAIL_NOT_VERIFIED'; end if;
  perform public.ensure_user_access_v214(v_uid);

  select exists(
    select 1 from public.user_subscriptions us
    join public.subscription_plans sp on sp.code = us.plan_code
    where us.user_id = v_uid
      and (us.status = 'lifetime' or sp.lifetime = true or
        (us.status in ('active', 'trialing') and (us.current_period_end is null or us.current_period_end > now())))
  ) into v_sub_exists;
  if v_sub_exists then raise exception 'PREMIUM_ALREADY_ACTIVE'; end if;

  select * into v_ent from public.user_access_entitlements where user_id = v_uid for update;
  if v_ent.trial_started_at is null then raise exception 'TRIAL_NOT_ACTIVATED'; end if;
  if v_ent.trial_expires_at is not null and v_ent.trial_expires_at > now() then raise exception 'TRIAL_ALREADY_ACTIVE'; end if;

  select * into v_offer from public.crystal_access_offers
  where code = trim(p_offer_code) and active = true;
  if not found then raise exception 'OFFER_NOT_FOUND'; end if;

  select * into v_wallet from public.user_crystal_wallets where user_id = v_uid for update;
  if coalesce(v_wallet.balance, 0) < v_offer.crystal_cost then raise exception 'INSUFFICIENT_CRYSTALS'; end if;

  v_new_until := greatest(now(), coalesce(v_ent.temporary_access_until, now())) + make_interval(days => v_offer.access_days);
  update public.user_crystal_wallets
  set balance = balance - v_offer.crystal_cost,
      lifetime_spent = lifetime_spent + v_offer.crystal_cost,
      updated_at = now()
  where user_id = v_uid;
  update public.user_access_entitlements
  set temporary_access_until = v_new_until, updated_at = now()
  where user_id = v_uid;
  insert into public.crystal_transactions(user_id, amount, reason, metadata)
  values(v_uid, -v_offer.crystal_cost, 'access_pass',
    jsonb_build_object('offer_code', v_offer.code, 'access_days', v_offer.access_days, 'access_until', v_new_until));

  v_result := jsonb_build_object(
    'ok', true, 'offer_code', v_offer.code, 'crystals_spent', v_offer.crystal_cost,
    'access_days', v_offer.access_days, 'access_until', v_new_until,
    'balance', v_wallet.balance - v_offer.crystal_cost
  );
  insert into public.crystal_purchase_receipts(user_id, request_id, product_kind, product_code, result)
  values(v_uid, p_request_id, 'access_pass', v_offer.code, v_result);
  return v_result;
end;
$$;

revoke all on function public.get_my_crystal_shop_v1() from public, anon;
revoke all on function public.purchase_crystal_theme_v1(text, uuid) from public, anon;
revoke all on function public.redeem_crystal_access_v2(text, uuid) from public, anon;
grant execute on function public.get_my_crystal_shop_v1() to authenticated;
grant execute on function public.purchase_crystal_theme_v1(text, uuid) to authenticated;
grant execute on function public.redeem_crystal_access_v2(text, uuid) to authenticated;

notify pgrst, 'reload schema';
